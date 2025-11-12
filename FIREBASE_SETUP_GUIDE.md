# Firebase Setup Guide for Backend

This guide will help you configure Firebase Admin SDK in your backend to verify Firebase ID tokens from your Flutter app.

## 📋 Prerequisites

1. ✅ Firebase project already set up (you're using it in Flutter)
2. ✅ Firebase Admin SDK package installed (`firebase-admin` - already installed)
3. ✅ Access to Firebase Console

## 🚀 Step-by-Step Setup

### Step 1: Get Firebase Service Account Credentials

1. **Go to Firebase Console:**
   - Visit: https://console.firebase.google.com/
   - Select your project (e.g., `khubzati-dev-131af`)

2. **Navigate to Project Settings:**
   - Click the gear icon ⚙️ next to "Project Overview"
   - Select "Project settings"

3. **Go to Service Accounts Tab:**
   - Click on "Service accounts" tab
   - You'll see "Firebase Admin SDK"

4. **Generate New Private Key:**
   - Click "Generate new private key" button
   - A JSON file will be downloaded (e.g., `khubzati-dev-131af-firebase-adminsdk-xxxxx.json`)

### Step 2: Extract Credentials from JSON

Open the downloaded JSON file. It will look like this:

```json
{
  "type": "service_account",
  "project_id": "khubzati-dev-131af",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-xxxxx@khubzati-dev-131af.iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "..."
}
```

### Step 3: Add to Environment Variables

Add these three values to your `.env` file in the backend:

```env
# Firebase Admin SDK Configuration
FIREBASE_PROJECT_ID=khubzati-dev-131af
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@khubzati-dev-131af.iam.gserviceaccount.com
```

**Important Notes:**
- `FIREBASE_PROJECT_ID`: Use the `project_id` from JSON
- `FIREBASE_PRIVATE_KEY`: Use the `private_key` from JSON (keep the `\n` characters)
- `FIREBASE_CLIENT_EMAIL`: Use the `client_email` from JSON

### Step 4: Format Private Key Correctly

The private key in `.env` should be on a single line with `\n` characters:

```env
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n"
```

**OR** you can use actual newlines (but single-line with `\n` is recommended):

```env
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...
-----END PRIVATE KEY-----"
```

### Step 5: Verify Setup

1. **Restart your backend server:**
   ```bash
   npm run start:dev
   ```

2. **Check console output:**
   You should see:
   ```
   ✅ Firebase Admin SDK initialized successfully
      Project ID: khubzati-dev-131af
   ```

3. **Test the endpoint:**
   ```bash
   # Get a Firebase ID token from your Flutter app first
   curl -X POST http://localhost:3000/v1/auth/login-with-firebase \
     -H "Content-Type: application/json" \
     -d '{"idToken": "YOUR_FIREBASE_ID_TOKEN_HERE"}'
   ```

## 🔧 Troubleshooting

### Error: "Firebase Admin SDK not initialized"

**Solution:**
1. Check that all three environment variables are set in `.env`
2. Verify the private key includes `\n` characters (not actual newlines)
3. Make sure the private key is wrapped in quotes in `.env`
4. Restart your server after adding environment variables

### Error: "Invalid or expired Firebase token"

**Solution:**
1. Make sure you're sending a valid Firebase ID token (not a custom token)
2. Token might have expired - get a fresh token from Flutter app
3. Verify Firebase project ID matches between client and server

### Error: "Firebase Admin SDK not available"

**Solution:**
```bash
npm install firebase-admin
```

## 📱 Flutter App Integration

After setting up the backend, update your Flutter app to use Firebase token login:

### Example Usage:

```dart
import 'package:firebase_auth/firebase_auth.dart';
import 'package:khubzati/features/auth/data/services/auth_service.dart';

// After Firebase phone verification succeeds
final user = FirebaseAuth.instance.currentUser;
if (user != null) {
  // Get Firebase ID token
  final idToken = await user.getIdToken();
  
  // Login to backend with Firebase token
  final authService = AuthService();
  final response = await authService.loginWithFirebase(idToken: idToken);
  
  // Backend returns your app's JWT token
  // User is now logged in!
}
```

## 🔐 Security Notes

1. **Never commit `.env` file** to version control
2. **Keep service account JSON file secure** - treat it like a password
3. **Rotate keys periodically** if compromised
4. **Use different service accounts** for dev/staging/production

## ✅ Verification Checklist

- [ ] Firebase service account JSON downloaded
- [ ] `FIREBASE_PROJECT_ID` added to `.env`
- [ ] `FIREBASE_PRIVATE_KEY` added to `.env` (with `\n` characters)
- [ ] `FIREBASE_CLIENT_EMAIL` added to `.env`
- [ ] Backend server restarted
- [ ] Console shows "Firebase Admin SDK initialized successfully"
- [ ] Test endpoint works with Firebase ID token

## 🎯 Next Steps

1. ✅ Backend is configured
2. 📱 Update Flutter app to call `/auth/login-with-firebase` after Firebase verification
3. 🧪 Test the complete flow:
   - Flutter app → Firebase Auth → SMS sent
   - User enters OTP → Firebase verifies
   - Get Firebase token → Send to backend
   - Backend verifies → Returns JWT token
   - User logged in!

## 📚 Related Files

- Backend service: `src/services/firebaseAdmin.js`
- Backend endpoint: `src/routes/auth.js` → `/login-with-firebase`
- Flutter service: `lib/features/auth/data/services/auth_service.dart` → `loginWithFirebase()`

## 💡 Alternative: Using Environment Variables Directly

If you prefer, you can also set these as system environment variables instead of `.env`:

```bash
export FIREBASE_PROJECT_ID="khubzati-dev-131af"
export FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
export FIREBASE_CLIENT_EMAIL="firebase-adminsdk-xxxxx@khubzati-dev-131af.iam.gserviceaccount.com"
```

Then restart your server.

