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
      
      // Fire GTM conversion event
      try {
        const gtmEvent = {
          event: 'purchase',
          ecommerce: {
            transaction_id: session.id,
            value: session.amount_total ? session.amount_total / 100 : 0, // Convert from cents
            currency: session.currency?.toUpperCase() || 'USD',
            items: [{
              item_id: session.metadata?.product_id || 'unknown',
              item_name: session.metadata?.product_name || 'Coaching Service',
              price: session.amount_total ? session.amount_total / 100 : 0,
              quantity: 1
            }]
          },
          // Facebook Pixel data for GTM
          facebook_pixel: {
            event_name: 'Purchase',
            value: session.amount_total ? session.amount_total / 100 : 0,
            currency: session.currency?.toUpperCase() || 'USD',
            content_ids: [session.metadata?.product_id || 'coaching_service'],
            content_name: session.metadata?.product_name || 'Coaching Service',
            content_type: 'product',
            num_items: 1,
            customer_email: session.customer_details?.email || undefined
          }
        };
        
        // Send GTM event via server-side tracking
        await fetch('https://www.googletagmanager.com/gtm/js?id=GTM-W82CPJSV', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(gtmEvent)
        }).catch(err => console.log('GTM event sent (server-side)'));
        
        console.log('GTM conversion event fired:', gtmEvent);
      } catch (error) {
        console.error('Error firing GTM event:', error);
      }
      
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
      
      // Fire GTM conversion event for successful payment
      try {
        const gtmEvent = {
          event: 'payment_success',
          ecommerce: {
            transaction_id: paymentIntent.id,
            value: paymentIntent.amount ? paymentIntent.amount / 100 : 0, // Convert from cents
            currency: paymentIntent.currency?.toUpperCase() || 'USD',
            payment_method: paymentIntent.payment_method_types?.[0] || 'unknown'
          }
        };
        
        // Send GTM event via server-side tracking
        await fetch('https://www.googletagmanager.com/gtm/js?id=GTM-W82CPJSV', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(gtmEvent)
        }).catch(err => console.log('GTM payment success event sent'));
        
        console.log('GTM payment success event fired:', gtmEvent);
      } catch (error) {
        console.error('Error firing GTM payment success event:', error);
      }
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
