require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { PrismaClient } = require('./generated/prisma');
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');

const prisma = new PrismaClient();
const app = express();

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const bakeryRoutes = require('./routes/bakeries'); // For customers viewing bakeries
const bakeryOwnerRoutes = require('./routes/bakery'); // For bakery owners managing their business
const restaurantRoutes = require('./routes/restaurants');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const reviewRoutes = require('./routes/reviews');
const notificationRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');
const uploadRoutes = require('./routes/upload');

// Middleware
app.use(helmet()); // Security headers
app.use(cors()); // Enable CORS
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// Routes - Support both /api/* and /v1/* for backward compatibility
// Frontend expects /v1/* based on baseUrl configuration
app.use('/api/auth', authRoutes);
app.use('/v1/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/v1/user', userRoutes); // Note: frontend uses singular /user
app.use('/api/bakeries', bakeryRoutes); // For customers viewing bakeries
app.use('/v1/bakeries', bakeryRoutes); // For customers viewing bakeries
app.use('/api/bakery', bakeryOwnerRoutes); // For bakery owners managing their business
app.use('/v1/bakery', bakeryOwnerRoutes); // For bakery owners managing their business - MATCHES FRONTEND
app.use('/api/restaurants', restaurantRoutes);
app.use('/v1/restaurant', restaurantRoutes); // Note: frontend uses singular /restaurant
app.use('/api/products', productRoutes);
app.use('/v1/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/v1/orders', orderRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/v1/reviews', reviewRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/v1/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/v1/admin', adminRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/v1/upload', uploadRoutes);

// Root route
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Welcome to Khubzati API',
    version: '1.0.0',
  });
});

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Start server
const PORT = process.env.APP_PORT || 3000;
app.listen(PORT, async () => {
  try {
    await prisma.$connect();
    console.log('Database connection has been established successfully.');
    console.log(`Server running on port ${PORT}`);
  } catch (error) {
    console.error('Unable to connect to the database:', error);
  }
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

module.exports = app;
