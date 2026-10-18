import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  handleCoachingCheckout,
  getCoachingReturnState,
  getCoachingEnrollmentState,
  readCheckoutEnvironment,
  type CheckoutEnvironment,
  type CheckoutPrice,
  type CheckoutProvider,
  type CheckoutSession,
} from '../src/lib/server/coaching-checkout.ts';
import type Stripe from 'stripe';

const environment: CheckoutEnvironment = {
  COACHING_CHECKOUT_ENABLED: 'true',
  STRIPE_COACHING_SECRET_KEY: 'sk_test_fixture',
  STRIPE_COACHING_3_MONTH_PRICE_ID: 'price_coaching3',
  STRIPE_COACHING_6_MONTH_PRICE_ID: 'price_coaching6',
  STRIPE_COACHING_12_MONTH_PRICE_ID: 'price_coaching12',
};

function price(overrides: Partial<CheckoutPrice> = {}): CheckoutPrice {
  return {
    id: 'price_coaching6', active: true, currency: 'usd', unit_amount: 45000,
    type: 'recurring', billing_scheme: 'per_unit', transform_quantity: null,
    recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed', meter: null, trial_period_days: null },
    ...overrides,
  };
}

function session(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  return {
    id: 'cs_test_verified123', mode: 'subscription', status: 'complete', payment_status: 'paid',
    currency: 'usd', amount_subtotal: 45000,
    metadata: {
      offer: 'coach-edgar-coaching-v1', plan_id: 'six-month', minimum_months: '6',
      monthly_usd: '450', minimum_commitment_usd: '2700',
      billing: 'monthly-until-cancelled', terms_acknowledged: 'yes',
    },
    ...overrides,
  };
}

function fixture(options: { price?: CheckoutPrice; session?: CheckoutSession; fail?: 'price' | 'create' | 'retrieve'; checkoutUrl?: string | null } = {}) {
  const created: Stripe.Checkout.SessionCreateParams[] = [];
  const retrievedPrices: string[] = [];
  const retrievedSessions: string[] = [];
  const provider: CheckoutProvider = {
    prices: { async retrieve(id) {
      retrievedPrices.push(id);
      if (options.fail === 'price') throw new Error('Sensitive provider error: sk_test_do_not_expose');
      return options.price ?? price();
    } },
    checkout: { sessions: {
      async create(params) {
        if (options.fail === 'create') throw new Error('Sensitive provider error: sk_test_do_not_expose');
        created.push(params);
        return { id: 'cs_test_created123', url: options.checkoutUrl === undefined ? 'https://checkout.stripe.com/c/pay/cs_test_created123' : options.checkoutUrl };
      },
      async retrieve(id) {
        retrievedSessions.push(id);
        if (options.fail === 'retrieve') throw new Error('Sensitive provider error: sk_test_do_not_expose');
        return options.session ?? session();
      },
    } },
  };
  return { provider, created, retrievedPrices, retrievedSessions };
}

function request(fields: Array<[string, string]> = [['plan', 'six-month'], ['termsAcknowledged', 'yes']]) {
  return new Request('https://coachedgar.com/api/create-checkout-session', {
    method: 'POST', body: new URLSearchParams(fields), headers: { Origin: 'https://coachedgar.com' },
  });
}

test('legacy credentials from runtime or process fallback cannot enable coaching checkout', async () => {
  const { STRIPE_COACHING_SECRET_KEY: _omitted, ...publicConfiguration } = environment;
  const legacyOnly = { ...publicConfiguration, STRIPE_SECRET_KEY: 'sk_test_legacy_fixture' };
  for (const [runtime, fallback] of [[legacyOnly, {}], [{}, legacyOnly], [legacyOnly, legacyOnly]]) {
    const external = fixture();
    const response = await handleCoachingCheckout(request(), readCheckoutEnvironment(runtime, fallback), external.provider);
    assert.equal(response.headers.get('location'), '/pay?error=unavailable&plan=six-month');
    assert.equal(external.retrievedPrices.length, 0);
    assert.equal(external.created.length, 0);
  }
});

test('a dedicated coaching credential from process fallback enables the agreed checkout', async () => {
  const external = fixture();
  const response = await handleCoachingCheckout(request(), readCheckoutEnvironment({}, environment), external.provider);
  assert.equal(response.headers.get('location'), 'https://checkout.stripe.com/c/pay/cs_test_created123');
});

test('a six-month selection creates the agreed ongoing USD monthly subscription and returns a 303', async () => {
  const external = fixture();
  const response = await handleCoachingCheckout(request(), environment, external.provider);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'https://checkout.stripe.com/c/pay/cs_test_created123');
  assert.deepEqual(external.retrievedPrices, ['price_coaching6']);
  assert.equal(external.created.length, 1);
  const params = external.created[0];
  assert.equal(params.mode, 'subscription');
  assert.deepEqual(params.line_items, [{ price: 'price_coaching6', quantity: 1 }]);
  assert.equal(params.success_url, 'https://coachedgar.com/pay?session_id={CHECKOUT_SESSION_ID}');
  assert.equal(params.cancel_url, 'https://coachedgar.com/pay?canceled=true&plan=six-month');
  assert.deepEqual(params.metadata, {
    offer: 'coach-edgar-coaching-v1', plan_id: 'six-month', minimum_months: '6', monthly_usd: '450',
    minimum_commitment_usd: '2700', billing: 'monthly-until-cancelled', terms_acknowledged: 'yes',
  });
  assert.deepEqual(params.subscription_data?.metadata, params.metadata);
  const submit = params.custom_text?.submit;
  assert.ok(submit && typeof submit === 'object');
  assert.match(submit.message, /450 USD.*month.*6.month.*2,700 USD.*until cancelled/i);
  assert.equal(params.subscription_data?.trial_period_days, undefined);
  assert.equal(params.subscription_data?.billing_cycle_anchor, undefined);
});

for (const [plan, id, cents, minimum] of [
  ['three-month', 'price_coaching3', 50000, '1500'],
  ['twelve-month', 'price_coaching12', 40000, '4800'],
] as const) {
  test(`${plan} uses its server-owned price and correct minimum commitment`, async () => {
    const external = fixture({ price: price({ id, unit_amount: cents }) });
    const response = await handleCoachingCheckout(request([['plan', plan], ['termsAcknowledged', 'yes']]), environment, external.provider);
    assert.equal(response.headers.get('location'), 'https://checkout.stripe.com/c/pay/cs_test_created123');
    assert.deepEqual(external.retrievedPrices, [id]);
    assert.deepEqual(external.created[0].line_items, [{ price: id, quantity: 1 }]);
    assert.equal(external.created[0].metadata?.minimum_commitment_usd, minimum);
  });
}

for (const [plan, id, cents] of [
  ['three-month', 'price_coaching3', 50000],
  ['six-month', 'price_coaching6', 45000],
  ['twelve-month', 'price_coaching12', 40000],
] as const) {
  test(`${plan} hosted checkout discloses the guarantee exception to the minimum commitment`, async () => {
    const external = fixture({ price: price({ id, unit_amount: cents }) });
    await handleCoachingCheckout(request([['plan', plan], ['termsAcknowledged', 'yes']]), environment, external.provider);
    const submit = external.created[0]?.custom_text?.submit;
    assert.ok(submit && typeof submit === 'object', 'checkout must include its payment disclosure');
    assert.match(submit.message, /minimum commitment[^.]*subject to[^.]*14.day guarantee/i);
    assert.match(submit.message, /new clients[^.]*once per person/i);
    assert.match(submit.message, /refund[^.]*full first monthly coaching payment[^.]*applicable tax/i);
    assert.match(submit.message, /email info@coachedgar\.com within 14 calendar days of (?:the )?agreed coaching start/i);
    assert.match(submit.message, /timely claim[^.]*cancels coaching and billing[^.]*waives[^.]*remaining minimum commitment/i);
    assert.match(submit.message, /independently billed clinic[^.]*lab[^.]*medication[^.]*excluded/i);
    assert.match(submit.message, /agree[^.]*start date[^.]*first.payment date[^.]*claim deadline[^.]*before pay/i);
    assert.match(submit.message, /https:\/\/coachedgar\.com\/terms#coaching-guarantee/);
  });
}

for (const [name, overrides] of [
  ['wrong amount', { unit_amount: 50000 }],
  ['wrong currency', { currency: 'gbp' }],
  ['inactive price', { active: false }],
  ['annual interval', { recurring: { ...price().recurring!, interval: 'year' } }],
  ['three-month billing interval', { recurring: { ...price().recurring!, interval_count: 3 } }],
  ['one-time price', { type: 'one_time', recurring: null }],
  ['wrong returned price ID', { id: 'price_legacy' }],
  ['metered billing', { recurring: { ...price().recurring!, usage_type: 'metered' } }],
  ['quantity transformation', { transform_quantity: { divide_by: 10, round: 'up' } }],
  ['tiered pricing', { billing_scheme: 'tiered' }],
] as const) {
  test(`a ${name} cannot create checkout under the displayed six-month rate`, async () => {
    const external = fixture({ price: price(overrides as Partial<CheckoutPrice>) });
    const response = await handleCoachingCheckout(request(), environment, external.provider);
    assert.equal(response.status, 303);
    assert.equal(new URL(response.headers.get('location')!, 'https://coachedgar.com').searchParams.get('error'), 'unavailable');
    assert.equal(external.created.length, 0);
  });
}

for (const [name, fields, error] of [
  ['unknown plan', [['plan', 'one-month'], ['termsAcknowledged', 'yes']], 'invalid-selection'],
  ['missing selection', [['termsAcknowledged', 'yes']], 'invalid-selection'],
  ['duplicate selection', [['plan', 'six-month'], ['plan', 'three-month'], ['termsAcknowledged', 'yes']], 'invalid-selection'],
  ['arbitrary legacy price ID', [['plan', 'six-month'], ['priceId', 'price_legacy'], ['termsAcknowledged', 'yes']], 'invalid-selection'],
  ['quantity override', [['plan', 'six-month'], ['quantity', '2'], ['termsAcknowledged', 'yes']], 'invalid-selection'],
  ['mode override', [['plan', 'six-month'], ['mode', 'payment'], ['termsAcknowledged', 'yes']], 'invalid-selection'],
  ['missing acknowledgement', [['plan', 'six-month']], 'terms-required'],
  ['false acknowledgement', [['plan', 'six-month'], ['termsAcknowledged', 'false']], 'terms-required'],
  ['duplicate acknowledgement', [['plan', 'six-month'], ['termsAcknowledged', 'yes'], ['termsAcknowledged', 'yes']], 'terms-required'],
] as const) {
  test(`${name} is rejected before contacting Stripe`, async () => {
    const external = fixture();
    const response = await handleCoachingCheckout(request(fields.map(([key, value]) => [key, value])), environment, external.provider);
    assert.equal(new URL(response.headers.get('location')!, 'https://coachedgar.com').searchParams.get('error'), error);
    assert.equal(external.retrievedPrices.length, 0);
    assert.equal(external.created.length, 0);
  });
}

for (const [name, changes] of [
  ['default-disabled gate', { COACHING_CHECKOUT_ENABLED: undefined }],
  ['false gate', { COACHING_CHECKOUT_ENABLED: 'false' }],
  ['missing new price mapping', { STRIPE_COACHING_6_MONTH_PRICE_ID: undefined }],
  ['missing coaching secret key', { STRIPE_COACHING_SECRET_KEY: undefined }],
] as const) {
  test(`${name} gives a recoverable unavailable redirect without using old prices`, async () => {
    const external = fixture();
    const response = await handleCoachingCheckout(request(), { ...environment, ...changes }, external.provider);
    assert.equal(new URL(response.headers.get('location')!, 'https://coachedgar.com').searchParams.get('error'), 'unavailable');
    assert.equal(external.retrievedPrices.length, 0);
    assert.equal(external.created.length, 0);
  });
}

for (const fail of ['price', 'create'] as const) {
  test(`Stripe ${fail} error is recoverable and cannot expose provider details`, async () => {
    const external = fixture({ fail });
    const response = await handleCoachingCheckout(request(), environment, external.provider);
    assert.equal(new URL(response.headers.get('location')!, 'https://coachedgar.com').searchParams.get('error'), 'unavailable');
    assert.doesNotMatch(response.headers.get('location')!, /sk_test|Sensitive/);
    assert.doesNotMatch(await response.text(), /sk_test|Sensitive/);
    assert.equal(external.created.length, 0);
  });
}

for (const origin of ['https://unrelated.example', 'null']) {
  test(`a form submission with Origin:${origin} is rejected before contacting Stripe`, async () => {
    const external = fixture();
    const incoming = request();
    incoming.headers.set('Origin', origin);
    const response = await handleCoachingCheckout(incoming, environment, external.provider);
    assert.equal(new URL(response.headers.get('location')!, 'https://coachedgar.com').searchParams.get('error'), 'invalid-selection');
    assert.equal(external.retrievedPrices.length, 0);
    assert.equal(external.created.length, 0);
  });
}

test('malformed form bodies return to enrolment with a recoverable message', async () => {
  const external = fixture();
  const incoming = new Request('https://coachedgar.com/api/create-checkout-session', { method: 'POST', body: '{broken', headers: { 'Content-Type': 'application/json' } });
  const response = await handleCoachingCheckout(incoming, environment, external.provider);
  assert.equal(new URL(response.headers.get('location')!, 'https://coachedgar.com').searchParams.get('error'), 'invalid-selection');
  assert.equal(external.created.length, 0);
});

test('missing or non-Stripe checkout URLs cannot redirect a client to an arbitrary destination', async () => {
  for (const checkoutUrl of [null, 'https://unrelated.example/checkout', 'javascript:alert(1)']) {
    const external = fixture({ checkoutUrl });
    const response = await handleCoachingCheckout(request(), environment, external.provider);
    assert.equal(new URL(response.headers.get('location')!, 'https://coachedgar.com').searchParams.get('error'), 'unavailable');
  }
});

test('a success query alone never confirms payment', async () => {
  const external = fixture();
  assert.equal(await getCoachingReturnState(new URL('https://coachedgar.com/pay?success=true'), external.provider), 'unverified');
  assert.equal(external.retrievedSessions.length, 0);
});

test('an ordinary visit has no payment status', async () => {
  assert.equal(await getCoachingReturnState(new URL('https://coachedgar.com/pay')), 'none');
});

test('a complete paid coaching session is verified on the server', async () => {
  const external = fixture();
  assert.equal(await getCoachingReturnState(new URL('https://coachedgar.com/pay?session_id=cs_test_verified123'), external.provider), 'confirmed');
  assert.deepEqual(external.retrievedSessions, ['cs_test_verified123']);
});

for (const [name, overrides, expected] of [
  ['unpaid complete', { payment_status: 'unpaid' }, 'processing'],
  ['open', { status: 'open', payment_status: 'unpaid' }, 'processing'],
  ['expired', { status: 'expired', payment_status: 'unpaid' }, 'cancelled'],
  ['unrelated PDF', { mode: 'payment', metadata: { product: 'pdf' } }, 'unverified'],
  ['wrong amount', { amount_subtotal: 50000 }, 'unverified'],
  ['wrong currency', { currency: 'gbp' }, 'unverified'],
  ['missing offer metadata', { metadata: null }, 'unverified'],
  ['wrong returned session', { id: 'cs_test_different123' }, 'unverified'],
] as const) {
  test(`${name} return cannot show a confirmed coaching payment`, async () => {
    const external = fixture({ session: session(overrides as Partial<CheckoutSession>) });
    assert.equal(await getCoachingReturnState(new URL('https://coachedgar.com/pay?session_id=cs_test_verified123'), external.provider), expected);
  });
}

test('unavailable session lookup never claims success', async () => {
  const external = fixture({ fail: 'retrieve' });
  const url = new URL('https://coachedgar.com/pay?success=true&session_id=cs_test_verified123');
  assert.equal(await getCoachingReturnState(url, external.provider), 'unverified');
  assert.equal(await getCoachingReturnState(url), 'unverified');
});

test('invalid or duplicated session IDs are rejected without contacting Stripe', async () => {
  for (const query of ['session_id=bogus', 'session_id=cs_test_verified123&session_id=cs_test_other123']) {
    const external = fixture();
    assert.equal(await getCoachingReturnState(new URL(`https://coachedgar.com/pay?${query}`), external.provider), 'unverified');
    assert.equal(external.retrievedSessions.length, 0);
  }
});

for (const [expectedPlan, minimum, conflictingPlan] of [
  [{ id: 'three-month', months: 3, monthlyUsd: 500, name: '3 months' }, '1500', 'six-month'],
  [{ id: 'six-month', months: 6, monthlyUsd: 450, name: '6 months' }, '2700', 'twelve-month'],
  [{ id: 'twelve-month', months: 12, monthlyUsd: 400, name: '12 months' }, '4800', 'three-month'],
] as const) {
  const paidSession = session({
    amount_subtotal: expectedPlan.monthlyUsd * 100,
    metadata: {
      offer: 'coach-edgar-coaching-v1', plan_id: expectedPlan.id,
      minimum_months: String(expectedPlan.months), monthly_usd: String(expectedPlan.monthlyUsd),
      minimum_commitment_usd: minimum, billing: 'monthly-until-cancelled', terms_acknowledged: 'yes',
    },
  });

  test(`a verified ${expectedPlan.id} payment selects its actual program and monthly amount on the enrollment page`, async () => {
    const external = fixture({ session: paidSession });
    const result = await getCoachingEnrollmentState(new URL('https://coachedgar.com/pay?session_id=cs_test_verified123'), external.provider);
    assert.equal(result.returnState, 'confirmed');
    assert.deepEqual(result.selectedPlan, expectedPlan);
    assert.equal(external.retrievedSessions.length, 1);
  });

  test(`a conflicting plan query cannot override a verified ${expectedPlan.id} payment's displayed program`, async () => {
    const external = fixture({ session: paidSession });
    const result = await getCoachingEnrollmentState(new URL(`https://coachedgar.com/pay?session_id=cs_test_verified123&plan=${conflictingPlan}`), external.provider);
    assert.equal(result.returnState, 'confirmed');
    assert.deepEqual(result.selectedPlan, expectedPlan);
  });
}

test('ordinary enrollment preserves a valid public program query without claiming payment', async () => {
  const result = await getCoachingEnrollmentState(new URL('https://coachedgar.com/pay?plan=six-month'));
  assert.equal(result.returnState, 'none');
  assert.deepEqual(result.selectedPlan, { id: 'six-month', months: 6, monthlyUsd: 450, name: '6 months' });
});

test('ordinary enrollment with an invalid selection keeps the three-month default', async () => {
  const result = await getCoachingEnrollmentState(new URL('https://coachedgar.com/pay?plan=one-month'));
  assert.equal(result.returnState, 'none');
  assert.deepEqual(result.selectedPlan, { id: 'three-month', months: 3, monthlyUsd: 500, name: '3 months' });
});

test('an unverified session cannot supply the enrollment program', async () => {
  const external = fixture({ session: session({ payment_status: 'paid', amount_subtotal: 50000 }) });
  const result = await getCoachingEnrollmentState(new URL('https://coachedgar.com/pay?session_id=cs_test_verified123&plan=three-month'), external.provider);
  assert.equal(result.returnState, 'unverified');
  assert.deepEqual(result.selectedPlan, { id: 'three-month', months: 3, monthlyUsd: 500, name: '3 months' });
});
