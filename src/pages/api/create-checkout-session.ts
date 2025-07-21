import type { APIRoute } from 'astro';
import Stripe from 'stripe';

// IMPORTANT: Set your Stripe secret key in your environment variables
const stripe = new Stripe(import.meta.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2025-06-30.basil',
});

export const POST: APIRoute = async ({ request }) => {
  let priceId: string | null = null;
  const contentType = request.headers.get('content-type') || '';
  
  console.log('Content-Type:', contentType);
  console.log('Request headers:', Object.fromEntries(request.headers.entries()));

  if (contentType.includes('application/json')) {
    const body = await request.json();
    console.log('Received JSON body:', body);
    priceId = body.priceId;
  } else if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    const formData = await request.formData();
    console.log('Received FormData:', Array.from(formData.entries()));
    priceId = formData.get('priceId') as string;
  } else {
    console.log('Content-Type not recognized:', contentType);
  }

  console.log('Extracted priceId:', priceId);

  if (!priceId) {
    console.error('Price ID is missing!');
    return new Response('Price ID is required', { status: 400 });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${request.headers.get('origin')}/pay?success=true`,
      cancel_url: `${request.headers.get('origin')}/pay?canceled=true`,
    });
    return Response.redirect(session.url!, 303);
  } catch (err) {
    return new Response('Error creating Stripe Checkout session', { status: 500 });
  }
}; 