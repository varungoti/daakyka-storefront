# Shopify Setup Guide

There is **no Shopify cart or checkout integration** in this app — checkout is Razorpay + this
app's own Prisma/Postgres catalog (see [HANDOVER.md](./HANDOVER.md) and
[PAYMENTS_RAZORPAY.md](./PAYMENTS_RAZORPAY.md)). The only thing Shopify-related left is an optional
**orders webhook**, for a business that also runs (or used to run) an existing Shopify store and
wants those orders reported into this app's `/admin/orders` and post-purchase journeys. If that
doesn't describe DAAKYKA's setup, skip this document entirely — nothing below is required for
launch.

## Orders Webhook (Post-Purchase Journeys)

1. Shopify Admin → **Settings → Notifications → Webhooks** (or via Admin API)
2. Create webhook:
   - Event: **Order creation**
   - URL: `https://your-domain.com/api/webhooks/shopify/orders`
   - Format: JSON
3. Copy the **webhook signing secret** → `SHOPIFY_WEBHOOK_SECRET`
4. Optionally set `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN` to that Shopify store's domain — if set, the
   webhook handler (`src/app/api/webhooks/shopify/orders/route.ts`) rejects any request whose
   `x-shopify-shop-domain` header doesn't match it. Leave it unset to accept from any domain that
   knows `SHOPIFY_WEBHOOK_SECRET`.
5. Place a test order on the Shopify store — confirm:
   - Row appears in `/admin/orders`
   - Post-purchase journey enrollment in `/admin/journeys`
   - Admin notification created

To test webhooks locally, use ngrok or the Shopify CLI tunnel:

```bash
ngrok http 3000
# Register webhook URL: https://xxxx.ngrok.io/api/webhooks/shopify/orders
```

## Troubleshooting

| Issue | Fix |
|---|---|
| Webhook 401 | Set `SHOPIFY_WEBHOOK_SECRET`; HMAC must match |
| Webhook 200 but no order | Check server logs; duplicate `externalId` is deduplicated |
| Webhook rejected (domain mismatch) | Confirm `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN` matches the sending store exactly |

## What NOT to do

Do not set `NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN` expecting it to enable a Shopify-backed
cart, product catalog, or checkout — there is nothing left in this app that reads a Storefront API
token, and setting it has no effect. `isShopifyCartMode()` (`src/lib/cart/service.ts`) is
hard-coded `false`: the cart always runs against this app's own catalog.
