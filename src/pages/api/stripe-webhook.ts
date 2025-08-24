import Stripe from 'stripe';
import type { APIRoute } from 'astro';

const stripe = new Stripe(import.meta.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2023-10-16' as any,
});

const endpointSecret = import.meta.env.STRIPE_WEBHOOK_SECRET as string;

export const POST: APIRoute = async ({ request }) => {
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, sig!, endpointSecret);
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return new Response(
      JSON.stringify({ error: 'Webhook signature verification failed' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object as Stripe.Checkout.Session;
      
      // Check if this is a PDF purchase
      if (session.metadata?.product_type === 'pdf') {
        try {
          // Generate download link for the customer
          const customerEmail = session.customer_details?.email;
          const sessionId = session.id;
          
          if (customerEmail && sessionId) {
            // Create a download link that the customer can use
            const downloadUrl = `${new URL(request.url).origin}/download-pdf?sessionId=${sessionId}&email=${encodeURIComponent(customerEmail)}`;
            
            console.log('PDF purchase completed:', {
              sessionId: session.id,
              customerEmail: customerEmail,
              productName: session.metadata.product_name,
              amount: session.amount_total,
              downloadUrl: downloadUrl
            });
            
            // In a production environment, you would:
            // 1. Send an email with the download link
            // 2. Store the purchase record in a database
            // 3. Log the transaction for analytics
            
            // For now, we'll just log the successful purchase
            // The customer will be redirected to the download page after payment
          }
          
        } catch (error) {
          console.error('Error processing PDF purchase:', error);
          return new Response(
            JSON.stringify({ error: 'Failed to process PDF purchase' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
      break;
      
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      console.log('Payment succeeded:', paymentIntent.id);
      break;
      
    case 'payment_intent.payment_failed':
      const failedPayment = event.data.object as Stripe.PaymentIntent;
      console.log('Payment failed:', failedPayment.id);
      break;
      
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  return new Response(
    JSON.stringify({ received: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
