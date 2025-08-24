import Stripe from 'stripe';

export async function POST({ request, locals }: { request: Request; locals: any }) {
  // Try multiple ways to access the environment variable at runtime
  const stripeSecretKey = locals?.env?.STRIPE_SECRET_KEY || 
                         (request as any).cf?.env?.STRIPE_SECRET_KEY ||
                         process.env.STRIPE_SECRET_KEY;

  // Check if Stripe key is available
  if (!stripeSecretKey) {
    console.error('STRIPE_SECRET_KEY environment variable is not set');
    return new Response(
      JSON.stringify({ 
        error: 'Payment system configuration error. Please contact support.',
        details: 'Missing Stripe API key - Environment variable not accessible'
      }), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2023-10-16' as any,
  });

  try {
    const formData = await request.formData();
    const productType = formData.get('productType') as string;
    // Define the price ID for the PDF (you'll need to create this in your Stripe dashboard)
    const PDF_PRICE_ID = 'price_1Rzg7fATEGp1ZwvVifHAY9rv';
    
    if (!productType || productType !== 'pdf') {
      return new Response(
        JSON.stringify({ error: 'Invalid product type' }), 
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    
    // Check if we have a valid price ID
    if (!PDF_PRICE_ID) {
      console.error('PDF_PRICE_ID not configured:', PDF_PRICE_ID);
      return new Response(
        JSON.stringify({ error: 'PDF product not configured. Please contact support.' }), 
        { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    
    const origin = new URL(request.url).origin;
    
    let session;
    try {
      session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price: PDF_PRICE_ID,
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: `${origin}/download-pdf?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/pay?canceled=true&product=pdf`,
        expires_at: Math.floor(Date.now() / 1000) + (30 * 60), // 30 minutes
        custom_text: {
          submit: {
            message: 'Complete your PDF purchase',
          },
        },
        metadata: {
          product_type: 'pdf',
          product_name: 'Feed the Fame',
        },
      });
      

    } catch (stripeError: any) {
      console.error('Stripe session creation failed:', stripeError);
      console.error('Stripe error type:', stripeError.type);
      console.error('Stripe error message:', stripeError.message);
      throw stripeError;
    }

    // Ensure session was created successfully
    if (!session || !session.url) {
      console.error('Session creation failed - no session or URL');
      return new Response(
        JSON.stringify({ error: 'Failed to create checkout session' }), 
        { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }


    

    return new Response(
      JSON.stringify({
        success: true,
        checkoutUrl: session.url,
        sessionId: session.id
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

  } catch (error: any) {
    console.error('Stripe PDF session creation error:', error);
    
    // Handle specific Stripe errors
    if (error.type === 'StripeAuthenticationError') {
      return new Response(
        JSON.stringify({ 
          error: 'Payment system temporarily unavailable. Please contact support.',
          details: 'API key configuration issue'
        }), 
        { 
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    return new Response(
      JSON.stringify({ 
        error: 'Unable to create checkout session. Please try again later.',
        details: error.message 
      }), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
