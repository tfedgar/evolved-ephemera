import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { transform } from '@astrojs/compiler';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { parse } from 'parse5';

type PdfSession = {
  payment_status: string;
  metadata: { product_type: string };
  customer_details: { email: string };
};

const pagePath = new URL('../src/pages/download-pdf.astro', import.meta.url);
const layoutPath = new URL('../src/layouts/Layout.astro', import.meta.url);
const runtimeUrl = import.meta.resolve('astro/compiler-runtime');
const sessionId = 'cs_test_pdf_fixture';
const asModule = (code: string) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;

async function compile(source: string, filename: string) {
  // Vite normally extracts static client scripts; the container renders the SSR
  // markup here. The actual client script is exercised separately below.
  const serverSource = source.replace(/<script>[\s\S]*?<\/script>/g, '');
  const result = await transform(serverSource, { filename, internalURL: runtimeUrl, resultScopedSlot: true });
  // The standalone compiler emits legacy module metadata that the Astro 5
  // container does not consume. Keep its real rendering helpers and page logic.
  const code = result.code
    .replace(',\n  createMetadata as $$createMetadata', '')
    .replace(/^export const \$\$metadata = .*;\n/m, '');
  return asModule(stripTypeScriptTypes(code, { mode: 'strip' }));
}

const layoutSource = (await readFile(layoutPath, 'utf8')).replace('import "../styles/global.css";', '');
const layout = await compile(layoutSource, 'src/layouts/Layout.astro');
const navigation = await compile('<nav aria-label="Fixture navigation"></nav>', 'FixtureNavigation.astro');

async function renderPage(session: PdfSession, query = `?session_id=${sessionId}`) {
  // The actual layout (without its CSS import), download page, verification
  // branches and Astro attribute renderer execute. Navigation and Stripe alone
  // are fixtures; no real Stripe import or network request is permitted.
  const stripe = asModule(`export default class Stripe {
    checkout = { sessions: { retrieve: async (id) => {
      if (id !== ${JSON.stringify(sessionId)}) throw new Error('Fixture rejects forged session');
      return ${JSON.stringify(session)};
    } } };
  }`);
  const originalSource = await readFile(pagePath, 'utf8');
  assert.ok(originalSource.includes("import('stripe')"), 'the real provider import must be replaced before rendering');
  const source = originalSource
    .replace("import Layout from '../layouts/Layout.astro';", `import Layout from ${JSON.stringify(layout)};`)
    .replace("import Navigation from '../components/Navigation.astro';", `import Navigation from ${JSON.stringify(navigation)};`)
    .replace("import('stripe')", `import(${JSON.stringify(stripe)})`);
  const component = (await import(await compile(source, 'src/pages/download-pdf.astro'))).default;
  const container = await AstroContainer.create();
  const response = await container.renderToResponse(component, {
    request: new Request(`https://coachedgar.example/download-pdf${query}`),
    locals: { runtime: { env: { STRIPE_SECRET_KEY: 'sk_test_renderer_fixture' } } },
  });
  const html = await response.text();
  const document = parse(html);
  const elements: any[] = [];
  function visit(node: any) {
    if (node.tagName) elements.push(node);
    for (const child of node.childNodes || []) visit(child);
  }
  visit(document);
  const main = elements.find(node => node.tagName === 'main');
  return { response, html, elements, main };
}

async function runClient(rendered: Awaited<ReturnType<typeof renderPage>>, query = `?session_id=${sessionId}`, fail = false) {
  const source = await readFile(pagePath, 'utf8');
  const clientSource = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(clientSource, 'actual static client initializer exists');
  const nodes = new Map<string, any>();
  for (const node of rendered.elements) {
    const id = node.attrs.find((a: any) => a.name === 'id')?.value;
    if (!id) continue;
    const classes = new Set<string>();
    nodes.set(id, {
      dataset: { customerEmail: node.attrs.find((a: any) => a.name === 'data-customer-email')?.value },
      classList: { add: (value: string) => classes.add(value), remove: (value: string) => classes.delete(value) },
      addEventListener() {}, textContent: '', href: '#',
    });
  }
  const requests: Array<{ url: string; fields: [string, FormDataEntryValue][] }> = [];
  let initialize = () => {};
  runInNewContext(stripTypeScriptTypes(clientSource, { mode: 'strip' }), {
    document: {
      body: { dataset: { customerEmail: 'untrusted-body-value@example.com' } },
      getElementById: (id: string) => nodes.get(id) || null,
      addEventListener: (event: string, handler: () => void) => {
        if (event === 'DOMContentLoaded') initialize = handler;
      },
    },
    window: { location: { search: query } },
    URLSearchParams, FormData,
    fetch: async (url: string, options: { body: FormData }) => {
      requests.push({ url, fields: [...options.body.entries()] });
      return new Response(JSON.stringify(fail ? { error: 'private-provider-error' } : { downloadUrl: '/api/secure-download?token=fixture' }), { status: fail ? 502 : 200 });
    },
  }, { filename: 'download-page-client.ts' });
  initialize();
  await new Promise(resolve => setImmediate(resolve));
  return { requests, nodes };
}

function paidPdf(email: string): PdfSession {
  return { payment_status: 'paid', metadata: { product_type: 'pdf' }, customer_details: { email } };
}

test('the actual layout preserves private referrer policy, download metadata and a query-free canonical', async () => {
  for (const query of [`?session_id=${sessionId}`, '?success=true']) {
    const { response, elements } = await renderPage(paidPdf('reader@example.com'), query);
    const attrs = (node: any) => Object.fromEntries(node.attrs.map((a: any) => [a.name, a.value]));
    const metas = elements.filter(node => node.tagName === 'meta').map(attrs);
    const referrerPolicies = metas.filter(meta => meta.name === 'referrer');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.ok(referrerPolicies.every(meta => meta.content === 'no-referrer'), 'layout meta must not weaken the page response policy');
    assert.equal(metas.find(meta => meta.name === 'robots')?.content, 'noindex, follow');
    const title = elements.find(node => node.tagName === 'title');
    assert.equal(title.childNodes.map((node: any) => node.value || '').join(''), 'Your guide download | Coach Edgar');
    const links = elements.filter(node => node.tagName === 'link').map(attrs);
    assert.equal(links.find(link => link.rel === 'canonical')?.href, 'https://www.coachedgar.com/download-pdf');
    assert.equal(metas.find(meta => meta.property === 'og:url')?.content, 'https://www.coachedgar.com/download-pdf');
  }
});

test('a verified PDF email round-trips through one quoted attribute without creating HTML or script', async (t) => {
  const emails = [
    'reader@example.com',
    '</Script><img src=x onerror="globalThis.injected=1">"@example.com',
    '</script ><script>globalThis.injected=1</script>@example.com',
    '</script/><img src=x onerror="globalThis.injected=1">@example.com',
    '\" autofocus onfocus="globalThis.injected=1" data-forged="yes\'&<>@example.com',
  ];
  for (const email of emails) {
    await t.test(JSON.stringify(email), async () => {
      const { response, html, elements, main } = await renderPage(paidPdf(email));
      assert.equal(response.status, 200);
      assert.ok(main, 'actual page renders its main landmark');
      assert.ok(!elements.some(node => node.tagName === 'img'), 'payload cannot add image elements');
      assert.ok(!elements.some(node => node.attrs.some((a: any) => /^on|^autofocus$|^data-forged$/.test(a.name))), 'payload cannot add attributes');
      assert.ok(!elements.some(node => node.tagName === 'script' && JSON.stringify(node.childNodes).includes('injected')), 'payload cannot become executable script');
      assert.equal(main.attrs.find((a: any) => a.name === 'data-customer-email')?.value, email);
      assert.equal(main.attrs.filter((a: any) => a.name === 'data-customer-email').length, 1);
      assert.ok(html.includes('Payment verified'));
      assert.ok(elements.some(node => node.attrs.some((a: any) => a.name === 'id' && a.value === 'final-download-btn')));
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    });
  }
});

test('the static client sends the verified main dataset unchanged to the existing download endpoint', async () => {
  const email = '\"<&</Script>\'@example.com';
  const client = await runClient(await renderPage(paidPdf(email)));
  assert.equal(client.requests.length, 1);
  assert.equal(client.requests[0].url, '/api/download-pdf');
  assert.deepEqual(client.requests[0].fields, [['sessionId', sessionId], ['customerEmail', email]]);
  assert.equal(client.nodes.get('final-download-btn').href, '/api/secure-download?token=fixture');
});

test('an invalid page cannot initiate download and provider failures show only a generic client message', async () => {
  const invalid = await runClient(await renderPage(paidPdf('hidden@example.com'), '?success=true'), '?success=true');
  assert.equal(invalid.requests.length, 0);
  const failed = await runClient(await renderPage(paidPdf('reader@example.com')), undefined, true);
  assert.equal(failed.requests.length, 1);
  assert.equal(failed.nodes.get('error-message').textContent, 'We could not prepare your download. Please try again or email support.');
  assert.ok(!failed.nodes.get('error-message').textContent.includes('private-provider-error'));
});

test('rendering does not write customer email or session diagnostics to the console', async (t) => {
  const diagnostics: unknown[] = [];
  t.mock.method(console, 'log', (...args: unknown[]) => diagnostics.push(args));
  t.mock.method(console, 'error', (...args: unknown[]) => diagnostics.push(args));
  try {
    await renderPage(paidPdf('private@example.com'));
    await renderPage(paidPdf('private@example.com'), '?session_id=forged');
  } finally {
    t.mock.restoreAll();
  }
  assert.deepEqual(diagnostics, []);
});

test('unpaid, unrelated and forged sessions disclose no email or protected download', async (t) => {
  const email = 'must-not-disclose@example.com';
  const cases = [
    { name: 'no session, forged success query', session: paidPdf(email), query: '?success=true' },
    { name: 'unpaid PDF', session: { ...paidPdf(email), payment_status: 'unpaid' } },
    { name: 'paid non-PDF', session: { ...paidPdf(email), metadata: { product_type: 'coaching' } } },
    { name: 'forged session ID', session: paidPdf(email), query: '?session_id=forged&success=true' },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const { html, elements, main, response } = await renderPage(scenario.session, scenario.query);
      assert.equal(main.attrs.find((a: any) => a.name === 'data-customer-email')?.value, '');
      assert.ok(!html.includes(email));
      assert.ok(!html.includes('Payment verified'));
      assert.ok(html.includes('Invalid Access'));
      assert.ok(!elements.some(node => node.attrs.some((a: any) => a.name === 'id' && a.value === 'final-download-btn')));
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    });
  }
});
