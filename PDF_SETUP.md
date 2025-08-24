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
   ```

### 2. Webhook Configuration

1. **Create Webhook Endpoint:**
   - Go to [Stripe Webhooks](https://dashboard.stripe.com/webhooks)
   - Add endpoint: `https://yourdomain.com/api/stripe-webhook`
   - Select events: `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`

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
   - This prevents direct access without authentication
   - Ensure your server doesn't serve files from this directory

2. **Download Token System:**
   - Temporary download links are generated for each purchase
   - Links expire after 1 hour for security
   - One-time use tokens prevent unauthorized sharing

### 5. Email Integration (Optional)

To send download links via email after successful payment:

1. **Install Email Service:**
   ```bash
   npm install @sendgrid/mail
   # or
   npm install nodemailer
   ```

2. **Update Webhook Handler:**
   - Modify `src/pages/api/stripe-webhook.ts`
   - Add email sending logic in the `checkout.session.completed` case

## Usage

### For Customers:
1. Visit the PDF download section
2. Click "Purchase & Download"
3. Complete payment via Stripe
4. Get redirected to secure download page
5. Generate secure download link
6. Download PDF (link valid for 1 hour)

### For Developers:
1. The system automatically handles payment processing
2. Successful payments trigger the webhook
3. Failed payments show appropriate error messages
4. All transactions are logged for debugging

## Testing

1. **Test Mode:**
   - Use Stripe test keys for development
   - Test with test card numbers (e.g., 4242 4242 4242 4242)

2. **Webhook Testing:**
   - Use Stripe CLI for local webhook testing
   - Monitor webhook events in Stripe Dashboard

## Security Considerations

1. **Webhook Verification:**
   - Always verify webhook signatures
   - Use HTTPS in production
   - Keep webhook secrets secure

2. **Access Control:**
   - Implement proper access controls for PDF downloads
   - Consider rate limiting for download attempts
   - Log all access attempts

## Troubleshooting

### Common Issues:

1. **Payment Not Processing:**
   - Check Stripe API keys
   - Verify price ID is correct
   - Check browser console for errors

2. **Webhook Not Working:**
   - Verify webhook endpoint URL
   - Check webhook secret
   - Monitor webhook events in Stripe Dashboard

3. **PDF Not Downloading:**
   - Ensure PDF file exists in public directory
   - Check file permissions
   - Verify download link generation

### Debug Mode:

Enable debug logging by adding console.log statements in the webhook handler and payment processing code.

## Support

For technical support:
1. Check Stripe Dashboard for payment status
2. Review server logs for error messages
3. Verify all environment variables are set correctly
4. Test with Stripe test mode first

## Future Enhancements

Consider adding:
- User authentication system
- Download tracking and analytics
- Multiple PDF products
- Subscription-based access
- Advanced payment methods
- Automated email sequences
