import type Stripe from 'stripe';
import { COACHING_PLANS, type CoachingPlan, type CoachingPlanId } from '../coaching-plans.ts';

export type CheckoutEnvironment = Partial<Record<
  | 'COACHING_CHECKOUT_ENABLED'
  | 'STRIPE_COACHING_SECRET_KEY'
  | 'STRIPE_COACHING_3_MONTH_PRICE_ID'
  | 'STRIPE_COACHING_6_MONTH_PRICE_ID'
  | 'STRIPE_COACHING_12_MONTH_PRICE_ID', string>>;

export type CheckoutPrice = Pick<Stripe.Price,
  'id' | 'active' | 'currency' | 'unit_amount' | 'type' | 'recurring' | 'billing_scheme' | 'transform_quantity'>;

export type CheckoutSession = Pick<Stripe.Checkout.Session,
  'id' | 'mode' | 'status' | 'payment_status' | 'metadata' | 'currency' | 'amount_subtotal'>;

export interface CheckoutProvider {
  prices: { retrieve(id: string): Promise<CheckoutPrice> };
  checkout: { sessions: {
    create(params: Stripe.Checkout.SessionCreateParams): Promise<{ id: string; url: string | null }>;
    retrieve(id: string): Promise<CheckoutSession>;
  } };
}

const PRICE_BINDINGS: Record<CoachingPlanId, keyof CheckoutEnvironment> = {
  'three-month': 'STRIPE_COACHING_3_MONTH_PRICE_ID',
  'six-month': 'STRIPE_COACHING_6_MONTH_PRICE_ID',
  'twelve-month': 'STRIPE_COACHING_12_MONTH_PRICE_ID',
};

export function readCheckoutEnvironment(
  runtimeEnv?: Record<string, unknown>,
  fallback: Record<string, unknown> = {},
): CheckoutEnvironment {
  const result: CheckoutEnvironment = {};
  // Coaching must never borrow the legacy PDF account's generic Stripe key.
  const keys: Array<keyof CheckoutEnvironment> = [
    'COACHING_CHECKOUT_ENABLED', 'STRIPE_COACHING_SECRET_KEY', ...Object.values(PRICE_BINDINGS),
  ];
  for (const key of keys) {
    const value = runtimeEnv?.[key] ?? fallback[key];
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

export function isCoachingCheckoutConfigured(environment: CheckoutEnvironment): boolean {
  return environment.COACHING_CHECKOUT_ENABLED === 'true'
    && Boolean(environment.STRIPE_COACHING_SECRET_KEY?.trim())
    && Object.values(PRICE_BINDINGS).every(key => /^price_[A-Za-z0-9]+$/.test(environment[key] ?? ''));
}

function planForId(value: unknown): CoachingPlan | undefined {
  return COACHING_PLANS.find(plan => plan.id === value);
}

function metadataFor(plan: CoachingPlan): Record<string, string> {
  return {
    offer: 'coach-edgar-coaching-v1',
    plan_id: plan.id,
    minimum_months: String(plan.months),
    monthly_usd: String(plan.monthlyUsd),
    minimum_commitment_usd: String(plan.months * plan.monthlyUsd),
    billing: 'monthly-until-cancelled',
    terms_acknowledged: 'yes',
  };
}

function priceMatches(price: CheckoutPrice, expectedId: string, plan: CoachingPlan): boolean {
  // Convert whole USD to integer cents once, at the payment boundary.
  return price.id === expectedId
    && price.active === true
    && price.currency === 'usd'
    && price.unit_amount === plan.monthlyUsd * 100
    && price.type === 'recurring'
    && price.billing_scheme === 'per_unit'
    && price.transform_quantity === null
    && price.recurring?.interval === 'month'
    && price.recurring.interval_count === 1
    && price.recurring.usage_type === 'licensed';
}

function recover(error: 'invalid-selection' | 'terms-required' | 'unavailable', plan?: CoachingPlan): Response {
  const query = new URLSearchParams({ error });
  if (plan) query.set('plan', plan.id);
  return new Response(null, {
    status: 303,
    headers: { Location: `/pay?${query}`, 'Cache-Control': 'no-store' },
  });
}

export async function handleCoachingCheckout(
  request: Request,
  environment: CheckoutEnvironment,
  provider?: CheckoutProvider,
): Promise<Response> {
  const origin = new URL(request.url).origin;
  const requestOrigin = request.headers.get('Origin');
  if (requestOrigin && requestOrigin !== origin) return recover('invalid-selection');

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return recover('invalid-selection');
  }

  const selections = form.getAll('plan');
  const plan = selections.length === 1 ? planForId(selections[0]) : undefined;
  if (!plan || Array.from(form.keys()).some(key => key !== 'plan' && key !== 'termsAcknowledged')) {
    return recover('invalid-selection');
  }
  const acknowledgement = form.getAll('termsAcknowledged');
  if (acknowledgement.length !== 1 || acknowledgement[0] !== 'yes') return recover('terms-required', plan);

  // Enable only after the matching prices and operational cancellation/refund
  // terms have been verified for this offer. There is no legacy price fallback.
  if (!isCoachingCheckoutConfigured(environment) || !provider) return recover('unavailable', plan);
  const priceId = environment[PRICE_BINDINGS[plan.id]]!;

  try {
    const price = await provider.prices.retrieve(priceId);
    if (!priceMatches(price, priceId, plan)) return recover('unavailable', plan);

    const metadata = metadataFor(plan);
    const minimum = (plan.months * plan.monthlyUsd).toLocaleString('en-US');
    const session = await provider.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/pay?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pay?canceled=true&plan=${plan.id}`,
      metadata,
      subscription_data: { metadata },
      custom_text: {
        submit: {
          message: `${plan.monthlyUsd} USD per month. ${plan.months}-month minimum commitment (${minimum} USD), subject to the 14-day guarantee, then continues monthly at the same rate until cancelled. New clients, once per person: refund of the full first monthly coaching payment plus applicable tax. Email info@coachedgar.com within 14 calendar days of the agreed coaching start. A timely claim cancels coaching and billing and waives the remaining minimum commitment. Independently billed clinic, lab and medication charges are excluded. Agree your coaching start date (your first-payment date), billing arrangements and guarantee claim deadline before paying. Full terms: ${origin}/terms#coaching-guarantee`,
        },
      },
    });

    if (!session.url) return recover('unavailable', plan);
    const destination = new URL(session.url);
    if (destination.origin !== 'https://checkout.stripe.com' || destination.username || destination.password) {
      return recover('unavailable', plan);
    }
    return new Response(null, {
      status: 303,
      headers: { Location: destination.href, 'Cache-Control': 'no-store' },
    });
  } catch {
    // Provider errors may contain private account details. Return a fixed message.
    return recover('unavailable', plan);
  }
}

export type CoachingReturnState = 'none' | 'unverified' | 'confirmed' | 'processing' | 'cancelled';

export async function getCoachingEnrollmentState(
  url: URL,
  provider?: CheckoutProvider,
): Promise<{ returnState: CoachingReturnState; selectedPlan: CoachingPlan }> {
  const { returnState, plan } = await verifyCoachingReturn(url, provider);
  // A verified session owns the displayed offer. A plan query only preselects
  // a program for an ordinary or unverified visit.
  const selectedPlan = plan ?? planForId(url.searchParams.get('plan')) ?? COACHING_PLANS[0];
  return { returnState, selectedPlan };
}

export async function getCoachingReturnState(
  url: URL,
  provider?: CheckoutProvider,
): Promise<CoachingReturnState> {
  const { returnState } = await verifyCoachingReturn(url, provider);
  return returnState;
}

async function verifyCoachingReturn(
  url: URL,
  provider?: CheckoutProvider,
): Promise<{ returnState: CoachingReturnState; plan?: CoachingPlan }> {
  const sessionIds = url.searchParams.getAll('session_id');
  if (sessionIds.length === 0) {
    if (url.searchParams.has('success')) return { returnState: 'unverified' };
    return { returnState: url.searchParams.get('canceled') === 'true' ? 'cancelled' : 'none' };
  }
  const [sessionId] = sessionIds;
  if (sessionIds.length !== 1 || !/^cs_(?:test_|live_)?[A-Za-z0-9]{1,230}$/.test(sessionId) || !provider) {
    return { returnState: 'unverified' };
  }

  try {
    const session = await provider.checkout.sessions.retrieve(sessionId);
    const plan = planForId(session.metadata?.plan_id);
    if (!plan || session.id !== sessionId || session.mode !== 'subscription' || session.currency !== 'usd'
      || session.amount_subtotal !== plan.monthlyUsd * 100) return { returnState: 'unverified' };
    const expected = metadataFor(plan);
    if (!Object.entries(expected).every(([key, value]) => session.metadata?.[key] === value)) return { returnState: 'unverified' };

    if (session.status === 'complete' && session.payment_status === 'paid') return { returnState: 'confirmed', plan };
    if (session.status === 'expired') return { returnState: 'cancelled', plan };
    if (session.status === 'open' || session.status === 'complete') return { returnState: 'processing', plan };
    return { returnState: 'unverified' };
  } catch {
    return { returnState: 'unverified' };
  }
}
