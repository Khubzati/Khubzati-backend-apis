# Khubzati Development Todo List

## Phase 1: Setup and Authentication

- [X] Set up development environment (Node.js, Express, Sequelize) - Done (npm install)
- [X] Initialize project structure (folders for routes, controllers, models, etc.) - Done (exists, and created utils/config/messages)
- [X] Configure database connection (based on schema, likely PostgreSQL or MySQL) - Implicitly done via Sequelize setup
- [X] Implement basic server setup (app.js or index.js) - app.js exists and updated
- [X] Plan for dual-language support in API responses (e.g., error messages, success messages) - Done (strategy doc, handler, message files)
- [X] Implement User Registration endpoint (`POST /auth/register`)
- [X] Implement User Login endpoint (`POST /auth/login`)
- [X] Implement JWT generation and validation middleware (`protect`, `authorize`)
- [X] Implement User Logout endpoint (`POST /auth/logout`)
- [X] Implement Refresh Token endpoint (`POST /auth/refresh-token`) - Placeholder implemented
- [X] Implement Request Password Reset endpoint (`POST /auth/request-password-reset`) - Placeholder implemented
- [X] Implement Reset Password endpoint (`POST /auth/reset-password`) - Placeholder implemented
- [X] Implement Verify Email endpoint (`POST /auth/verify-email`) - Placeholder implemented
- [ ] Test Authentication endpoints (EN/AR)

## Phase 2: User Profile & Addresses

- [X] Implement Get User Profile endpoint (`GET /users/me`)
- [X] Implement Update User Profile endpoint (`PUT /users/me`)
- [X] Implement Get User Addresses endpoint (`GET /users/me/addresses`)
- [X] Implement Add User Address endpoint (`POST /users/me/addresses`)
- [X] Implement Update User Address endpoint (`PUT /users/me/addresses/{addressId}`)
- [X] Implement Delete User Address endpoint (`DELETE /users/me/addresses/{addressId}`)
- [ ] Test User Profile and Address endpoints (EN/AR)

## Phase 3: Bakery & Restaurant Management

- [X] Implement List Bakeries endpoint (`GET /bakeries`)
- [X] Implement Get Bakery Details endpoint (`GET /bakeries/{bakeryId}`)
- [X] Implement Register Bakery endpoint (`POST /bakeries`) (Requires bakery_owner role)
- [X] Implement Update Bakery endpoint (`PUT /bakeries/{bakeryId}`) (Requires bakery_owner role or admin)
- [X] Implement Approve/Reject/Suspend Bakery endpoint (`PUT /bakeries/admin/:bakeryId/status`) (Requires admin)
- [X] Implement Delete Bakery endpoint (`DELETE /bakeries/admin/:bakeryId`) (Requires admin)
- [X] Implement List Restaurants endpoint (`GET /restaurants`)
- [X] Implement Get Restaurant Details endpoint (`GET /restaurants/{restaurantId}`)
- [X] Implement Register Restaurant endpoint (`POST /restaurants`) (Requires restaurant_owner role)
- [X] Implement Update Restaurant endpoint (`PUT /restaurants/{restaurantId}`) (Requires restaurant_owner role or admin)
- [X] Implement Approve/Reject/Suspend Restaurant endpoint (`PUT /restaurants/admin/:restaurantId/status`) (Requires admin)
- [X] Implement Delete Restaurant endpoint (`DELETE /restaurants/admin/:restaurantId`) (Requires admin)
- [ ] Test Bakery and Restaurant Management endpoints (EN/AR)

## Phase 4: Product & Category Management

- [X] Implement List Products endpoint (`GET /products`)
- [X] Implement Get Product Details endpoint (`GET /products/{productId}`)
- [X] Implement Add Product endpoint (`POST /products`) (Requires bakery_owner/restaurant_owner role)
- [X] Implement Update Product endpoint (`PUT /products/{productId}`) (Requires owner role)
- [X] Implement Delete Product endpoint (`DELETE /products/{productId}`) (Requires owner role)
- [X] Implement List Categories endpoint (`GET /categories`)
- [X] Implement Get Category Details endpoint (`GET /categories/{categoryId}`)
- [X] Implement Create Category endpoint (`POST /categories`) (Requires admin role)
- [X] Implement Update Category endpoint (`PUT /categories/{categoryId}`) (Requires admin role)
- [X] Implement Delete Category endpoint (`DELETE /categories/{categoryId}`) (Requires admin role)
- [ ] Test Product and Category Management endpoints (EN/AR)

## Phase 5: Cart & Order Management

- [X] Implement Get Cart endpoint (`GET /cart`)
- [X] Implement Add Item to Cart endpoint (`POST /cart/items`)
- [X] Implement Update Cart Item endpoint (`PUT /cart/items/{cartItemId}`)
- [X] Implement Remove Item from Cart endpoint (`DELETE /cart/items/{cartItemId}`)
- [X] Implement Clear Cart endpoint (`DELETE /cart`)
- [X] Implement Create Order endpoint (`POST /orders`)
- [X] Implement List Orders endpoint (`GET /orders`) (User sees their orders, admin/owner sees relevant orders)
- [X] Implement Get Order Details endpoint (`GET /orders/{orderId}`)
- [X] Implement Update Order Status endpoint (`PUT /orders/{orderId}/status`) (Requires owner/admin role)
- [X] Implement Cancel Order endpoint (`POST /orders/{orderId}/cancel`)
- [ ] Test Cart and Order Management endpoints (EN/AR)

## Phase 6: Reviews, Notifications, Admin, Payments, Drivers

- [X] Implement Submit Review endpoint (`POST /reviews`)
- [X] Implement Get Reviews for Product/Bakery/Restaurant (`GET /reviews?productId=X` or `GET /reviews?bakeryId=X` etc.)
- [X] Implement Update Review endpoint (`PUT /reviews/{reviewId}`)
- [X] Implement Delete Review endpoint (`DELETE /reviews/{reviewId}`)
- [X] Implement Get Notifications endpoint (`GET /notifications`)
- [X] Implement Mark Notification Read endpoint (`PUT /notifications/{notificationId}/read`)
- [X] Implement Mark All Notifications Read endpoint (`PUT /notifications/read-all`)
- [X] Implement Admin endpoints (User list, details, status update; Dashboard Summary)
- [ ] Implement Payment processing endpoints (e.g., `POST /orders/{orderId}/payments`, webhook) - **Further discussion needed for implementation details**
- [ ] Design and Implement Driver Management and Delivery Tracking endpoints - **Confirmation and details needed**
- [ ] Test Reviews, Notifications, and Admin endpoints (EN/AR)
- [ ] Test Payment processing endpoints (EN/AR) (once implemented)
- [ ] Test Driver Management endpoints (EN/AR) (once implemented)

## Phase 7: Finalization

- [ ] Comprehensive testing of all implemented endpoints and functionalities (EN/AR)
- [ ] Ensure dual-language support is correctly implemented in all responses (EN/AR)
- [ ] API Documentation (Swagger/OpenAPI) in English and Arabic
- [ ] Prepare final project deliverables
- [ ] Report completion and deliver to user
