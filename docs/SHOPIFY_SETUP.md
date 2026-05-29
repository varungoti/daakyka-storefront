# Shopify Setup Guide

## Storefront API (Catalog + Cart)

1. In Shopify Admin → **Settings → Apps and sales channels → Develop apps**
2. Create an app → configure **Storefront API** scopes:
   - `unauthenticated_read_product_listings`
   - `unauthenticated_read_product_inventory`
   - `unauthenticated_write_checkouts`
   - `unauthenticated_read_checkouts`
3. Install the app and copy the **Storefront access token**
4. Set environment variables:

```env
NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN=shpat_...
SHOPIFY_API_VERSION=2025-01
```

5. Restart the app — cart mode switches from local demo to Shopify checkout automatically.

## Orders Webhook (Post-Purchase Journeys)

1. Shopify Admin → **Settings → Notifications → Webhooks** (or via Admin API)
2. Create webhook:
   - Event: **Order creation**
   - URL: `https://your-domain.com/api/webhooks/shopify/orders`
   - Format: JSON
3. Copy the **webhook signing secret** → `SHOPIFY_WEBHOOK_SECRET`
4. Place a test order — confirm:
   - Row appears in `/admin/orders`
   - Post-purchase journey enrollment in `/admin/journeys`
   - Admin notification created

## Local Development

Without Shopify credentials the storefront uses the **seed catalog** and **localStorage cart**. Checkout redirects to `/checkout` (demo mode).

To test webhooks locally, use ngrok or Shopify CLI tunnel:

```bash
ngrok http 3000
# Register webhook URL: https://xxxx.ngrok.io/api/webhooks/shopify/orders
```

## Troubleshooting

| Issue | Fix |
|---|---|
| Empty shop page | Check store domain and token; verify products published to Online Store |
| Checkout fails | Confirm Storefront API checkout scopes |
| Webhook 401 | Set `SHOPIFY_WEBHOOK_SECRET`; HMAC must match |
| Webhook 200 but no order | Check server logs; duplicate `externalId` is deduplicated |
