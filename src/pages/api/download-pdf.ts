import type { APIRoute } from 'astro';
import Stripe from 'stripe';

import {
  createSignedToken, DOWNLOAD_TOKEN_LIFETIME_SECONDS, readDownloadTokenSecret, type DownloadTokenPayload,
} from '../../lib/server/download-token.ts';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const runtimeEnvironment = (locals as any)?.runtime?.env;
    const stripeSecretKey = import.meta.env.STRIPE_SECRET_KEY || runtimeEnvironment?.STRIPE_SECRET_KEY;
    const tokenSecret = readDownloadTokenSecret(runtimeEnvironment, import.meta.env);
    if (!tokenSecret) {
      return new Response(
        JSON.stringify({ error: 'Downloads are temporarily unavailable. Please try again later.' }),
        { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
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
    
    if (!sessionId || !customerEmail) {
      console.error('Missing required download parameters');
      return new Response(
        JSON.stringify({ error: 'Missing required parameters' }), 
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify the payment was successful by checking the Stripe session
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    if (session.payment_status !== 'paid') {
      console.error('Download payment not completed');
      return new Response(
        JSON.stringify({ error: 'Payment not completed' }), 
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify customer email matches
    if (session.customer_details?.email !== customerEmail) {
      console.error('Download email verification failed');
      return new Response(
        JSON.stringify({ error: 'Email verification failed' }), 
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if this is a PDF purchase
    if (session.metadata?.product_type !== 'pdf') {
      console.error('Invalid download product type');
      return new Response(
        JSON.stringify({ error: 'Invalid product type' }), 
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Generate a signed token (valid for 1 hour)
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + DOWNLOAD_TOKEN_LIFETIME_SECONDS;
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
    
    const tokenPayload: DownloadTokenPayload = {
      sessionId,
      customerEmail,
      issuedAt,
      expiresAt,
      productType: 'pdf',
      nonce
    };
    
    const downloadToken = await createSignedToken(tokenPayload, tokenSecret);

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
    console.error('Download generation failed');

    return new Response(
      JSON.stringify({ 
        error: 'Unable to generate download link. Please contact support.'
      }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
