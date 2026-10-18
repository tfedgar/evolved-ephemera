import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import {
  handleCoachingCheckout,
  isCoachingCheckoutConfigured,
  readCheckoutEnvironment,
} from '../../lib/server/coaching-checkout';

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as { runtime?: { env?: Record<string, unknown> } }).runtime;
  const environment = readCheckoutEnvironment(
    runtime?.env,
    typeof process !== 'undefined' ? process.env : {},
  );
  const stripe = isCoachingCheckoutConfigured(environment)
    ? new Stripe(environment.STRIPE_COACHING_SECRET_KEY!)
    : undefined;
  return handleCoachingCheckout(request, environment, stripe);
};
