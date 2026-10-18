import Stripe from 'stripe';
import type { APIRoute } from 'astro';

const stripe = new Stripe(import.meta.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2023-10-16' as any,
});

const endpointSecret = import.meta.env.STRIPE_WEBHOOK_SECRET as string;
const skipSignatureVerification = import.meta.env.SKIP_WEBHOOK_VERIFICATION === 'true';

export const POST: APIRoute = async ({ request }) => {
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');
  let event: Stripe.Event;

  try {
    if (skipSignatureVerification) {
      event = JSON.parse(body) as Stripe.Event;
    } else {
      if (!endpointSecret) {
        throw new Error('STRIPE_WEBHOOK_SECRET environment variable is not set');
      }

      event = stripe.webhooks.constructEvent(body, sig!, endpointSecret);
    }

    if (event == null) {
      throw new Error('Invalid webhook event');
    }
  } catch {
    console.error('Webhook signature verification failed');

    return new Response(
      JSON.stringify({ error: 'Webhook signature verification failed' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // PDF fulfillment is handled by the verified download routes.
  return new Response(
    JSON.stringify({ received: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
