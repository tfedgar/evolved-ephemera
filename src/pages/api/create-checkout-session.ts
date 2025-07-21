import type { APIRoute } from 'astro';
import Stripe from 'stripe';

const stripe = new Stripe(import.meta.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2023-10-16' as any, // Type assertion for now
});

export const POST: APIRoute = async ({ request }) => {
  try {
    let priceId: string | null = null;
    const contentType = request.headers.get('content-type') || '';

    // Parse request body based on content type
    if (contentType.includes('application/json')) {
      const body = await request.json();
      priceId = body.priceId;
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await request.formData();
      priceId = formData.get('priceId') as string;
    } else {
      return new Response('Unsupported content type', { 
        status: 415,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }

    if (!priceId) {
      return new Response(JSON.stringify({ error: 'Price ID is required' }), { 
        status: 400,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }

    // Get origin for URLs
    const origin = request.headers.get('origin') || 'https://evolved-ephemera.pages.dev';

    // Create Stripe checkout session with modern options
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${origin}/pay?success=true`,
      cancel_url: `${origin}/pay?canceled=true`,
      expires_at: Math.floor(Date.now() / 1000) + (30 * 60), // 30 minutes
      consent_collection: {
        terms_of_service: 'none',
      },
      custom_text: {
        submit: {
          message: 'We will process your payment securely through Stripe.',
        },
      },
    });

    if (!session.url) {
      throw new Error('No session URL returned');
    }

    // Use 303 See Other for POST-to-GET redirect
    return new Response(null, {
      status: 303,
      headers: {
        'Location': session.url,
        'Cache-Control': 'no-store',
      }
    });

  } catch (err) {
    console.error('Stripe session creation error:', err);
    return new Response(JSON.stringify({ error: 'Payment session creation failed' }), { 
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}; 