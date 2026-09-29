# Khubzati Backend API

This is the backend API for the Khubzati application, a platform connecting bakeries and restaurants with customers.

## Features

- User authentication and authorization
- User profile and address management
- Bakery and restaurant management
- Product catalog management
- Order processing
- Reviews and ratings
- Notifications

## Tech Stack

- Node.js
- Express.js
- PostgreSQL
- Prisma ORM
- JWT Authentication

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- PostgreSQL database

## Installation

1. Clone the repository:
   ```
   git clone <repository-url>
   cd khubzati_api_project
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Configure environment variables:
   - Copy `sample.env` to `.env`
   - Update the database connection details and other configuration values
   ```
   cp sample.env .env
   ```

4. Update the `.env` file with your database credentials and other settings:
   ```
   JWT_SECRET=your_jwt_secret_key
   APP_PORT=3000

   # Database Configuration
   DATABASE_URL="postgresql://username:password@localhost:5432/khubzati?schema=public"
   DIRECT_URL="postgresql://username:password@localhost:5432/khubzati?schema=public"

   # Admin credentials
   ADMIN_EMAIL=admin@example.com
   ADMIN_PASSWORD=secure_password
   ```

## Database Setup

1. Create a PostgreSQL database:
   ```
   createdb khubzati
   ```

2. Generate Prisma Client:
   ```
   npx prisma generate
   ```

3. Run database migrations:
   ```
   npx prisma migrate deploy
   ```

4. (Optional) Seed the database with initial data:
   ```
   npm run seed
   ```

## Running the Application

### Development Mode

```
npm run start:dev
```

### Production Mode

```
npm start
```

The server will start on the port specified in your `.env` file (default: 3000).

## Prisma Studio (Database Management UI)

You can use Prisma Studio to view and edit your database:

```
npx prisma studio
```

This will open a web interface at http://localhost:5555 where you can manage your data.

## API Endpoints

### Authentication

- `POST /api/auth/register`: Register a new user
- `POST /api/auth/login`: User login
- `POST /api/auth/logout`: User logout
- `POST /api/auth/request-password-reset`: Request password reset
- `POST /api/auth/reset-password`: Reset password
- `POST /api/auth/verify-email`: Verify email

### User Profile

- `GET /api/users/me`: Get current user profile
- `PUT /api/users/me`: Update current user profile
- `GET /api/users/me/addresses`: Get user addresses
- `POST /api/users/me/addresses`: Add a new address
- `PUT /api/users/me/addresses/:addressId`: Update an address
- `DELETE /api/users/me/addresses/:addressId`: Delete an address

### Bakeries

- `GET /api/bakeries`: List all approved bakeries
- `GET /api/bakeries/:bakeryId`: Get bakery details
- `POST /api/bakeries`: Register a new bakery
- `PUT /api/bakeries/:bakeryId`: Update bakery details
- `GET /api/bakeries/:bakeryId/products`: Get bakery products
- `GET /api/bakeries/:bakeryId/reviews`: Get bakery reviews

### Restaurants

- `GET /api/restaurants`: List all approved restaurants
- `GET /api/restaurants/:restaurantId`: Get restaurant details
- `POST /api/restaurants`: Register a new restaurant
- `PUT /api/restaurants/:restaurantId`: Update restaurant details
- `GET /api/restaurants/:restaurantId/products`: Get restaurant products
- `GET /api/restaurants/:restaurantId/reviews`: Get restaurant reviews

### Products

- `GET /api/products`: List all products
- `GET /api/products/:productId`: Get product details
- `POST /api/products`: Add a new product
- `PUT /api/products/:productId`: Update a product
- `DELETE /api/products/:productId`: Delete a product
- `GET /api/products/:productId/reviews`: Get product reviews

### Orders

- `POST /api/orders`: Create a new order
- `GET /api/orders`: Get user orders
- `GET /api/orders/:orderId`: Get order details
- `PUT /api/orders/:orderId/status`: Update order status
- `POST /api/orders/:orderId/cancel`: Cancel an order

### Reviews

- `POST /api/reviews`: Submit a new review
- `PUT /api/reviews/:reviewId`: Update a review
- `DELETE /api/reviews/:reviewId`: Delete a review

### Notifications

- `GET /api/notifications`: Get user notifications
- `PUT /api/notifications/:notificationId/read`: Mark notification as read
- `PUT /api/notifications/read-all`: Mark all notifications as read

## Error Handling

The API uses standard HTTP status codes and returns error responses in the following format:

```json
{
  "status": "fail",
  "message": "Error message"
}
```

## Authentication

The API uses JWT (JSON Web Token) for authentication. Include the token in the Authorization header:

```
Authorization: Bearer your_jwt_token
```

## Development

### Prisma Schema Updates

If you need to modify the database schema:

1. Update the schema in `prisma/schema.prisma`
2. Generate a migration:
   ```
   npx prisma migrate dev --name your_migration_name
   ```
3. Apply the migration:
   ```
   npx prisma migrate deploy
   ```
4. Regenerate the Prisma Client:
   ```
   npx prisma generate
   ```

### Troubleshooting

- If you encounter database connection issues, verify your DATABASE_URL in the .env file
- For Prisma Client generation errors, try deleting the `node_modules/.prisma` folder and regenerating
- **Windows Users:**
  - If you encounter `ECONNRESET` errors during Prisma installation, see [WINDOWS_PRISMA_FIX.md](./WINDOWS_PRISMA_FIX.md) for detailed solutions
  - If you get `Environment variable not found: DATABASE_URL`, see [WINDOWS_ENV_SETUP.md](./WINDOWS_ENV_SETUP.md) for environment variable setup

## Payments (Stripe + COD, Provider Abstraction)

### Environment Variables

Set these in `.env`:

```bash
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_SUCCESS_URL=http://localhost:3004/checkout/success
STRIPE_CANCEL_URL=http://localhost:3004/checkout/cancel
DEFAULT_CURRENCY=JOD
ENABLE_NOON_PAYMENTS=false
ENABLE_ORDER_EMAILS=true
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_smtp_username
SMTP_PASS=your_smtp_password
SMTP_FROM_EMAIL=no-reply@khubzati.com
SMTP_FROM_NAME=Khubzati
```

### Payment Architecture

- `src/services/payments/payment-provider.js`: provider interface
- `src/services/payments/stripe-payment-provider.js`: Stripe implementation
- `src/services/payments/noon-payment-provider.js`: Noon placeholder (future fallback)
- `src/services/payments/payment-service.js`: provider selection + order payment lifecycle
- `webhook_events` table: webhook idempotency (`provider + event_id` unique)

### Source of Truth

- Frontend redirect pages are **not** trusted for payment confirmation
- Online card orders become `PAID` only from Stripe webhook events
- Supported webhook events:
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `checkout.session.completed`

### API Endpoints

#### 1) `POST /v1/orders`
Create order with payment method.

Request:
```json
{
  "bakeryId": "ca532d39-e6b5-4144-bc6a-3ff82ba31a14",
  "orderType": "delivery",
  "deliveryAddressId": "a1b2c3d4",
  "paymentMethod": "ONLINE_CARD",
  "items": [
    { "productId": "3c15cead-442f-429f-8935-729bdaf8d476", "quantity": 10 }
  ]
}
```

COD behavior:
- `paymentStatus = COD_PENDING`
- order is confirmed immediately
- Stripe is not called

#### 2) `POST /v1/payments/create-session`
Create one Stripe Checkout session per order.

Request:
```json
{ "orderId": "order_uuid" }
```

Response:
```json
{
  "status": "success",
  "data": {
    "orderId": "order_uuid",
    "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_test_...",
    "provider": "stripe",
    "providerSessionId": "cs_test_...",
    "providerPaymentId": "pi_...",
    "amount": 20,
    "currency": "JOD"
  }
}
```

#### 3) `POST /v1/payments/webhooks/stripe`
Stripe webhook endpoint with signature verification and idempotency.

#### 4) `POST /v1/orders/:id/mark-cod-collected`
Admin/vendor action to mark COD received.

#### 5) `GET /v1/orders/:id/payment-status`
Read current payment status/provider metadata.

#### 6) Daily Recurring Orders (Auto-Renew)

To enable automatic daily renewal, create order with:

```json
{
  "repeatMode": "daily",
  "paymentMethod": "CASH_ON_DELIVERY"
}
```

Notes:
- Daily recurring currently supports COD only.
- Backend stores a recurring template and generates the same order automatically every 24h.
- Inventory is revalidated on each renewal; if stock is insufficient, renewal is skipped and logged.
- Renewal worker is controlled by `ENABLE_RECURRING_ORDER_WORKER=true`.

Management endpoints:
- `GET /v1/orders/recurring`
- `PATCH /v1/orders/recurring/:id` with body `{ "isActive": true|false }`

### Flutter Integration Contract

1. Create order:
   - `paymentMethod = ONLINE_CARD` or `CASH_ON_DELIVERY`
2. If `ONLINE_CARD`:
   - call `POST /v1/payments/create-session`
   - open `checkoutUrl` in browser/webview
   - show pending state until backend webhook updates order to `PAID` or `FAILED`
3. If `CASH_ON_DELIVERY`:
   - no Stripe call
   - order is created with `COD_PENDING`

### Security Notes

- Never mark online orders as paid from frontend redirect callback
- Backend validates order ownership and amount before creating checkout session
- Webhook signature is verified using `STRIPE_WEBHOOK_SECRET`
- Duplicate webhook events are skipped via `webhook_events` unique constraint

### Order Confirmation Emails

- COD orders: confirmation email is sent immediately after order creation
- Online card orders: confirmation email is sent only after Stripe webhook confirms payment (`PAID`)
- Email sending is backend-driven and optional. If SMTP is not configured, order flow still succeeds and logs the email error.

## Production Baseline Checklist

### 1) Required environment variables in production

- `NODE_ENV=production`
- `DATABASE_URL`
- `DIRECT_URL`
- `JWT_SECRET`
- `CORS_ORIGINS` (comma-separated HTTPS origins, for example `https://khubzati.com,https://admin.khubzati.com`)

If `PAYMENT_MODE=live`, these are also required:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Notes:

- `ENABLE_STUB_RESPONSES=true` is blocked in production startup.
- Missing required vars fail fast at boot with a clear error.

### 2) CORS policy

- Production only allows origins listed in `CORS_ORIGINS`.
- Unknown browser origins are rejected.
- Requests without `Origin` header (for example native mobile/server-to-server) are still allowed.

### 3) Migrations and ORM direction

- Runtime API uses Prisma (`@prisma/client`) for active routes and services.
- Driver operations and push token persistence are part of the active Prisma domain (`DriverProfile`, `DeliveryAssignment`, `DeviceToken`).
- Production migration command is:
  - `npm run db:migrate`
- Local schema workflow:
  - `npm run db:migrate:dev`
  - `npm run db:generate`
- Legacy Sequelize files/scripts are kept temporarily for historical compatibility only:
  - `npm run db:legacy:sequelize:migrate`
  - `npm run db:legacy:sequelize:undo`

### 4) Upload storage

- Current default is `UPLOAD_STORAGE_DRIVER=local` and files are stored under `uploads/`.
- Max upload size can be configured with `UPLOAD_MAX_FILE_SIZE_BYTES` (default 10MB).
- Local uploads are git-ignored.
- File type signature checks, file size limits, and safe generated filenames are enforced in the upload route.
- `UPLOAD_STORAGE_DRIVER` is prepared as a config seam; non-local drivers are currently warned and fallback to local.
- TODO: plug S3/R2/GCS adapter + signed URLs for production object storage.

### 5) Health and readiness

- `GET /health`: liveness check
- `GET /ready`: readiness check that includes a database connectivity probe
- `x-request-id` is returned on API responses to help correlate client errors with backend logs.

### 5) CI commands (backend repo)

- `npm ci`
- `npm run lint`
- `npm test`
- `npm run build`
- smoke start check via `npm start`

## License

[MIT](LICENSE)
