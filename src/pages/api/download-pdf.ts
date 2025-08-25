import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { createHmac, randomBytes } from 'crypto';

// Access environment variables - try different methods
let stripeSecretKey = import.meta.env.STRIPE_SECRET_KEY;
let tokenSecret = import.meta.env.DOWNLOAD_TOKEN_SECRET || 'fallback-secret-key-change-in-production';

// Try to get from locals if available (for some adapters)
if (typeof globalThis !== 'undefined' && (globalThis as any).env) {
  stripeSecretKey = stripeSecretKey || (globalThis as any).env.STRIPE_SECRET_KEY;
  tokenSecret = tokenSecret || (globalThis as any).env.DOWNLOAD_TOKEN_SECRET || 'fallback-secret-key-change-in-production';
}

if (!stripeSecretKey) {
  throw new Error('STRIPE_SECRET_KEY environment variable is not set');
}

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2023-10-16' as any,
});

// Create a secret key for signing tokens (use environment variable in production)
const TOKEN_SECRET = tokenSecret;

interface TokenPayload {
  sessionId: string;
  customerEmail: string;
  expiresAt: number;
  productType: string;
  nonce: string;
}

function createSignedToken(payload: TokenPayload): string {
  const data = `${payload.sessionId}:${payload.customerEmail}:${payload.expiresAt}:${payload.productType}:${payload.nonce}`;
  const signature = createHmac('sha256', TOKEN_SECRET).update(data).digest('hex');
  const tokenData = Buffer.from(JSON.stringify(payload)).toString('base64');
  return `${tokenData}.${signature}`;
}

function verifySignedToken(token: string): TokenPayload | null {
  try {
    const [tokenData, signature] = token.split('.');
    if (!tokenData || !signature) return null;
    
    const payload: TokenPayload = JSON.parse(Buffer.from(tokenData, 'base64').toString());
    
    // Verify signature
    const data = `${payload.sessionId}:${payload.customerEmail}:${payload.expiresAt}:${payload.productType}:${payload.nonce}`;
    const expectedSignature = createHmac('sha256', TOKEN_SECRET).update(data).digest('hex');
    
    if (signature !== expectedSignature) return null;
    
    // Check if token has expired
    const currentTime = Math.floor(Date.now() / 1000);
    if (payload.expiresAt < currentTime) return null;
    
    return payload;
  } catch (error) {
    console.error('Token verification error:', error);
    return null;
  }
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const formData = await request.formData();
    const sessionId = formData.get('sessionId') as string;
    const customerEmail = formData.get('customerEmail') as string;
    
    console.log('Download request received:', { sessionId, customerEmail });
    
    if (!sessionId || !customerEmail) {
      console.error('Missing required parameters:', { sessionId: !!sessionId, customerEmail: !!customerEmail });
      return new Response(
        JSON.stringify({ error: 'Missing required parameters' }), 
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify the payment was successful by checking the Stripe session
    console.log('Verifying Stripe session:', sessionId);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    console.log('Stripe session details:', {
      sessionId: session.id,
      paymentStatus: session.payment_status,
      productType: session.metadata?.product_type,
      customerEmail: session.customer_details?.email
    });
    
    if (session.payment_status !== 'paid') {
      console.error('Payment not completed:', session.payment_status);
      return new Response(
        JSON.stringify({ error: 'Payment not completed' }), 
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify customer email matches
    if (session.customer_details?.email !== customerEmail) {
      console.error('Email verification failed:', {
        expected: customerEmail,
        actual: session.customer_details?.email
      });
      return new Response(
        JSON.stringify({ error: 'Email verification failed' }), 
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if this is a PDF purchase
    if (session.metadata?.product_type !== 'pdf') {
      console.error('Invalid product type:', session.metadata?.product_type);
      return new Response(
        JSON.stringify({ error: 'Invalid product type' }), 
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Generate a signed token (valid for 1 hour)
    const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const nonce = randomBytes(16).toString('hex');
    
    const tokenPayload: TokenPayload = {
      sessionId,
      customerEmail,
      expiresAt,
      productType: 'pdf',
      nonce
    };
    
    const downloadToken = createSignedToken(tokenPayload);
    console.log('Download token generated successfully for session:', sessionId);

    // Return the download URL
    const downloadUrl = `${new URL(request.url).origin}/api/secure-download?token=${encodeURIComponent(downloadToken)}`;
    
    return new Response(
      JSON.stringify({ 
        downloadUrl,
        expiresAt,
        message: 'Download link generated successfully'
      }), 
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Download generation error:', error);
    
    // Log more details for debugging
    if (error.type) {
      console.error('Stripe error type:', error.type);
    }
    if (error.message) {
      console.error('Stripe error message:', error.message);
    }
    
    return new Response(
      JSON.stringify({ 
        error: 'Unable to generate download link. Please contact support.',
        details: error.message 
      }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
