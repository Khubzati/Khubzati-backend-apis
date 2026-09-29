# Config Directory

This directory is for storing configuration files that should **NOT** be committed to version control.

## Firebase Service Account

Place your Firebase service account JSON file here:

1. Download from Firebase Console:
   - Go to: https://console.firebase.google.com/
   - Select your project → Settings → Service accounts
   - Click "Generate new private key"
   - Download the JSON file

2. Rename and place it here:
   ```
   config/firebase-service-account.json
   ```

3. Update your `.env`:
   ```env
   FIREBASE_SERVICE_ACCOUNT_PATH=./config/firebase-service-account.json
   ```

## Security Note

⚠️ **NEVER commit Firebase service account files to Git!**

These files contain sensitive credentials. They are automatically ignored by `.gitignore`.

