import type { APIRoute } from 'astro';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createHmac } from 'crypto';

// Create a secret key for signing tokens (use environment variable in production)
const TOKEN_SECRET = import.meta.env.DOWNLOAD_TOKEN_SECRET || 'fallback-secret-key-change-in-production';

interface TokenPayload {
  sessionId: string;
  customerEmail: string;
  expiresAt: number;
  productType: string;
  nonce: string;
}

function verifySignedToken(token: string): TokenPayload | null {
  try {
    const [tokenData, signature] = token.split('.');
    if (!tokenData || !signature) {
      console.error('Invalid token format - missing parts');
      return null;
    }
    
    const payload: TokenPayload = JSON.parse(Buffer.from(tokenData, 'base64').toString());
    
    // Verify signature
    const data = `${payload.sessionId}:${payload.customerEmail}:${payload.expiresAt}:${payload.productType}:${payload.nonce}`;
    const expectedSignature = createHmac('sha256', TOKEN_SECRET).update(data).digest('hex');
    
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

export const GET: APIRoute = async ({ request, url }) => {
  try {
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
    const tokenData = verifySignedToken(token);
    
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
    
    // Read the PDF file from a secure location (outside public directory)
    // In production, you might want to use cloud storage like AWS S3
    const pdfPath = join(process.cwd(), 'secure-assets', 'feed-the-fame.pdf');
    console.log('Attempting to read PDF from:', pdfPath);
    
    try {
      const pdfBuffer = readFileSync(pdfPath);
      console.log('PDF file read successfully, size:', pdfBuffer.length, 'bytes');
      
      // Return the PDF with appropriate headers
      return new Response(pdfBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="feed-the-fame.pdf"',
          'Content-Length': pdfBuffer.length.toString(),
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
      
    } catch (fileError) {
      console.error('PDF file read error:', fileError);
      return new Response(
        JSON.stringify({ error: 'PDF file not found' }), 
        { status: 404, headers: { 'Content-Type': 'application/json' } }
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
