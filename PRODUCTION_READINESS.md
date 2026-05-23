# Yarra Consortium Production Readiness

This app is now hardened enough for a serious prototype, but a public multi-school launch needs a production deployment plan.

## Already Added

- Server-backed sessions with configurable timeout and logout invalidation.
- Role-based access boundaries for Super Admin, School Admin, Teacher, Student, and Vendor.
- Student content filtering by age and vendor marketplace isolation.
- Security headers, including CSP, frame protection, content-type protection, referrer policy, and permissions policy.
- Request body size limits for JSON and Excel uploads.
- Rate limiting for login/session APIs and normal APIs.
- Health endpoint at `GET /api/health`.
- Atomic writes for local JSON storage.
- Audit log at `data/audit.log` for key business actions.
- PostgreSQL schema migrations in `migrations/`.
- Signed Razorpay webhook route for payment confirmation.
- S3 asset pipeline hooks for templates, roster uploads, and invoice logs.
- Google OAuth token verification when `GOOGLE_CLIENT_ID` is configured.
- RFQ cart, vendor review, personalized feed, and threaded comments architecture.

## Required Before Internet Launch

- Run the PostgreSQL migrations and move production traffic to `DATABASE_URL`.
- Store sessions in Redis or database-backed session storage.
- Deploy behind HTTPS with a reverse proxy or managed platform.
- Enable real Google OAuth using a verified Google Cloud OAuth client.
- Move Razorpay payment confirmation to signed webhooks.
- Add automated backups and restore testing.
- Add error monitoring, uptime monitoring, and audit log retention.
- Add privacy policy, terms, consent text for student data, and school data processing agreements.
- Add admin approval workflows for school creation, vendor approval, and student onboarding.

## Suggested Production Stack

- Frontend: React or Next.js with TypeScript.
- Backend: Node.js with NestJS or Express, TypeScript, and structured validation.
- Database: PostgreSQL with Prisma.
- Cache/session store: Redis.
- Files: S3-compatible storage for templates, invoices, vendor images, and roster uploads.
- Auth: Google OAuth plus role assignment controlled by Akshar Arbol Super Admin.
- Payments: Razorpay Orders, Payment Links, UPI, and signed webhooks.
- Hosting: AWS, Azure, GCP, Render, Railway, or Vercel plus a backend service.
- Observability: Sentry, uptime monitoring, structured logs, and audit log export.

## Environment Controls

```text
HOST=0.0.0.0
PORT=4173
SESSION_TIMEOUT_MINUTES=30
MAX_REQUEST_BYTES=10485760
AUTH_RATE_LIMIT_WINDOW_MS=60000
AUTH_RATE_LIMIT_MAX=10
API_RATE_LIMIT_WINDOW_MS=60000
API_RATE_LIMIT_MAX=240
RAZORPAY_KEY_ID=rzp_test_or_live_key
RAZORPAY_KEY_SECRET=secret_from_razorpay_dashboard
RAZORPAY_WEBHOOK_SECRET=secret_from_razorpay_webhooks
DATABASE_URL=postgres://user:password@host:5432/yarra
DATABASE_SSL=true
GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
AWS_REGION=ap-south-1
AWS_S3_BUCKET=yarra-production-assets
AWS_S3_PUBLIC_BASE_URL=https://cdn.example.com
UPI_PAYEE_ID=your-upi-id@bank
UPI_PAYEE_NAME=Yarra Education Group
```

Use `HOST=0.0.0.0` only when the app is behind HTTPS and a firewall or managed hosting platform.
