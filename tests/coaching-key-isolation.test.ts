import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';

const asModule = (code: string) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
// Only the Stripe boundary is substituted. Both fixture accounts can return
// valid prices, but their checkout destinations identify which account was used.
const stripe = asModule(`export default class Stripe {
  constructor(key) { this.key = key; }
  prices = { retrieve: async (id) => {
    if (!['sk_test_coaching_fixture', 'sk_test_legacy_fixture'].includes(this.key) || id !== 'price_fixture3') throw new Error('Wrong fixture account');
    return {
      id, active: true, currency: 'usd', unit_amount: 50000, type: 'recurring',
      billing_scheme: 'per_unit', transform_quantity: null,
      recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed', meter: null, trial_period_days: null },
    };
  } };
  checkout = { sessions: { create: async () => {
    if (!['sk_test_coaching_fixture', 'sk_test_legacy_fixture'].includes(this.key)) throw new Error('Wrong fixture account');
    const id = this.key === 'sk_test_coaching_fixture' ? 'cs_test_keyIsolation' : 'cs_test_legacyKeyIsolation';
    return { id, url: 'https://checkout.stripe.com/c/pay/' + id };
  } } };
}`);
const routeSource = (await readFile(new URL('../src/pages/api/create-checkout-session.ts', import.meta.url), 'utf8'))
  .replace("import Stripe from 'stripe';", `import Stripe from ${JSON.stringify(stripe)};`)
  .replace("from '../../lib/server/coaching-checkout'", `from ${JSON.stringify(new URL('../src/lib/server/coaching-checkout.ts', import.meta.url).href)}`);
const { POST } = await import(asModule(stripTypeScriptTypes(routeSource, { mode: 'strip' })));

async function createCheckout(overrides: Record<string, unknown> = {}) {
  return POST({
    request: new Request('https://coachedgar.example/api/create-checkout-session', {
      method: 'POST',
      headers: { Origin: 'https://coachedgar.example' },
      body: new URLSearchParams({ plan: 'three-month', termsAcknowledged: 'yes' }),
    }),
    locals: { runtime: { env: {
      COACHING_CHECKOUT_ENABLED: 'true',
      STRIPE_COACHING_SECRET_KEY: 'sk_test_coaching_fixture',
      STRIPE_SECRET_KEY: '',
      STRIPE_COACHING_3_MONTH_PRICE_ID: 'price_fixture3',
      STRIPE_COACHING_6_MONTH_PRICE_ID: 'price_fixture6',
      STRIPE_COACHING_12_MONTH_PRICE_ID: 'price_fixture12',
      ...overrides,
    } } },
  });
}

test('the actual checkout route creates coaching checkout with only its dedicated credential', async () => {
  const response = await createCheckout();
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'https://checkout.stripe.com/c/pay/cs_test_keyIsolation');
});

test('the actual checkout route uses the coaching account when the legacy credential conflicts', async () => {
  const response = await createCheckout({ STRIPE_SECRET_KEY: 'sk_test_legacy_fixture' });
  assert.equal(response.headers.get('location'), 'https://checkout.stripe.com/c/pay/cs_test_keyIsolation');
});

for (const legacyKey of ['', 'sk_test_legacy_fixture']) {
  test(`the actual checkout route stays closed without a coaching credential${legacyKey ? ' even with a legacy credential' : ''}`, async () => {
    const response = await createCheckout({ STRIPE_COACHING_SECRET_KEY: '', STRIPE_SECRET_KEY: legacyKey });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/pay?error=unavailable&plan=three-month');
  });
}
