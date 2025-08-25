import Stripe from 'stripe';
import type { APIRoute } from 'astro';

const stripe = new Stripe(import.meta.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2023-10-16' as any,
});

const endpointSecret = import.meta.env.STRIPE_WEBHOOK_SECRET as string;
const isDevelopment = import.meta.env.DEV;
const skipSignatureVerification = import.meta.env.SKIP_WEBHOOK_VERIFICATION === 'true';

export const POST: APIRoute = async ({ request }) => {
  console.log('=== WEBHOOK RECEIVED ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('User Agent:', request.headers.get('user-agent'));
  console.log('Content Type:', request.headers.get('content-type'));
  console.log('Environment:', isDevelopment ? 'Development' : 'Production');
  console.log('Skip verification:', skipSignatureVerification);
  
  // Debug webhook secret (only show first few characters for security)
  const secretPreview = endpointSecret ? `${endpointSecret.substring(0, 8)}...` : 'NOT SET';
  console.log('Webhook secret configured:', !!endpointSecret, 'Preview:', secretPreview);
  
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  console.log('Webhook signature present:', !!sig);
  console.log('Body length:', body.length);
  console.log('Signature header:', sig ? sig.substring(0, 50) + '...' : 'MISSING');

  let event: Stripe.Event;

  try {
    if (skipSignatureVerification) {
      console.log('⚠️ SKIPPING signature verification (development mode)');
      event = JSON.parse(body) as Stripe.Event;
    } else {
      if (!endpointSecret) {
        throw new Error('STRIPE_WEBHOOK_SECRET environment variable is not set');
      }
      
      event = stripe.webhooks.constructEvent(body, sig!, endpointSecret);
      console.log('✅ Webhook signature verified successfully');
    }
    
    console.log('Event type:', event.type);
    console.log('Event ID:', event.id);
  } catch (err: any) {
    console.error('❌ Webhook signature verification failed:', err.message);
    
    // Additional debugging info
    console.error('Debug info:', {
      hasSecret: !!endpointSecret,
      secretLength: endpointSecret?.length || 0,
      hasSignature: !!sig,
      signatureLength: sig?.length || 0,
      bodyLength: body.length,
      bodyPreview: body.substring(0, 100) + '...',
      skipVerification: skipSignatureVerification
    });
    
    return new Response(
      JSON.stringify({ error: 'Webhook signature verification failed' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      console.log('🛒 Processing checkout.session.completed event');
      const session = event.data.object as Stripe.Checkout.Session;
      
      console.log('Session details:', {
        sessionId: session.id,
        paymentStatus: session.payment_status,
        amountTotal: session.amount_total,
        currency: session.currency,
        customerEmail: session.customer_details?.email,
        productType: session.metadata?.product_type,
        productName: session.metadata?.product_name
      });
      
      // Check if this is a PDF purchase
      if (session.metadata?.product_type === 'pdf') {
        console.log('📄 Processing PDF purchase');
        
        // Fire GTM conversion event for PDF purchase
        try {
          const gtmEvent = {
            event: 'purchase',
            ecommerce: {
              transaction_id: session.id,
              value: session.amount_total ? session.amount_total / 100 : 0, // Convert from cents
              currency: session.currency?.toUpperCase() || 'USD',
              items: [{
                item_id: session.metadata?.product_id || 'pdf_download',
                item_name: session.metadata?.product_name || 'PDF Download',
                price: session.amount_total ? session.amount_total / 100 : 0,
                quantity: 1
              }]
            },
            // Facebook Pixel data for GTM
            facebook_pixel: {
              event_name: 'Purchase',
              value: session.amount_total ? session.amount_total / 100 : 0,
              currency: session.currency?.toUpperCase() || 'USD',
              content_ids: [session.metadata?.product_id || 'pdf_download'],
              content_name: session.metadata?.product_name || 'PDF Download',
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
          
          console.log('📊 GTM conversion event fired for PDF purchase:', gtmEvent);
        } catch (error) {
          console.error('❌ Error firing GTM event:', error);
        }
        
        try {
          // Generate download link for the customer
          const customerEmail = session.customer_details?.email;
          const sessionId = session.id;
          
          if (customerEmail && sessionId) {
            // Create a download link that the customer can use
            const downloadUrl = `${new URL(request.url).origin}/download-pdf?sessionId=${sessionId}&email=${encodeURIComponent(customerEmail)}`;
            
            console.log('✅ PDF purchase completed successfully:', {
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
          } else {
            console.error('❌ Missing customer email or session ID:', { customerEmail: !!customerEmail, sessionId: !!sessionId });
          }
          
        } catch (error) {
          console.error('❌ Error processing PDF purchase:', error);
          return new Response(
            JSON.stringify({ error: 'Failed to process PDF purchase' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      } else {
        console.log('⚠️ Non-PDF purchase detected, ignoring');
      }
      break;
      
    default:
      console.log(`⚠️ Unhandled event type: ${event.type}`);
  }

  console.log('=== WEBHOOK PROCESSING COMPLETE ===');
  return new Response(
    JSON.stringify({ received: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
