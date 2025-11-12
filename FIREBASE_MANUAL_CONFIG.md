# Firebase Manual Configuration Guide

## ✅ Two Configuration Methods Available

You can configure Firebase Admin SDK in **two ways**:

### Method 1: JSON File (Recommended for Local Development) ⭐

**Easiest method** - Just download the JSON file and point to it!

#### Steps:

1. **Download Service Account JSON:**
   - Go to: https://console.firebase.google.com/
   - Select your project → Settings → Service accounts
   - Click "Generate new private key"
   - Save the downloaded file

2. **Place in Config Directory:**
   ```bash
   # Create config directory if it doesn't exist
   mkdir -p config
   
   # Move the downloaded file
   mv ~/Downloads/your-project-firebase-adminsdk-xxxxx.json config/firebase-service-account.json
   ```

3. **Update `.env`:**
   ```env
   FIREBASE_SERVICE_ACCOUNT_PATH=./config/firebase-service-account.json
   ```

4. **Restart Server:**
   ```bash
   npm run start:dev
   ```

   You should see:
   ```
   ✅ Firebase Admin SDK initialized from JSON file
      File: /path/to/config/firebase-service-account.json
      Project ID: your-project-id
   ```

**Pros:**
- ✅ No manual copying of values
- ✅ Less error-prone
- ✅ Easy to update
- ✅ Perfect for local development

**Cons:**
- ⚠️ Need to manage file location
- ⚠️ Not ideal for CI/CD (use Method 2 instead)

---

### Method 2: Environment Variables (For Production/CI/CD)

**Better for production** - Use environment variables instead of files.

#### Steps:

1. **Download Service Account JSON** (same as Method 1)

2. **Extract Values:**
   Open the JSON file and copy these values:
   ```json
   {
     "project_id": "your-project-id",           // → FIREBASE_PROJECT_ID
     "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",  // → FIREBASE_PRIVATE_KEY
     "client_email": "firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com"  // → FIREBASE_CLIENT_EMAIL
   }
   ```

3. **Update `.env`:**
   ```env
   FIREBASE_PROJECT_ID=your-project-id
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
   FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
   ```

   **Important:** Keep the `\n` characters in the private key!

4. **Restart Server:**
   ```bash
   npm run start:dev
   ```

   You should see:
   ```
   ✅ Firebase Admin SDK initialized from environment variables
      Project ID: your-project-id
   ```

**Pros:**
- ✅ Works well with CI/CD
- ✅ No files to manage
- ✅ Can use secrets management services
- ✅ Better for production deployments

**Cons:**
- ⚠️ Need to manually copy values
- ⚠️ Private key formatting can be tricky

---

## 🎯 Which Method Should I Use?

| Scenario | Recommended Method |
|----------|-------------------|
| **Local Development** | Method 1 (JSON File) |
| **Production Server** | Method 2 (Environment Variables) |
| **Docker/Kubernetes** | Method 2 (Environment Variables) |
| **CI/CD Pipeline** | Method 2 (Environment Variables) |
| **Quick Setup** | Method 1 (JSON File) |

## 🔍 How It Works

The service automatically detects which method you're using:

1. **Checks for `FIREBASE_SERVICE_ACCOUNT_PATH`** first (Method 1)
2. **Falls back to environment variables** if path not set (Method 2)
3. **Shows helpful error** if neither is configured

## 🛠️ Troubleshooting

### Error: "Firebase service account file not found"

**Solution:**
- Check the path in `FIREBASE_SERVICE_ACCOUNT_PATH`
- Use absolute path if relative path doesn't work
- Verify file exists: `ls -la config/firebase-service-account.json`

### Error: "Firebase Admin SDK credentials not configured"

**Solution:**
- Make sure you set **ONE** of the two methods
- Don't set both (JSON file takes priority)
- Check `.env` file is loaded correctly

### Error: "Invalid private key format"

**Solution (Method 2 only):**
- Make sure private key is wrapped in quotes
- Keep `\n` characters (don't replace with actual newlines)
- Copy the entire key including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`

## 📁 File Structure

```
khubzati_api_project 2/
├── config/
│   ├── .gitignore          # Ignores Firebase JSON files
│   ├── README.md            # Instructions
│   └── firebase-service-account.json  # Your file (not committed)
├── src/
│   └── services/
│       └── firebaseAdmin.js  # Service that loads config
└── .env                      # Configuration
```

## ✅ Verification

After configuration, test it:

```bash
# Start server
npm run start:dev

# Look for this message:
✅ Firebase Admin SDK initialized from JSON file
   File: /path/to/config/firebase-service-account.json
   Project ID: your-project-id
```

Or:

```bash
✅ Firebase Admin SDK initialized from environment variables
   Project ID: your-project-id
```

## 🔐 Security Reminders

1. ✅ **Never commit** Firebase service account files to Git
2. ✅ **Never commit** `.env` file to Git
3. ✅ **Use secrets management** in production (AWS Secrets Manager, etc.)
4. ✅ **Rotate keys** if compromised
5. ✅ **Use different keys** for dev/staging/production

## 📚 Related Files

- Service: `src/services/firebaseAdmin.js`
- Config directory: `config/`
- Environment template: `sample.env`
- Main guide: `FIREBASE_SETUP_GUIDE.md`

