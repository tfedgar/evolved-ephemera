import type { APIRoute } from 'astro';
import Stripe from 'stripe';

// Define types for global token storage
interface TokenData {
  sessionId: string;
  customerEmail: string;
  expiresAt: number;
  productType: string;
  createdAt?: number;
}

declare global {
  var downloadTokens: Map<string, TokenData> | undefined;
}

const stripe = new Stripe(import.meta.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2023-10-16' as any,
});

export const POST: APIRoute = async ({ request }) => {
  try {
    const formData = await request.formData();
    const sessionId = formData.get('sessionId') as string;
    const customerEmail = formData.get('customerEmail') as string;
    
    if (!sessionId || !customerEmail) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters' }), 
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify the payment was successful by checking the Stripe session
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    if (session.payment_status !== 'paid') {
      return new Response(
        JSON.stringify({ error: 'Payment not completed' }), 
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify customer email matches
    if (session.customer_details?.email !== customerEmail) {
      return new Response(
        JSON.stringify({ error: 'Email verification failed' }), 
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if this is a PDF purchase
    if (session.metadata?.product_type !== 'pdf') {
      return new Response(
        JSON.stringify({ error: 'Invalid product type' }), 
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Generate a signed URL (valid for 1 hour)
    const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    
    // Create a unique token for this download
    const downloadToken = Buffer.from(`${sessionId}-${customerEmail}-${expiresAt}`).toString('base64');
    
    // Initialize global token storage with automatic cleanup
    if (!globalThis.downloadTokens) {
      globalThis.downloadTokens = new Map();
      
      // Set up automatic cleanup of expired tokens every 30 minutes
      setInterval(() => {
        const currentTime = Math.floor(Date.now() / 1000);
        let cleanedCount = 0;
        
        for (const [token, data] of globalThis.downloadTokens.entries()) {
          if (data.expiresAt < currentTime) {
            globalThis.downloadTokens.delete(token);
            cleanedCount++;
          }
        }
        

      }, 30 * 60 * 1000); // 30 minutes
    }
    
    // Store the download token
    globalThis.downloadTokens.set(downloadToken, {
      sessionId,
      customerEmail,
      expiresAt,
      productType: 'pdf',
      createdAt: Math.floor(Date.now() / 1000)
    });

    // Return the download URL
    const downloadUrl = `${new URL(request.url).origin}/api/secure-download?token=${downloadToken}`;
    
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
    
    return new Response(
      JSON.stringify({ 
        error: 'Unable to generate download link. Please contact support.',
        details: error.message 
      }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
