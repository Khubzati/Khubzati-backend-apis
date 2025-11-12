# Khubzati API - Running Guide & Request Examples

## 📋 Prerequisites

Before running the API, ensure you have:
- Node.js (v14 or higher)
- PostgreSQL database running
- Environment variables configured

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd "khubzati_api_project 2"
npm install
```

### 2. Setup Environment Variables

The `.env` file should contain:

```env
NODE_ENV=development
APP_PORT=3000

# Database Configuration (choose one):
# Option A: Direct PostgreSQL connection
DATABASE_URL="postgresql://username:password@localhost:5432/khubzati?schema=public"
DIRECT_URL="postgresql://username:password@localhost:5432/khubzati?schema=public"

# Option B: Supabase (if using Supabase)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# JWT Configuration
JWT_SECRET=your_super_secret_jwt_key_here_minimum_32_characters
JWT_EXPIRES_IN=24h

# Admin Credentials (for create-admin script)
ADMIN_EMAIL=admin@khubzati.com
ADMIN_PASSWORD=Admin@1234
ADMIN_USERNAME=admin
ADMIN_FULL_NAME=Administrator
```

### 3. Setup Database

```bash
# Generate Prisma Client
npx prisma generate

# Run database migrations
npx prisma migrate deploy

# Or for development with migrations
npx prisma migrate dev
```

### 4. Create Admin User (Optional)

```bash
# Using default credentials
npm run create-admin

# Or with custom credentials
ADMIN_EMAIL=myadmin@example.com ADMIN_PASSWORD=MySecurePass123 npm run create-admin
```

### 5. Start the Server

**Development Mode (with auto-reload):**
```bash
npm run start:dev
```

**Production Mode:**
```bash
npm start
```

The server will start on `http://localhost:3000` (or the port specified in `APP_PORT`)

## 🌐 API Base URL

- **Local Development:** `http://localhost:3000`
- API supports both `/api/*` and `/v1/*` endpoints

## 📡 Making Requests

### Testing the Server

First, verify the server is running:

```bash
curl http://localhost:3000/
```

**Response:**
```json
{
  "status": "success",
  "message": "Welcome to Khubzati API",
  "version": "1.0.0"
}
```

### Authentication Endpoints

#### 1. Register a New User

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "john_doe",
    "email": "john@example.com",
    "password": "SecurePass123",
    "fullName": "John Doe",
    "phoneNumber": "+966501234567",
    "role": "customer"
  }'
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "user": {
      "id": 1,
      "username": "john_doe",
      "email": "john@example.com",
      "fullName": "John Doe",
      "role": "customer",
      "isVerified": false
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

#### 2. Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "emailOrPhone": "john@example.com",
    "password": "SecurePass123"
  }'
```

**Alternative login formats:**
```json
// Using email
{ "email": "john@example.com", "password": "SecurePass123" }

// Using username
{ "username": "john_doe", "password": "SecurePass123" }

// Using phone number
{ "phoneNumber": "+966501234567", "password": "SecurePass123" }
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "user": {
      "id": 1,
      "username": "john_doe",
      "email": "john@example.com",
      "fullName": "John Doe",
      "role": "customer"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Save the token for authenticated requests:**
```bash
export TOKEN="your_jwt_token_here"
```

### Authenticated Requests

After login, include the token in the Authorization header:

```bash
curl -X GET http://localhost:3000/api/users/me \
  -H "Authorization: Bearer $TOKEN"
```

#### 3. Get Current User Profile

```bash
curl -X GET http://localhost:3000/api/users/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

#### 4. Update User Profile

```bash
curl -X PUT http://localhost:3000/api/users/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "John Updated Doe",
    "phoneNumber": "+966501234568"
  }'
```

### Using cURL Examples

#### Create an Order
```bash
curl -X POST http://localhost:3000/api/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "productId": 1,
        "quantity": 2,
        "price": 25.50
      }
    ],
    "deliveryAddressId": 1,
    "paymentMethod": "credit_card"
  }'
```

#### Get All Bakeries
```bash
curl -X GET http://localhost:3000/api/bakeries \
  -H "Content-Type: application/json"
```

#### Get User Orders
```bash
curl -X GET http://localhost:3000/api/orders \
  -H "Authorization: Bearer $TOKEN"
```

### Using JavaScript/Fetch Examples

```javascript
// Login
const loginResponse = await fetch('http://localhost:3000/api/auth/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    emailOrPhone: 'admin@khubzati.com',
    password: 'Admin@1234'
  })
});

const { data } = await loginResponse.json();
const token = data.token;

// Get user profile
const profileResponse = await fetch('http://localhost:3000/api/users/me', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});

const profile = await profileResponse.json();
console.log(profile);
```

### Using Postman

1. **Setup:**
   - Base URL: `http://localhost:3000`
   - Create environment variable: `baseUrl = http://localhost:3000`
   - Create environment variable: `token` (will be set after login)

2. **Login Request:**
   - Method: `POST`
   - URL: `{{baseUrl}}/api/auth/login`
   - Body (raw JSON):
     ```json
     {
       "emailOrPhone": "admin@khubzati.com",
       "password": "Admin@1234"
     }
     ```
   - Tests tab (to save token):
     ```javascript
     const response = pm.response.json();
     if (response.data && response.data.token) {
       pm.environment.set("token", response.data.token);
     }
     ```

3. **Authenticated Request:**
   - Method: `GET`
   - URL: `{{baseUrl}}/api/users/me`
   - Headers: `Authorization: Bearer {{token}}`

## 🔐 Authentication

All protected endpoints require a JWT token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

Tokens expire after 24 hours (configurable via `JWT_EXPIRES_IN`).

## 📚 Available Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `POST /api/auth/request-password-reset` - Request password reset
- `POST /api/auth/reset-password` - Reset password
- `POST /api/auth/verify-email` - Verify email

### Users
- `GET /api/users/me` - Get current user profile
- `PUT /api/users/me` - Update current user profile
- `GET /api/users/me/addresses` - Get user addresses
- `POST /api/users/me/addresses` - Add new address
- `PUT /api/users/me/addresses/:addressId` - Update address
- `DELETE /api/users/me/addresses/:addressId` - Delete address

### Bakeries
- `GET /api/bakeries` - List all approved bakeries
- `GET /api/bakeries/:bakeryId` - Get bakery details
- `POST /api/bakeries` - Register new bakery
- `GET /api/bakeries/:bakeryId/products` - Get bakery products
- `GET /api/bakeries/:bakeryId/reviews` - Get bakery reviews

### Products
- `GET /api/products` - List all products
- `GET /api/products/:productId` - Get product details
- `POST /api/products` - Add new product (requires authentication)
- `PUT /api/products/:productId` - Update product
- `DELETE /api/products/:productId` - Delete product

### Orders
- `POST /api/orders` - Create new order (requires authentication)
- `GET /api/orders` - Get user orders (requires authentication)
- `GET /api/orders/:orderId` - Get order details
- `PUT /api/orders/:orderId/status` - Update order status
- `POST /api/orders/:orderId/cancel` - Cancel order

### Admin (requires admin role)
- `GET /api/admin/users` - List all users
- `GET /api/admin/vendors` - List all vendors
- `PUT /api/admin/users/:userId` - Update user
- `PUT /api/admin/vendors/:vendorId/approve` - Approve vendor

**Note:** All endpoints are also available under `/v1/*` prefix for backward compatibility.

## 🛠️ Troubleshooting

### Database Connection Issues
- Verify `DATABASE_URL` in `.env` is correct
- Ensure PostgreSQL is running
- Check database credentials

### Port Already in Use
```bash
# Find process using port 3000
lsof -ti:3000

# Kill the process
kill -9 $(lsof -ti:3000)
```

### Prisma Client Not Generated
```bash
npx prisma generate
```

### JWT Token Errors
- Ensure `JWT_SECRET` is set in `.env`
- Use a secure, random string (minimum 32 characters)
- Restart the server after changing `JWT_SECRET`

## 📝 Example Workflow

1. **Start the server:**
   ```bash
   npm run start:dev
   ```

2. **Create admin user:**
   ```bash
   npm run create-admin
   ```

3. **Login as admin:**
   ```bash
   curl -X POST http://localhost:3000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"emailOrPhone": "admin@khubzati.com", "password": "Admin@1234"}'
   ```

4. **Use the token for authenticated requests:**
   ```bash
   export TOKEN="your_token_here"
   curl -X GET http://localhost:3000/api/users/me \
     -H "Authorization: Bearer $TOKEN"
   ```

## 🎯 Testing with the Admin Interface

The admin interface should connect to this API. Make sure:
- API is running on `http://localhost:3000`
- Admin credentials are created using `npm run create-admin`
- CORS is enabled (already configured in the API)

