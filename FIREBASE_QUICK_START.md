# Firebase Authentication - Quick Start ✅

## 🎉 What's Been Set Up

### Backend (✅ Complete)
1. ✅ **Firebase Admin SDK Service** (`src/services/firebaseAdmin.js`)
   - Centralized Firebase initialization
   - Token verification helper

2. ✅ **Firebase Login Endpoint** (`/v1/auth/login-with-firebase`)
   - Verifies Firebase ID tokens
   - Creates/logs in users
   - Returns JWT tokens

3. ✅ **Firebase Admin SDK** installed (`firebase-admin`)

### Flutter App (✅ Complete)
1. ✅ **Firebase Login Method** (`AuthService.loginWithFirebase()`)
   - Sends Firebase ID token to backend
   - Handles authentication response

2. ✅ **API Constant** (`ApiConstants.loginWithFirebase`)
   - Endpoint constant added

## 🚀 What You Need to Do

### Step 1: Configure Firebase Admin SDK (5 minutes)

1. **Get Service Account JSON:**
   - Go to: https://console.firebase.google.com/
   - Select your project → Settings → Service accounts
   - Click "Generate new private key"
   - Download the JSON file

2. **Add to `.env` file:**
   ```env
   FIREBASE_PROJECT_ID=your-project-id
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
   ```

3. **Restart backend:**
   ```bash
   npm run start:dev
   ```

   You should see: `✅ Firebase Admin SDK initialized successfully`

### Step 2: Update Flutter App to Use Firebase Login

After Firebase phone verification succeeds in your Flutter app:

```dart
// In your login/signup flow, after Firebase verification:
final user = FirebaseAuth.instance.currentUser;
if (user != null) {
  final idToken = await user.getIdToken();
  
  // Login to backend
  final authService = AuthService();
  try {
    final response = await authService.loginWithFirebase(idToken: idToken);
    // User is now logged in! JWT token is saved automatically
    // Navigate to home screen
  } catch (e) {
    // Handle error
  }
}
```

## 📋 Complete Flow

```
1. User enters phone number in Flutter app
   ↓
2. Firebase Auth sends SMS automatically
   ↓
3. User enters OTP code
   ↓
4. Firebase verifies OTP
   ↓
5. Get Firebase ID token
   ↓
6. Send token to backend: POST /v1/auth/login-with-firebase
   ↓
7. Backend verifies token & creates/logs in user
   ↓
8. Backend returns JWT token
   ↓
9. User is logged in! 🎉
```

## 🔍 Testing

### Test Backend Endpoint:
```bash
# Get a Firebase ID token from your Flutter app first
curl -X POST http://localhost:3000/v1/auth/login-with-firebase \
  -H "Content-Type: application/json" \
  -d '{"idToken": "YOUR_FIREBASE_ID_TOKEN"}'
```

### Expected Response:
```json
{
  "status": "success",
  "data": {
    "token": "your-jwt-token",
    "user": { ... }
  },
  "message": "Login successful"
}
```

## 📚 Documentation

- **Full Setup Guide:** `FIREBASE_SETUP_GUIDE.md`
- **Backend Service:** `src/services/firebaseAdmin.js`
- **Backend Endpoint:** `src/routes/auth.js` (line 915)
- **Flutter Service:** `lib/features/auth/data/services/auth_service.dart`

## ✅ Checklist

- [ ] Firebase service account JSON downloaded
- [ ] Environment variables added to `.env`
- [ ] Backend restarted and shows "Firebase Admin SDK initialized"
- [ ] Flutter app updated to call `loginWithFirebase()` after Firebase verification
- [ ] Tested complete flow end-to-end

## 🎯 Benefits

✅ **No SMS costs** - Firebase handles SMS automatically  
✅ **Free tier** - 10,000 verifications/month free  
✅ **Less code** - Firebase handles retries, rate limiting, etc.  
✅ **Secure** - Firebase manages security best practices  
✅ **Already working** - Your Flutter app already uses Firebase Auth!

## 💡 Next Steps

1. Configure Firebase Admin SDK (see Step 1 above)
2. Update Flutter app to use `loginWithFirebase()` after Firebase verification
3. Test the complete authentication flow
4. Remove or disable backend OTP generation (optional - can keep as fallback)

---

**Need help?** Check `FIREBASE_SETUP_GUIDE.md` for detailed instructions.

