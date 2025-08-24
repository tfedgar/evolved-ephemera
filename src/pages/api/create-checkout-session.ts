import Stripe from 'stripe';

const stripe = new Stripe(import.meta.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2023-10-16' as any, // Type assertion for now
});

export async function POST({ request }: { request: Request }) {
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