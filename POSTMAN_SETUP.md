# Postman Collection Setup Guide

This guide will help you import and use the Khubzati API Postman collection.

## 📥 Importing the Collection

### Method 1: Import from File

1. **Open Postman**
2. Click **Import** button (top left)
3. Click **Upload Files** or drag and drop:
   - `Khubzati_API.postman_collection.json`
   - `Khubzati_API.postman_environment.json`
4. Click **Import**

### Method 2: Import via Link (if uploaded to a repository)

1. Click **Import** → **Link**
2. Paste the collection/environment URL
3. Click **Import**

## 🔧 Setting Up Environment

1. **After importing**, you'll see:
   - `Khubzati API` collection in the left sidebar
   - `Khubzati API - Local` environment

2. **Select the environment:**
   - Click the environment dropdown (top right)
   - Select `Khubzati API - Local`

3. **Update environment variables** (if needed):
   - Click the eye icon (👁️) next to the environment dropdown
   - Or go to **Environments** → `Khubzati API - Local`
   - Update variables:
     - `baseUrl`: `http://localhost:3000` (default)
     - `adminEmail`: Your admin email (default: `admin@khubzati.com`)
     - `adminPassword`: Your admin password (default: `Admin@1234`)

## 🚀 Quick Start

### 1. Start Your API Server

```bash
cd "khubzati_api_project 2"
npm run start:dev
```

### 2. Test the Server

1. Open the collection: **Khubzati API**
2. Run: **Health Check** request
3. You should get a success response

### 3. Login (Auto-saves Token)

1. Go to **Authentication** → **Login**
2. The request is pre-configured with `{{adminEmail}}` and `{{adminPassword}}`
3. Click **Send**
4. **Token is automatically saved** to `{{authToken}}` environment variable!

### 4. Use Authenticated Endpoints

After login, all authenticated endpoints will automatically use the saved token via the `{{authToken}}` variable in the Authorization header.

## 📋 Collection Structure

The collection is organized into folders:

- **Health Check** - Test if server is running
- **Authentication** - Register, Login, Logout, Password Reset
- **Users** - User profile and address management
- **Bakeries** - Browse and manage bakeries
- **Restaurants** - Browse and manage restaurants
- **Products** - Product catalog operations
- **Orders** - Order creation and management
- **Reviews** - Review submission and management
- **Notifications** - User notifications
- **Admin** - Admin-only endpoints

## 🔑 Automatic Token Management

### Login Requests Auto-Save Token

The following requests automatically save your token after successful login:

- `Authentication → Login`
- `Authentication → Login with Email`
- `Authentication → Login with Username`
- `Admin → Admin Login`

**How it works:**
- After a successful login (status 200), the test script extracts the token from the response
- Token is saved to `{{authToken}}` environment variable
- All subsequent requests use `Bearer {{authToken}}` automatically

### Manual Token Update

If you need to manually set a token:

1. Go to **Environments** → `Khubzati API - Local`
2. Find `authToken` variable
3. Paste your JWT token
4. Click **Save**

## 📝 Using Variables

The collection uses Postman variables for flexibility:

| Variable | Default Value | Description |
|----------|--------------|-------------|
| `baseUrl` | `http://localhost:3000` | API base URL |
| `authToken` | *(auto-filled)* | JWT authentication token |
| `userId` | *(auto-filled)* | Current user ID |
| `userRole` | *(auto-filled)* | Current user role |
| `adminEmail` | `admin@khubzati.com` | Admin login email |
| `adminPassword` | `Admin@1234` | Admin login password |

### Path Variables

Some requests use path variables that you need to update:

- `:userId` - Replace with actual user ID
- `:bakeryId` - Replace with actual bakery ID
- `:restaurantId` - Replace with actual restaurant ID
- `:productId` - Replace with actual product ID
- `:orderId` - Replace with actual order ID
- `:reviewId` - Replace with actual review ID
- `:addressId` - Replace with actual address ID
- `:notificationId` - Replace with actual notification ID

## 🔄 Workflow Example

### Complete User Flow:

1. **Register a new user:**
   - `Authentication → Register User`
   - Token is saved automatically

2. **Get user profile:**
   - `Users → Get Current User Profile`
   - Uses saved token automatically

3. **Add an address:**
   - `Users → Add User Address`
   - Update the request body with your address details

4. **Browse bakeries:**
   - `Bakeries → List All Bakeries`
   - No authentication needed

5. **Create an order:**
   - `Orders → Create Order`
   - Update `bakeryId`, `productId`, `deliveryAddressId` with real values

### Admin Flow:

1. **Admin login:**
   - `Admin → Admin Login`
   - Token is saved automatically

2. **View all users:**
   - `Admin → Get All Users`

3. **View vendors:**
   - `Admin → Get All Vendors`

4. **Approve a vendor:**
   - `Admin → Approve Vendor`
   - Update `:vendorId` with actual ID

## 🌐 Changing Base URL

To test against different environments:

1. Go to **Environments** → `Khubzati API - Local`
2. Update `baseUrl`:
   - **Local:** `http://localhost:3000`
   - **Production:** `https://api.khubzati.com`
   - **Staging:** `https://staging-api.khubzati.com`

Or create a new environment for each base URL.

## 💡 Tips

### Query Parameters

Many GET requests support query parameters. Enable/disable them in the request:

- Click the request
- Go to **Params** tab
- Toggle parameters on/off

Example: `List All Bakeries` supports:
- `page` - Page number
- `limit` - Items per page
- `city` - Filter by city
- `search_term` - Search term

### Request Body

Most POST/PUT requests have example bodies. Customize them:

1. Click the request
2. Go to **Body** tab
3. Edit the JSON
4. Replace placeholder values with real data

### Testing Multiple Scenarios

Create environment duplicates for different test scenarios:

1. Duplicate `Khubzati API - Local` environment
2. Rename to `Khubzati API - Test User 1`
3. Use different credentials
4. Test different user roles

## 🐛 Troubleshooting

### Token Not Saving

- Check if login request returned status 200
- Verify response contains `data.token`
- Check Postman console for errors (View → Show Postman Console)

### 401 Unauthorized

- Token might be expired (24 hours default)
- Run login request again
- Verify `{{authToken}}` is set in environment

### 404 Not Found

- Verify server is running on `{{baseUrl}}`
- Check endpoint path is correct
- Verify path variables (like `:userId`) are set

### CORS Errors

- Verify CORS is enabled on your API server
- Check `baseUrl` matches your server URL

## 📚 Additional Resources

- [Postman Documentation](https://learning.postman.com/docs/)
- [API Running Guide](./API_RUNNING_GUIDE.md)
- [API README](./README.md)

