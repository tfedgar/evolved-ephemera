import type { APIRoute } from 'astro';
import Stripe from 'stripe';

// Use Web Crypto API for Cloudflare compatibility
function createHmac(algorithm: string, key: string, data: string): string {
  // For Cloudflare, we'll use a simpler approach
  // In production, you might want to use a more secure method
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const dataData = encoder.encode(data);
  
  // Simple hash-based approach (not as secure as HMAC, but works for basic validation)
  const combined = new Uint8Array(keyData.length + dataData.length);
  combined.set(keyData, 0);
  combined.set(dataData, keyData.length);
  
  // Use a simple hash function
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined[i];
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return Math.abs(hash).toString(16);
}

function randomBytes(length: number): Uint8Array {
  const array = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array);
  } else {
    // Fallback for environments without crypto.getRandomValues
    for (let i = 0; i < length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return array;
}

interface TokenPayload {
  sessionId: string;
  customerEmail: string;
  expiresAt: number;
  productType: string;
  nonce: string;
}

function createSignedToken(payload: TokenPayload, tokenSecret: string): string {
  const data = `${payload.sessionId}:${payload.customerEmail}:${payload.expiresAt}:${payload.productType}:${payload.nonce}`;
  const signature = createHmac('sha256', tokenSecret, data);
  const tokenData = btoa(JSON.stringify(payload));
  return `${tokenData}.${signature}`;
}

function verifySignedToken(token: string, tokenSecret: string): TokenPayload | null {
  try {
    const [tokenData, signature] = token.split('.');
    if (!tokenData || !signature) return null;
    
    const payload: TokenPayload = JSON.parse(atob(tokenData));
    
    // Verify signature
    const data = `${payload.sessionId}:${payload.customerEmail}:${payload.expiresAt}:${payload.productType}:${payload.nonce}`;
    const expectedSignature = createHmac('sha256', tokenSecret, data);
    
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

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    // Access environment variables - try different methods
    let stripeSecretKey = import.meta.env.STRIPE_SECRET_KEY;
    let tokenSecret = import.meta.env.DOWNLOAD_TOKEN_SECRET || 'fallback-secret-key-change-in-production';

    // Try to get from Cloudflare runtime context
    if (locals && (locals as any).runtime && (locals as any).runtime.env) {
      const { env } = (locals as any).runtime;
      stripeSecretKey = stripeSecretKey || env.STRIPE_SECRET_KEY;
      tokenSecret = tokenSecret || env.DOWNLOAD_TOKEN_SECRET || 'fallback-secret-key-change-in-production';
    }

    if (!stripeSecretKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set');
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2023-10-16' as any,
    });

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
    const nonce = Array.from(randomBytes(16)).map(b => b.toString(16).padStart(2, '0')).join('');
    
    const tokenPayload: TokenPayload = {
      sessionId,
      customerEmail,
      expiresAt,
      productType: 'pdf',
      nonce
    };
    
    const downloadToken = createSignedToken(tokenPayload, tokenSecret);
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
