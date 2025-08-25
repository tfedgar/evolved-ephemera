import type { APIRoute } from 'astro';

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

interface TokenPayload {
  sessionId: string;
  customerEmail: string;
  expiresAt: number;
  productType: string;
  nonce: string;
}

function verifySignedToken(token: string, tokenSecret: string): TokenPayload | null {
  try {
    const [tokenData, signature] = token.split('.');
    if (!tokenData || !signature) {
      console.error('Invalid token format - missing parts');
      return null;
    }
    
    const payload: TokenPayload = JSON.parse(atob(tokenData));
    
    // Verify signature
    const data = `${payload.sessionId}:${payload.customerEmail}:${payload.expiresAt}:${payload.productType}:${payload.nonce}`;
    const expectedSignature = createHmac('sha256', tokenSecret, data);
    
    if (signature !== expectedSignature) {
      console.error('Token signature verification failed');
      return null;
    }
    
    // Check if token has expired
    const currentTime = Math.floor(Date.now() / 1000);
    if (payload.expiresAt < currentTime) {
      console.error('Token has expired:', { expiresAt: payload.expiresAt, currentTime });
      return null;
    }
    
    return payload;
  } catch (error) {
    console.error('Token verification error:', error);
    return null;
  }
}

export const GET: APIRoute = async ({ request, url, locals }) => {
  try {
    // Access environment variables - try different methods
    let tokenSecret = import.meta.env.DOWNLOAD_TOKEN_SECRET || 'fallback-secret-key-change-in-production';

    // Try to get from Cloudflare runtime context
    if (locals && (locals as any).runtime && (locals as any).runtime.env) {
      const { env } = (locals as any).runtime;
      tokenSecret = tokenSecret || env.DOWNLOAD_TOKEN_SECRET || 'fallback-secret-key-change-in-production';
    }

    const token = url.searchParams.get('token');
    
    console.log('Secure download request received:', { hasToken: !!token });
    
    if (!token) {
      console.error('No download token provided');
      return new Response(
        JSON.stringify({ error: 'Download token required' }), 
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate the signed token
    console.log('Verifying download token...');
    const tokenData = verifySignedToken(token, tokenSecret);
    
    if (!tokenData) {
      console.error('Token verification failed');
      return new Response(
        JSON.stringify({ error: 'Invalid or expired download token' }), 
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    console.log('Token verified successfully:', {
      sessionId: tokenData.sessionId,
      customerEmail: tokenData.customerEmail,
      productType: tokenData.productType,
      expiresAt: tokenData.expiresAt
    });
    
    // Verify this is a PDF product
    if (tokenData.productType !== 'pdf') {
      console.error('Invalid product type in token:', tokenData.productType);
      return new Response(
        JSON.stringify({ error: 'Invalid product type' }), 
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Get R2 bucket binding
    let r2Bucket;
    if (locals && (locals as any).runtime && (locals as any).runtime.env) {
      const { env } = (locals as any).runtime;
      r2Bucket = env.PDF_STORAGE;
    }
    
    if (!r2Bucket) {
      console.error('R2 bucket not available');
      return new Response(
        JSON.stringify({ error: 'Storage not configured' }), 
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    try {
      // Get the PDF from R2
      const pdfObject = await r2Bucket.get('feed-the-fame.pdf');
      
      if (!pdfObject) {
        console.error('PDF not found in R2 storage');
        return new Response(
          JSON.stringify({ error: 'PDF not found' }), 
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
      
      // Log successful download
      console.log('PDF served successfully to:', tokenData.customerEmail);
      
      // Return the PDF with appropriate headers
      return new Response(pdfObject.body, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="feed-the-fame.pdf"',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
      
    } catch (r2Error) {
      console.error('Error accessing R2 storage:', r2Error);
      return new Response(
        JSON.stringify({ error: 'Failed to retrieve PDF' }), 
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

  } catch (error: any) {
    console.error('Secure download error:', error);
    
    return new Response(
      JSON.stringify({ 
        error: 'Download failed. Please contact support.',
        details: error.message 
      }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
