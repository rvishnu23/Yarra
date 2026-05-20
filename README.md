# Yaara Consortium Platform

Dynamic full-stack local app based on `Yarra App Requirements.pdf`.

## Included

- Role-aware dashboard shell for Super Admin, School Admin, Teacher, and Vendor contexts
- Student role and age-gated student user management
- School onboarding, school dashboard, and membership activation flow
- Dynamic payment history and generated invoice preview/download
- Razorpay checkout flow on school onboarding, with local simulation when keys are not configured
- Events, exchange programs, content library, vendor directory, promotions, notifications, and school profiles
- Search, filters, navigation, form states, toast interactions, CSV export, create forms, approval actions
- Node API server with persistent JSON data in `data/db.json`

## Preview

Run the app from this folder:

```powershell
npm start
```

Then open `http://localhost:4173`.

## Razorpay

For real Razorpay Checkout, set these environment variables before starting the app:

```powershell
$env:RAZORPAY_KEY_ID="rzp_test_xxxxx"
$env:RAZORPAY_KEY_SECRET="your_secret"
npm start
```

Without these keys, the app runs a local simulated payment so the onboarding flow can still be tested end to end.

## API

- `GET /api/state`
- `POST /api/schools`
- `POST /api/students`
- `POST /api/payments`
- `POST /api/payments/razorpay-order`
- `POST /api/events`
- `POST /api/exchanges`
- `POST /api/vendors`
- `POST /api/vendors/:id/approve`
- `POST /api/notifications/read`
