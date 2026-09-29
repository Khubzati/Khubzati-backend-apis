# Setting Up Environment Variables on Windows

## Problem
The error `Environment variable not found: DATABASE_URL` occurs because the `.env` file is missing or not properly configured.

## Solution

### Step 1: Create the `.env` file

1. **Copy the sample environment file:**
   ```cmd
   copy sample.env .env
   ```

2. **Or manually create `.env` file** in the project root directory with the following content:

```env
NODE_ENV=development
APP_PORT=3000

# Database Configuration
# Replace with your actual PostgreSQL connection string
DATABASE_URL="postgresql://username:password@localhost:5432/khubzati?schema=public"
DIRECT_URL="postgresql://username:password@localhost:5432/khubzati?schema=public"

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_SECRET_KEY=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=24h

# Admin Configuration
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=secure_password_here

# Supabase Configuration (Optional - for Next.js features)
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

### Step 2: Update Database Connection

Replace the `DATABASE_URL` and `DIRECT_URL` with your actual PostgreSQL connection details:

**Format:**
```
postgresql://USERNAME:PASSWORD@HOST:PORT/DATABASE_NAME?schema=public
```

**Example:**
```
DATABASE_URL="postgresql://postgres:mypassword@localhost:5432/khubzati?schema=public"
DIRECT_URL="postgresql://postgres:mypassword@localhost:5432/khubzati?schema=public"
```

### Step 3: Verify the File Location

Make sure the `.env` file is in the **root directory** of your project (same level as `package.json`):

```
Khubzati-backend-apis/
├── .env              ← Should be here
├── package.json
├── next.config.js
└── src/
```

### Step 4: Restart the Development Server

After creating/updating the `.env` file:

1. **Stop the current server** (Ctrl+C)
2. **Restart it:**
   ```cmd
   npm run dev
   ```

## Common Issues

### Issue 1: File Not Found
- **Solution:** Make sure the file is named exactly `.env` (not `.env.txt` or `env`)
- On Windows, you might need to create it from Command Prompt:
  ```cmd
  type nul > .env
  ```
  Then edit it with Notepad or your code editor

### Issue 2: Environment Variables Still Not Loading
- **Solution:** Make sure you're using Next.js 13+ which automatically loads `.env` files
- Try adding this to your API route (temporary fix):
  ```typescript
  import dotenv from 'dotenv';
  dotenv.config();
  ```

### Issue 3: Database Connection Fails
- **Solution:** Verify your PostgreSQL is running and credentials are correct
- Test connection with:
  ```cmd
  psql -U username -d khubzati -h localhost
  ```

## Quick Setup Script (Windows)

Create a file `setup-env.bat` in the project root:

```batch
@echo off
if not exist .env (
    copy sample.env .env
    echo .env file created! Please edit it with your database credentials.
) else (
    echo .env file already exists.
)
pause
```

Run it:
```cmd
setup-env.bat
```

## Verification

To verify your environment variables are loaded:

1. **Check in your code:**
   ```typescript
   console.log('DATABASE_URL:', process.env.DATABASE_URL);
   ```

2. **Or create a test endpoint:**
   ```typescript
   // src/app/api/test-env/route.ts
   export async function GET() {
       return Response.json({
           hasDatabaseUrl: !!process.env.DATABASE_URL,
           hasJwtSecret: !!process.env.JWT_SECRET
       });
   }
   ```

## Important Notes

- **Never commit `.env` to Git** - it should be in `.gitignore`
- **Use different values for production** - never use development credentials in production
- **Keep secrets secure** - don't share your `.env` file






