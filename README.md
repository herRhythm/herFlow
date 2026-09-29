# HerRhythm checkout

The root HTML files are the live site; `dev/` holds historical snapshots.

## Theme

All nine live site pages and the digital Companion Guide load `assets/theme.js`
and `assets/theme.css`. Light is the default, independent of device appearance.
The fixed Light/Dark button saves an explicit selection under `cg_theme` and
keeps it across page navigation. Missing, invalid or inaccessible storage falls
back to light. Historical `dev/` snapshots and the raw `file.html` content draft
are not live site pages.

## Pricing and scope

September 15 commit `8533a61` replaced the checkout's KSh 2,500 summary with zero,
but left its JavaScript at KSh 2,500 and a demo-only alert. Neither amount matched
the kit pages. Checkout now uses the published product prices:

| Kit | Total (KES) |
| --- | ---: |
| Menarche | 6,800 |
| Rising Moon Full Kit, including impact | 6,800 |
| Rising Moon Opt-out | 6,500 |

`assets/catalog.js` is the shared catalogue. The server computes integer minor-unit
amounts independently of anything sent by the browser. Update the product-page
price copy alongside any future catalogue change. Product CTAs preserve the kit
selection. Generic checkout links default to Menarche, with a selector to change it.

One kit is purchased per order. Rising Moon buys **one month**, not an automatic
subscription. No extra processing fee is added. There are no promo codes, saved
cards, PayPal or direct Airtel integrations. Paystack hosts payment entry and
shows the enabled card/mobile-money methods for the merchant account.

## Run locally

Use Node.js 24 or newer; there are no runtime packages to install.

1. Copy `.env.example` to `.env`.
2. Set `PAYSTACK_SECRET_KEY` to your **test** secret in `.env`.
3. Run `npm start` (or `node --env-file-if-exists=.env server/index.js`).
4. Open `http://localhost:3000/checkout.html`.
5. Run `npm test`. In restricted environments that prohibit test child processes,
   use `node --test --test-isolation=none`.

With no secret, checkout displays an unavailable state and cannot create orders.
Opening the HTML directly or serving it only on GitHub Pages does not provide a
payment backend; the page also fails closed in that case.

## Production configuration

Deploy the Node server behind an HTTPS reverse proxy on the website's origin.
Keep one application instance with a persistent local SQLite volume; do not use
ephemeral/serverless storage or multiple independent database copies.

- `PAYSTACK_SECRET_KEY`: server-side secret manager/environment only. Never put
  secret keys in HTML, browser scripts, GitHub Pages settings, or public feedback
  configuration. `.env` and `data/` are ignored by Git and blocked by the server.
- `PUBLIC_ORIGIN`: exact public HTTPS origin, for example `https://shop.example.com`.
  No trailing path. Both checkout and API must be served at this origin. Provider
  return URLs are derived from this configured value, never an incoming Host header.
- `ORDER_DB_PATH`: absolute path on a durable private volume. Restrict filesystem
  access to the app/operator account; encrypt and back up the volume, including
  SQLite WAL state using SQLite's backup facilities or a stopped-server snapshot.
- `PORT`: internal listener port, default 3000.
- Register `https://YOUR_ORIGIN/api/payments/webhook` in the matching Paystack
  test/live dashboard. No browser configuration or public key is needed.
- Configure TLS, request-size limits and per-client rate limits at the proxy.
  The app has a conservative socket-IP rate limit and deliberately does not trust
  `X-Forwarded-For`. Redact `order` query parameters from proxy/access logs.

Before switching to a live secret, activate the Kenyan merchant account and
confirm its enabled payment channels. With test credentials, complete a provider
success, decline, cancellation, browser refresh, delayed webhook and lost-network
test on the deployed staging origin. Confirm the order in the private database
and Paystack dashboard. Live credentials/merchant setup and a real provider
smoke test are deployment prerequisites; automated tests use a fake provider and
do not prove the merchant account is activated. No payment has been sent by tests.

## Order and payment lifecycle

Orders (contact/delivery details, authoritative amount, kit and reference) are
persisted **before** calling Paystack. A browser UUID is both the idempotency key
and receipt capability; its hash is stored in the database. Double submissions
share the same provider reference. Retries after timeouts reuse that reference,
never silently create another charge. Paystack may reject reinitialization if it
already accepted the reference; in that case check status or contact support.

Only a signed `charge.success` webhook or server-to-server verification can mark
an order paid. Both match reference, amount, KES currency, customer email and
test/live domain. A return URL or query-string status is not proof of payment.
Paid state is monotonic; duplicate webhooks cannot create duplicate fulfilment.
Failed payments allow a new attempt. Pending/abandoned/unknown payments retain
the existing order and offer status checking; customers are told not to pay again
if money was deducted. Receipt responses contain no contact or address data.

Receipt keys are carried in the return URL, immediately removed from browser
history and kept in session storage. The checkout sends no referrer and does not
load the site feedback collector. Treat receipt links as private. If session
storage is unavailable, initiation is blocked so the order cannot be lost during
redirect. Details are shared with Paystack only as needed for payment (email,
kit/reference); delivery data stays in the private order database.

## Fulfilment and support

On the trusted server, list paid orders awaiting fulfilment:

```sh
node --env-file-if-exists=.env server/orders.js list
node --env-file-if-exists=.env server/orders.js fulfilled hr-ORDER-REFERENCE
```

The list contains personal delivery data: use a private operator terminal, never
publish its output or commit exports. Mark an order fulfilled only after delivery
work is recorded. There is no automatic confirmation email, shipping integration,
refund automation or subscription billing. The success page does not promise one.
Use the stored reference to reconcile uncertain payments in Paystack before
fulfilling or asking a customer to pay again. Monitor webhook failures; Paystack
retries unacknowledged events. Operator retention/deletion procedures should
follow the business's customer-data policy.

API implementation references: [initialize/verify](https://paystack.com/docs/api/transaction/),
[webhook signatures](https://paystack.com/docs/payments/webhooks/), and
[payment channels](https://paystack.com/docs/payments/payment-channels/).
