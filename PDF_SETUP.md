# PDF Download System Setup Guide

This guide explains how to set up the "Feed the Fame" PDF download system with Stripe payment integration.

## Overview

The system includes:
- A PDF download section component (`PDFDownloadSection.astro`)
- Stripe payment processing (`/api/create-pdf-checkout-session`)
- Webhook handling for successful payments (`/api/stripe-webhook`)
- Success/failure handling in the payment page

## Setup Steps

### 1. Stripe Configuration

1. **Create a Product in Stripe Dashboard:**
   - Go to [Stripe Dashboard](https://dashboard.stripe.com/products)
   - Create a new product called "Feed the Fame"
   - Set the price to $2.99 USD
   - Copy the Price ID (starts with `price_`)

2. **Update Price ID:**
   - Replace `price_1OqX2X2X2X2X2X2X2X2X2X2` in `src/pages/api/create-pdf-checkout-session.ts`
   - Replace `price_1OqX2X2X2X2X2X2X2X2X2X2` in `src/components/PDFDownloadSection.astro`

3. **Set Environment Variables:**
   ```bash
   STRIPE_SECRET_KEY=sk_test_... # Your Stripe secret key
   STRIPE_WEBHOOK_SECRET=whsec_... # Your webhook endpoint secret
   DOWNLOAD_TOKEN_SECRET=your-secure-random-string-here # New: for signing download tokens
   ```

### 2. Webhook Configuration

1. **Create Webhook Endpoint:**
   - Go to [Stripe Webhooks](https://dashboard.stripe.com/webhooks)
   - Add endpoint: `https://yourdomain.com/api/stripe-webhook`
   - Select events: `checkout.session.completed`

2. **Copy Webhook Secret:**
   - Copy the signing secret from your webhook endpoint
   - Add it to your environment variables

### 3. PDF File

1. **Replace Placeholder PDF:**
   - Replace `secure-assets/feed-the-fame.pdf` with your actual PDF file
   - Ensure the file is properly formatted and optimized
   - **Important:** The PDF is stored outside the public directory for security

2. **Update Cover Image:**
   - The cover image is referenced from `src/assets/feed-the-fame.png`
   - Replace with your actual cover image

### 4. Security Configuration

1. **Secure Assets Directory:**
   - The PDF is stored in `secure-assets/` (outside public directory)
   - This prevents direct access to the PDF file
   - Only authenticated users with valid tokens can download

2. **Download Token Secret:**
   - Generate a secure random string for `DOWNLOAD_TOKEN_SECRET`
   - This is used to sign and verify download tokens
   - Example: `openssl rand -hex 32`

### 5. Production Deployment

1. **Environment Variables:**
   - Ensure all environment variables are set in your production environment
   - Double-check `DOWNLOAD_TOKEN_SECRET` is properly configured

2. **File Permissions:**
   - Ensure the `secure-assets/` directory is readable by your application
   - The PDF file should be accessible to the server process

## Troubleshooting

### Common Issues

1. **"Invalid access" errors:**
   - Check that `DOWNLOAD_TOKEN_SECRET` is set correctly
   - Verify the PDF file exists in `secure-assets/feed-the-fame.pdf`
   - Check server logs for detailed error messages

2. **"Payment not completed" errors:**
   - Verify the Stripe session is in "paid" status
   - Check that the webhook is properly configured
   - Ensure the customer email matches the session

3. **"PDF file not found" errors:**
   - Verify the PDF file exists in the correct location
   - Check file permissions
   - Ensure the file path is correct for your deployment environment

### Debugging

The system now includes comprehensive logging. Check your server logs for:
- Download request details
- Stripe session verification results
- Token generation and verification steps
- File read operations

### Testing

1. **Test the complete flow:**
   - Make a test purchase
   - Verify the download link is generated
   - Test the download functionality
   - Check that tokens expire correctly

2. **Monitor logs:**
   - Watch for any error messages
   - Verify all steps complete successfully
   - Check that security validations work

## Security Notes

- Download tokens are signed and expire after 1 hour
- Tokens include a nonce to prevent replay attacks
- The PDF file is stored outside the public directory
- All requests are validated against Stripe session data
- Customer email verification prevents unauthorized access
