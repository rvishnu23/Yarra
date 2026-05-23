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
- Search, filters, navigation, form states, toast interactions, CSV export, create forms, approval actions
- Node API server with persistent JSON data in `data/db.json`

## Preview

Run the app from this folder:

```powershell
npm start
```

Then open `http://localhost:4173`.

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
UPI_PAYEE_ID=vishnuaravindhr-1@okicici
UPI_PAYEE_NAME=Yarra Education Group
SESSION_TIMEOUT_MINUTES=30
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

## API

- `GET /api/state`
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
- `POST /api/payments/upi-intent`
- `POST /api/events`
- `POST /api/exchanges`
- `POST /api/vendors`
- `POST /api/vendors/:id/approve`
- `POST /api/notifications/read`
