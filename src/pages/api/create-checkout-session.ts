import Stripe from 'stripe';

const stripeSecretKey = import.meta.env.STRIPE_SECRET_KEY;

export async function POST({ request }: { request: Request }) {
  // Check if Stripe key is available
  if (!stripeSecretKey) {
    console.error('STRIPE_SECRET_KEY environment variable is not set');
    return new Response(
      JSON.stringify({ 
        error: 'Payment system configuration error. Please contact support.',
        details: 'Missing Stripe API key'
      }), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2023-10-16' as any, // Type assertion for now
  });

  try {
    const formData = await request.formData();
    const priceId = formData.get('priceId') as string;
    
    if (!priceId) {
      return new Response(
        JSON.stringify({ error: 'Price ID is required' }), 
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const origin = new URL(request.url).origin;

    // Check if this is a recurring price (subscription) or one-time payment
    const price = await stripe.prices.retrieve(priceId);
    const isRecurring = price.type === 'recurring';
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: isRecurring ? 'subscription' : 'payment',
      success_url: `${origin}/pay?success=true`,
      cancel_url: `${origin}/pay?canceled=true`,
      expires_at: Math.floor(Date.now() / 1000) + (30 * 60), // 30 minutes
      custom_text: {
        submit: {
          message: isRecurring ? 'Complete your coaching subscription' : 'Complete your coaching package purchase',
        },
      },
    });

    return new Response(
      null,
      {
        status: 303,
        headers: {
          'Location': session.url!,
          'Content-Type': 'application/json'
        }
      }
    );

  } catch (error: any) {
    console.error('Stripe session creation error:', error);
    console.error('Error type:', error.type);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    
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

    if (error.type === 'StripeInvalidRequestError') {
      return new Response(
        JSON.stringify({ 
          error: 'Invalid payment request. Please try again.',
          details: error.message
        }), 
        { 
          status: 400,
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