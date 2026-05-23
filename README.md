# Yaara Consortium Platform

Dynamic full-stack local app based on `Yarra App Requirements.pdf`.

## Included

- Role-aware dashboard shell for Super Admin, School Admin, Teacher, and Vendor contexts
- Student role and age-gated student user management
- Role-based access control: Student content is age-gated and Vendor users are isolated to their marketplace workspace
- School onboarding, school dashboard, and membership activation flow
- Dynamic payment history and generated invoice preview/download
- Razorpay/UPI checkout flow on school onboarding, defaulting to a ₹1 test payment, with local simulation when keys are not configured
- Events, exchange programs, content library, vendor directory, promotions, notifications, and school profiles
- Vendor sign-up page with Yarra procedures, benefits, Akshar Arbol admin contact details, and sample platform previews
- Secure session tokens with configurable timeout, countdown warnings, activity refresh, and server-side expiry checks
- Production hardening for security headers, request-size limits, rate limiting, health checks, atomic local writes, and audit logs
- Search, filters, navigation, form states, toast interactions, CSV export, create forms, approval actions
- Node API server with persistent JSON data in `data/db.json`

## Preview

Run the app from this folder:

```powershell
npm install
npm start
```

Then open `http://localhost:4173`.

## PostgreSQL

Set `DATABASE_URL`, install dependencies, then run migrations:

```powershell
$env:DATABASE_URL="postgres://user:password@localhost:5432/yarra"
npm install
npm run migrate
npm start
```

When `DATABASE_URL` is present, the native Node server uses PostgreSQL through `pg` instead of rewriting `data/db.json`.

## Razorpay

For real Razorpay Checkout/UPI, set these environment variables before starting the app:

```powershell
$env:RAZORPAY_KEY_ID="rzp_test_xxxxx"
$env:RAZORPAY_KEY_SECRET="your_secret"
npm start
```

Or create a local `.env` file:

```text
RAZORPAY_KEY_ID=rzp_test_xxxxx
RAZORPAY_KEY_SECRET=your_secret
RAZORPAY_WEBHOOK_SECRET=your_razorpay_webhook_secret
UPI_PAYEE_ID=vishnuaravindhr-1@okicici
UPI_PAYEE_NAME=Yarra Education Group
SESSION_TIMEOUT_MINUTES=30
HOST=127.0.0.1
PORT=4173
MAX_REQUEST_BYTES=10485760
AUTH_RATE_LIMIT_WINDOW_MS=60000
AUTH_RATE_LIMIT_MAX=10
API_RATE_LIMIT_WINDOW_MS=60000
API_RATE_LIMIT_MAX=240
DATABASE_URL=postgres://user:password@localhost:5432/yarra
DATABASE_SSL=false
GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
AWS_REGION=ap-south-1
AWS_S3_BUCKET=yarra-production-assets
AWS_S3_PUBLIC_BASE_URL=https://cdn.example.com
```

Without these keys, the app uses direct UPI intent for a ₹1 local test payment to `vishnuaravindhr-1@okicici`, then records the payment after manual confirmation.

To change the local direct UPI payee:

```powershell
$env:UPI_PAYEE_ID="your-upi-id@bank"
$env:UPI_PAYEE_NAME="Your Payee Name"
npm start
```

## Sessions

The app issues a server-backed session token after Gmail sign-in. Protected APIs require `X-Session-Id` and expire when the configured timeout is reached.

```text
SESSION_TIMEOUT_MINUTES=30
```

The timeout can also be adjusted from the login page or the top bar after sign-in.

## Production hardening

This local app now includes the first layer of production controls:

- `GET /api/health` for uptime monitoring
- PostgreSQL mode through `DATABASE_URL` and SQL migrations in `migrations/`
- Signed Razorpay webhook endpoint at `POST /api/payments/webhook`
- Real Google OAuth token verification when `GOOGLE_CLIENT_ID` is configured
- S3 upload pipeline for roster uploads, template delivery, and invoice logs when `AWS_S3_BUCKET` is configured
- Amazon-style vendor reviews and RFQ cart APIs
- Instagram-style `GET /api/feed` with role and age-gated filtering
- Threaded comments with moderation flag counts
- Content Security Policy, frame protection, referrer policy, and content-type protection
- Request body size limits for uploads and JSON APIs
- Separate rate limits for auth and normal API requests
- Atomic writes for `data/db.json`
- Audit log entries in `data/audit.log` for login, logout, uploads, payments, vendors, students, events, exchanges, notifications, and school creation

For real public hosting, move from JSON files to a managed database, put the app behind HTTPS, use Google OAuth with verified domains, configure Razorpay webhooks, and deploy with backups and monitoring. See `PRODUCTION_READINESS.md`.

## API

- `GET /api/state`
- `GET /api/health`
- `GET /api/auth/session-config`
- `POST /api/auth/gmail`
- `POST /api/auth/extend`
- `POST /api/auth/role`
- `POST /api/auth/logout`
- `POST /api/schools`
- `POST /api/students`
- `POST /api/payments`
- `GET /api/payments/config`
- `POST /api/payments/razorpay-order`
- `POST /api/payments/razorpay-link`
- `POST /api/payments/webhook`
- `POST /api/payments/upi-intent`
- `GET /api/feed`
- `POST /api/rfq/cart`
- `POST /api/vendors/:id/reviews`
- `POST /api/comments`
- `POST /api/comments/flag`
- `POST /api/events`
- `POST /api/exchanges`
- `POST /api/vendors`
- `POST /api/vendors/:id/approve`
- `POST /api/notifications/read`
