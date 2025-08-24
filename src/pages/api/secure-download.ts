import type { APIRoute } from 'astro';
import { readFileSync } from 'fs';
import { join } from 'path';

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

export const GET: APIRoute = async ({ request, url }) => {
  try {
    const token = url.searchParams.get('token');
    
    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Download token required' }), 
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate token against stored tokens
    const tokenData = globalThis.downloadTokens?.get(token);
    
    if (!tokenData) {
      return new Response(
        JSON.stringify({ error: 'Invalid download token' }), 
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Check if token has expired
    const currentTime = Math.floor(Date.now() / 1000);
    if (tokenData.expiresAt < currentTime) {
      // Clean up expired token
      globalThis.downloadTokens!.delete(token);
      return new Response(
        JSON.stringify({ error: 'Download token has expired' }), 
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Verify this is a PDF product
    if (tokenData.productType !== 'pdf') {
      return new Response(
        JSON.stringify({ error: 'Invalid product type' }), 
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Read the PDF file from a secure location (outside public directory)
    // In production, you might want to use cloud storage like AWS S3
    const pdfPath = join(process.cwd(), 'secure-assets', 'feed-the-fame.pdf');
    
    try {
      const pdfBuffer = readFileSync(pdfPath);
      
      // Clean up the token after successful download (one-time use)
      globalThis.downloadTokens!.delete(token);
      
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
