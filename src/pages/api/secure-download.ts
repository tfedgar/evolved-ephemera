import type { APIRoute } from 'astro';

import { readDownloadTokenSecret, verifySignedToken } from '../../lib/server/download-token.ts';

export const GET: APIRoute = async ({ request, url, locals }) => {
  try {
    const tokenSecret = readDownloadTokenSecret((locals as any)?.runtime?.env, import.meta.env);
    if (!tokenSecret) {
      return new Response(
        JSON.stringify({ error: 'Downloads are temporarily unavailable. Please try again later.' }),
        { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }

    const token = url.searchParams.get('token');
    
    if (!token) {
      console.error('No download token provided');
      return new Response(
        JSON.stringify({ error: 'Download token required' }), 
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate the signed token
    const tokenData = await verifySignedToken(token, tokenSecret);
    
    if (!tokenData) {
      console.error('Token verification failed');
      return new Response(
        JSON.stringify({ error: 'Invalid or expired download token' }), 
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Verify this is a PDF product
    if (tokenData.productType !== 'pdf') {
      console.error('Invalid download product type');
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
      console.error('PDF storage access failed');
      return new Response(
        JSON.stringify({ error: 'Failed to retrieve PDF' }), 
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

  } catch (error: any) {
    console.error('Secure download failed');
    
    return new Response(
      JSON.stringify({ 
        error: 'Download failed. Please contact support.'
      }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
