import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import { inspect } from 'node:util';
import Stripe from 'stripe';

const asModule = (code: string) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const fixtures = {
  stripeKey: 'sk_test_legacy_privacy_only_fixture',
  webhookSecret: 'whsec_private_webhook_fixture_only',
  tokenSecret: 'private_download_secret_fixture_only',
  email: 'private-download-reader@example.invalid',
  sessionId: 'cs_test_privateDownloadFixture',
  bodyMarker: 'private_webhook_body_fixture',
  providerMessage: 'private_provider_error_fixture',
};
const environment = {
  STRIPE_SECRET_KEY: fixtures.stripeKey,
  STRIPE_WEBHOOK_SECRET: fixtures.webhookSecret,
  DOWNLOAD_TOKEN_SECRET: fixtures.tokenSecret,
  DEV: false,
  SKIP_WEBHOOK_VERIFICATION: 'false',
};

const externalBoundary = Symbol.for('coachedgar.legacyPrivacyTest.stripe');
const externalStripe = asModule(`export default class Stripe {
  constructor(key, options) {
    if (key !== ${JSON.stringify(fixtures.stripeKey)} || options.apiVersion !== '2023-10-16') {
      throw new Error('Unexpected fixture Stripe configuration');
    }
  }
  checkout = { sessions: {
    retrieve: (...args) => globalThis[Symbol.for('coachedgar.legacyPrivacyTest.stripe')].retrieve(...args),
    create: (...args) => globalThis[Symbol.for('coachedgar.legacyPrivacyTest.stripe')].create(...args),
  } };
}`);

// Run each real route after TypeScript erasure. Only build-time env reads and
// imports are adapted; the real Stripe SDK verifies webhook signatures, while
// remote checkout operations use a controlled external boundary.
async function loadRoute(name: string, external = false, overrides: Record<string, unknown> = {}) {
  const source = (await readFile(new URL(`../src/pages/api/${name}.ts`, import.meta.url), 'utf8'))
    .replace("from 'stripe'", `from ${JSON.stringify(external ? externalStripe : import.meta.resolve('stripe'))}`)
    .replace("from '../../lib/server/download-token.ts'", `from ${JSON.stringify(new URL('../src/lib/server/download-token.ts', import.meta.url).href)}`)
    .replaceAll('import.meta.env', `(${JSON.stringify({ ...environment, ...overrides })})`);
  return import(asModule(stripTypeScriptTypes(source, { mode: 'strip' })));
}

async function capture<T>(run: (captured: { logs: string[]; requests: string[] }) => Promise<T>) {
  const captured = { logs: [] as string[], requests: [] as string[] };
  const originalLog = console.log;
  const originalError = console.error;
  const originalFetch = globalThis.fetch;
  const originalBoundary = (globalThis as any)[externalBoundary];
  console.log = (...values) => { captured.logs.push(inspect(values, { depth: null })); };
  console.error = (...values) => { captured.logs.push(inspect(values, { depth: null })); };
  globalThis.fetch = async (input) => {
    captured.requests.push(String(input));
    return new Response('', { status: 200 });
  };
  try {
    return await run(captured);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    globalThis.fetch = originalFetch;
    if (originalBoundary === undefined) delete (globalThis as any)[externalBoundary];
    else (globalThis as any)[externalBoundary] = originalBoundary;
  }
}

function assertPrivateLogs(logs: string[], extraValues: string[] = []) {
  const output = logs.join('\n');
  for (const value of [...Object.values(fixtures), fixtures.webhookSecret.slice(0, 8), ...extraValues]) {
    assert.ok(!output.includes(value), 'operational logs must not contain private fixture data');
  }
}

function pdfSession(overrides: Record<string, unknown> = {}) {
  return {
    id: fixtures.sessionId, object: 'checkout.session', mode: 'payment', status: 'complete',
    payment_status: 'paid', amount_total: 3000, currency: 'usd',
    customer_details: { email: fixtures.email },
    metadata: { product_type: 'pdf', product_name: 'Feed the Fame', product_id: 'pdf_download' },
    ...overrides,
  };
}

function webhookBody() {
  return JSON.stringify({
    id: 'evt_test_privateFixture', object: 'event', type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000), livemode: false, pending_webhooks: 1,
    api_version: '2023-10-16', request: { id: null, idempotency_key: null },
    privateFixture: fixtures.bodyMarker, data: { object: pdfSession() },
  });
}

function webhookRequest(body: string, signature: string) {
  return new Request('https://coachedgar.example/api/stripe-webhook', {
    method: 'POST', headers: { 'stripe-signature': signature, 'Content-Type': 'application/json' }, body,
  });
}

function downloadRequest(email = fixtures.email, sessionId = fixtures.sessionId) {
  return new Request('https://coachedgar.example/api/download-pdf', {
    method: 'POST', body: new URLSearchParams({ sessionId, customerEmail: email }),
  });
}

function secureContext(downloadUrl: string, bucket?: unknown, environment: Record<string, unknown> = {}) {
  return {
    request: new Request(downloadUrl), url: new URL(downloadUrl),
    locals: { runtime: { env: { PDF_STORAGE: bucket, ...environment } } },
  };
}

function providerFailure() {
  return Object.assign(new Error(`${fixtures.providerMessage}: ${fixtures.email} ${fixtures.stripeKey} ${fixtures.sessionId}`), {
    type: `${fixtures.providerMessage}_type`,
  });
}

test('a genuinely signed PDF webhook acknowledges payment without sending external tracking', async () => {
  const { POST } = await loadRoute('stripe-webhook');
  const body = webhookBody();
  const signature = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: fixtures.webhookSecret });
  await capture(async ({ logs, requests }) => {
    const response = await POST({ request: webhookRequest(body, signature) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true });
    assert.deepEqual(requests, [], 'successful payment must not trigger external analytics');
    assertPrivateLogs(logs, [body, body.slice(0, 100), signature, signature.slice(0, 50)]);
  });
});

test('an invalid webhook signature stays rejected without logging body, signature, or secret', async () => {
  const { POST } = await loadRoute('stripe-webhook');
  const body = webhookBody();
  const signature = `t=${Math.floor(Date.now() / 1000)},v1=private_signature_fixture`;
  await capture(async ({ logs, requests }) => {
    const response = await POST({ request: webhookRequest(body, signature) });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Webhook signature verification failed' });
    assert.deepEqual(requests, []);
    assertPrivateLogs(logs, [body, body.slice(0, 100), signature, signature.slice(0, 50), 'private_signature_fixture']);
  });
});

test('the existing explicit webhook verification bypass still acknowledges without tracking', async () => {
  const { POST } = await loadRoute('stripe-webhook', false, { SKIP_WEBHOOK_VERIFICATION: 'true' });
  await capture(async ({ logs, requests }) => {
    const response = await POST({ request: webhookRequest(webhookBody(), 'private_bypass_signature_fixture') });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true });
    assert.deepEqual(requests, []);
    assertPrivateLogs(logs, ['private_bypass_signature_fixture']);
  });
});

test('a verified purchase generates a one-hour token and serves the R2 PDF without private logs', async () => {
  const { POST } = await loadRoute('download-pdf', true);
  const { GET } = await loadRoute('secure-download');
  await capture(async ({ logs, requests }) => {
    (globalThis as any)[externalBoundary] = { retrieve: async (id: string) => {
      assert.equal(id, fixtures.sessionId);
      return pdfSession();
    } };
    const before = Math.floor(Date.now() / 1000);
    const response = await POST({ request: downloadRequest(), locals: {} });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'application/json');
    const result = await response.json();
    assert.ok(result.expiresAt >= before + 3600 && result.expiresAt <= Math.floor(Date.now() / 1000) + 3600);
    const downloadUrl = new URL(result.downloadUrl);
    assert.equal(downloadUrl.origin, 'https://coachedgar.example');
    assert.equal(downloadUrl.pathname, '/api/secure-download');
    const token = downloadUrl.searchParams.get('token')!;
    assert.ok(token);
    const payload = JSON.parse(atob(token.split('.')[0]));
    assert.equal(payload.customerEmail, fixtures.email);
    assert.equal(payload.sessionId, fixtures.sessionId);
    assert.equal(payload.productType, 'pdf');
    assert.equal(payload.expiresAt, result.expiresAt);
    assert.match(payload.nonce, /^[a-f0-9]{32}$/);
    const reads: string[] = [];
    const pdf = await GET(secureContext(result.downloadUrl, { get: async (key: string) => {
      reads.push(key);
      return { body: 'private fixture PDF bytes' };
    } }));
    assert.equal(pdf.status, 200);
    assert.equal(await pdf.text(), 'private fixture PDF bytes');
    assert.deepEqual(reads, ['feed-the-fame.pdf']);
    assert.equal(pdf.headers.get('Content-Type'), 'application/pdf');
    assert.equal(pdf.headers.get('Content-Disposition'), 'attachment; filename="feed-the-fame.pdf"');
    assert.equal(pdf.headers.get('Cache-Control'), 'no-cache, no-store, must-revalidate');
    assert.equal(pdf.headers.get('Pragma'), 'no-cache');
    assert.equal(pdf.headers.get('Expires'), '0');
    assert.deepEqual(requests, []);
    assertPrivateLogs(logs, [token, payload.nonce, result.downloadUrl]);
  });
});

for (const [label, session, submittedEmail, expectedError] of [
  ['unpaid session', pdfSession({ payment_status: 'unpaid' }), fixtures.email, 'Payment not completed'],
  ['mismatched email', pdfSession(), 'other-private-reader@example.invalid', 'Email verification failed'],
  ['non-PDF session', pdfSession({ metadata: { product_type: 'private_other_product_fixture' } }), fixtures.email, 'Invalid product type'],
] as const) {
  test(`download authorization rejects ${label} without exposing purchase details in logs`, async () => {
    const { POST } = await loadRoute('download-pdf', true);
    await capture(async ({ logs }) => {
      (globalThis as any)[externalBoundary] = { retrieve: async () => session };
      const response = await POST({ request: downloadRequest(submittedEmail), locals: {} });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: expectedError });
      assertPrivateLogs(logs, [submittedEmail, 'private_other_product_fixture']);
    });
  });
}

test('download provider failures return a generic error and do not log provider diagnostics', async () => {
  const { POST } = await loadRoute('download-pdf', true);
  await capture(async ({ logs }) => {
    (globalThis as any)[externalBoundary] = { retrieve: async () => { throw providerFailure(); } };
    const response = await POST({ request: downloadRequest(), locals: {} });
    assert.equal(response.status, 500);
    const body = await response.text();
    assert.equal(JSON.parse(body).error, 'Unable to generate download link. Please contact support.');
    assertPrivateLogs(logs);
    for (const value of Object.values(fixtures)) assert.ok(!body.includes(value));
  });
});

test('tampered and expired download tokens are rejected before any R2 access', async () => {
  const { POST } = await loadRoute('download-pdf', true);
  const { GET } = await loadRoute('secure-download');
  await capture(async ({ logs }) => {
    (globalThis as any)[externalBoundary] = { retrieve: async () => pdfSession() };
    const issued = await (await POST({ request: downloadRequest(), locals: {} })).json();
    const validUrl = new URL(issued.downloadUrl);
    const token = validUrl.searchParams.get('token')!;
    const deniedUrl = new URL(validUrl);
    deniedUrl.searchParams.set('token', `${token.split('.')[0]}.tampered_signature_fixture`);
    let reads = 0;
    const bucket = { get: async () => { reads += 1; throw new Error('must not read protected PDF'); } };
    const tampered = await GET(secureContext(deniedUrl.href, bucket));
    assert.equal(tampered.status, 403);
    assert.deepEqual(await tampered.json(), { error: 'Invalid or expired download token' });
    const originalNow = Date.now;
    try {
      Date.now = () => (issued.expiresAt + 1) * 1000;
      const expired = await GET(secureContext(validUrl.href, bucket));
      assert.equal(expired.status, 403);
      assert.deepEqual(await expired.json(), { error: 'Invalid or expired download token' });
    } finally {
      Date.now = originalNow;
    }
    assert.equal(reads, 0);
    assertPrivateLogs(logs, [token, 'tampered_signature_fixture']);
  });
});

test('malformed token and R2 provider failures keep private diagnostics out of logs', async () => {
  const { POST } = await loadRoute('download-pdf', true);
  const { GET } = await loadRoute('secure-download');
  await capture(async ({ logs }) => {
    (globalThis as any)[externalBoundary] = { retrieve: async () => pdfSession() };
    const malformedToken = `${btoa(`{${fixtures.email}`)}.signature`;
    const malformed = await GET(secureContext(`https://coachedgar.example/api/secure-download?token=${encodeURIComponent(malformedToken)}`));
    assert.equal(malformed.status, 403);
    const issued = await (await POST({ request: downloadRequest(), locals: {} })).json();
    const response = await GET(secureContext(issued.downloadUrl, { get: async () => { throw providerFailure(); } }));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Failed to retrieve PDF' });
    assertPrivateLogs(logs, [malformedToken]);
  });
});

test('PDF checkout retains its product and return URLs without logging provider failures', async () => {
  const { POST } = await loadRoute('create-pdf-checkout-session', true);
  await capture(async ({ logs }) => {
    const created: any[] = [];
    (globalThis as any)[externalBoundary] = { create: async (params: unknown) => {
      created.push(params);
      return { id: fixtures.sessionId, url: 'https://checkout.stripe.com/c/pay/privateFixture' };
    } };
    const context = () => ({
      request: new Request('https://coachedgar.example/api/create-pdf-checkout-session', {
        method: 'POST', body: new URLSearchParams({ productType: 'pdf' }),
      }),
      locals: { runtime: { env: { STRIPE_SECRET_KEY: fixtures.stripeKey } } },
    });
    const response = await POST(context());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true, sessionId: fixtures.sessionId, checkoutUrl: 'https://checkout.stripe.com/c/pay/privateFixture',
    });
    assert.equal(created.length, 1);
    assert.equal(created[0].mode, 'payment');
    assert.deepEqual(created[0].line_items, [{ price: 'price_1S04trATEGp1ZwvVC5GARSK6', quantity: 1 }]);
    assert.equal(created[0].success_url, 'https://coachedgar.example/download-pdf?session_id={CHECKOUT_SESSION_ID}');
    assert.equal(created[0].cancel_url, 'https://coachedgar.example/pay?canceled=true&product=pdf');
    assert.deepEqual(created[0].metadata, { product_type: 'pdf', product_name: 'Feed the Fame' });
    (globalThis as any)[externalBoundary] = { create: async () => { throw providerFailure(); } };
    const failed = await POST(context());
    assert.equal(failed.status, 500);
    const body = await failed.text();
    assert.equal(JSON.parse(body).error, 'Unable to create checkout session. Please try again later.');
    assertPrivateLogs(logs);
    for (const value of Object.values(fixtures)) assert.ok(!body.includes(value));
  });
});

test('the webhook bypass still rejects a null JSON event with the original 400 status', async () => {
  const { POST } = await loadRoute('stripe-webhook', false, { SKIP_WEBHOOK_VERIFICATION: 'true' });
  await capture(async ({ logs, requests }) => {
    const response = await POST({ request: webhookRequest('null', 'private_null_event_signature_fixture') });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Webhook signature verification failed' });
    assert.deepEqual(requests, []);
    assertPrivateLogs(logs, ['private_null_event_signature_fixture']);
  });
});

function signedFixtureToken(claims: Record<string, unknown>, secret = fixtures.tokenSecret) {
  const data = Buffer.from(JSON.stringify(claims)).toString('base64');
  return `${data}.${createHmac('sha256', secret).update(data).digest('hex')}`;
}

function downloadClaims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sessionId: fixtures.sessionId,
    customerEmail: fixtures.email,
    issuedAt: now,
    expiresAt: now + 3600,
    productType: 'pdf',
    nonce: '0123456789abcdef0123456789abcdef',
    ...overrides,
  };
}

function tokenUrl(token: string) {
  return `https://coachedgar.example/api/secure-download?token=${encodeURIComponent(token)}`;
}

for (const [label, secret] of [
  ['missing', undefined],
  ['blank', '   '],
  ['public fallback', 'fallback-secret-key-change-in-production'],
] as const) {
  test(`${label} download signing secret disables issuance and delivery before provider or R2 access`, async () => {
    const { POST } = await loadRoute('download-pdf', true, { DOWNLOAD_TOKEN_SECRET: secret });
    const { GET } = await loadRoute('secure-download', false, { DOWNLOAD_TOKEN_SECRET: secret });
    await capture(async ({ logs, requests }) => {
      let providerReads = 0;
      let storageReads = 0;
      (globalThis as any)[externalBoundary] = { retrieve: async () => { providerReads++; return pdfSession(); } };
      const response = await POST({ request: downloadRequest(), locals: {} });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'Downloads are temporarily unavailable. Please try again later.' });
      const download = await GET(secureContext(tokenUrl(signedFixtureToken(downloadClaims())), {
        get: async () => { storageReads++; return { body: 'protected PDF' }; },
      }));
      assert.equal(download.status, 503);
      assert.deepEqual(await download.json(), { error: 'Downloads are temporarily unavailable. Please try again later.' });
      assert.equal(providerReads, 0);
      assert.equal(storageReads, 0);
      assert.deepEqual(requests, []);
      assertPrivateLogs(logs);
    });
  });
}

test('runtime-only signing secret issues a genuine HMAC token and the delivery handler accepts it', async () => {
  const runtimeSecret = 'private_runtime_download_secret_fixture_only';
  const { POST } = await loadRoute('download-pdf', true, { DOWNLOAD_TOKEN_SECRET: undefined });
  const { GET } = await loadRoute('secure-download', false, { DOWNLOAD_TOKEN_SECRET: undefined });
  await capture(async ({ logs, requests }) => {
    (globalThis as any)[externalBoundary] = { retrieve: async () => pdfSession() };
    const response = await POST({ request: downloadRequest(), locals: { runtime: { env: { DOWNLOAD_TOKEN_SECRET: runtimeSecret } } } });
    assert.equal(response.status, 200);
    const result = await response.json();
    const token = new URL(result.downloadUrl).searchParams.get('token')!;
    const [data, signature] = token.split('.');
    assert.equal(signature, createHmac('sha256', runtimeSecret).update(data).digest('hex'));
    const claims = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
    assert.equal(claims.expiresAt - claims.issuedAt, 3600);
    let reads = 0;
    const download = await GET(secureContext(result.downloadUrl, {
      get: async (key: string) => { assert.equal(key, 'feed-the-fame.pdf'); reads++; return { body: 'protected PDF' }; },
    }, { DOWNLOAD_TOKEN_SECRET: runtimeSecret }));
    assert.equal(download.status, 200);
    assert.equal(await download.text(), 'protected PDF');
    assert.equal(reads, 1);
    assert.deepEqual(requests, []);
    assertPrivateLogs(logs, [runtimeSecret, token, result.downloadUrl]);
  });
});

test('runtime signing secret takes precedence over a different build-time secret', async () => {
  const runtimeSecret = 'private_runtime_priority_secret_fixture_only';
  const { POST } = await loadRoute('download-pdf', true);
  const { GET } = await loadRoute('secure-download');
  await capture(async () => {
    (globalThis as any)[externalBoundary] = { retrieve: async () => pdfSession() };
    const response = await POST({ request: downloadRequest(), locals: { runtime: { env: { DOWNLOAD_TOKEN_SECRET: runtimeSecret } } } });
    assert.equal(response.status, 200);
    const result = await response.json();
    const [data, signature] = new URL(result.downloadUrl).searchParams.get('token')!.split('.');
    assert.equal(signature, createHmac('sha256', runtimeSecret).update(data).digest('hex'));
    const accepted = await GET(secureContext(result.downloadUrl, { get: async () => ({ body: 'protected PDF' }) }, { DOWNLOAD_TOKEN_SECRET: runtimeSecret }));
    assert.equal(accepted.status, 200);
    let reads = 0;
    const rejected = await GET(secureContext(result.downloadUrl, { get: async () => { reads++; return { body: 'protected PDF' }; } }));
    assert.equal(rejected.status, 403);
    assert.equal(reads, 0);
  });
});

test('the known fallback hash forgery is rejected before accessing protected storage', async () => {
  const { GET } = await loadRoute('secure-download', false, { DOWNLOAD_TOKEN_SECRET: undefined });
  const claims = downloadClaims({ sessionId: 'cs_test_neverPaidFixture' });
  const legacyData = `${claims.sessionId}:${claims.customerEmail}:${claims.expiresAt}:${claims.productType}:${claims.nonce}`;
  let hash = 0;
  for (const byte of new TextEncoder().encode(`fallback-secret-key-change-in-production${legacyData}`)) {
    hash = ((hash << 5) - hash + byte) | 0;
  }
  const forged = `${btoa(JSON.stringify(claims))}.${Math.abs(hash).toString(16)}`;
  await capture(async ({ logs }) => {
    let reads = 0;
    const response = await GET(secureContext(tokenUrl(forged), {
      get: async () => { reads++; return { body: 'protected PDF' }; },
    }, { DOWNLOAD_TOKEN_SECRET: 'private_runtime_secret_ignored_by_legacy_code' }));
    assert.equal(response.status, 403);
    assert.equal(reads, 0);
    assertPrivateLogs(logs, [forged, claims.sessionId]);
  });
});

test('a valid externally signed token is accepted and a changed payload is rejected before storage', async () => {
  const { GET } = await loadRoute('secure-download');
  await capture(async () => {
    let reads = 0;
    const bucket = { get: async () => { reads++; return { body: 'protected PDF' }; } };
    const token = signedFixtureToken(downloadClaims());
    const accepted = await GET(secureContext(tokenUrl(token), bucket));
    assert.equal(accepted.status, 200);
    assert.equal(reads, 1);
    const changedData = Buffer.from(JSON.stringify(downloadClaims({ customerEmail: 'changed@example.invalid' }))).toString('base64');
    const changed = await GET(secureContext(tokenUrl(`${changedData}.${token.split('.')[1]}`), bucket));
    assert.equal(changed.status, 403);
    assert.equal(reads, 1);
  });
});

for (const [label, overrides] of [
  ['expiry exactly now', { issuedAt: 0, expiresAt: 3600 }],
  ['expired', { issuedAt: -1, expiresAt: 3599 }],
  ['future issuance', { issuedAt: 3601, expiresAt: 7201 }],
  ['longer than one hour', { issuedAt: 3600, expiresAt: 7201 }],
  ['reversed lifetime', { issuedAt: 3600, expiresAt: 3599 }],
  ['nonfinite expiry', { issuedAt: 3600, expiresAt: Infinity }],
  ['string expiry', { issuedAt: 3600, expiresAt: '7200' }],
  ['missing expiry', { expiresAt: undefined }],
  ['missing issuance', { issuedAt: undefined }],
  ['missing session', { sessionId: undefined }],
  ['empty session', { sessionId: '' }],
  ['missing email', { customerEmail: undefined }],
  ['missing nonce', { nonce: undefined }],
  ['wrong nonce shape', { nonce: 'short' }],
  ['missing product', { productType: undefined }],
  ['non-PDF product', { productType: 'other' }],
] as const) {
  test(`a signed token with ${label} is rejected before any storage access`, async () => {
    const { GET } = await loadRoute('secure-download');
    await capture(async () => {
      const originalNow = Date.now;
      try {
        Date.now = () => 3600 * 1000;
        let reads = 0;
        const token = signedFixtureToken(downloadClaims(overrides));
        const response = await GET(secureContext(tokenUrl(token), {
          get: async () => { reads++; return { body: 'protected PDF' }; },
        }));
        assert.equal(response.status, 403);
        assert.equal(reads, 0);
      } finally {
        Date.now = originalNow;
      }
    });
  });
}
