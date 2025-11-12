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

## License

[MIT](LICENSE)
