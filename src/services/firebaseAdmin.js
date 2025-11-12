/**
 * Firebase Admin SDK Service
 * Centralized initialization and configuration
 * 
 * Supports two configuration methods:
 * 1. JSON file path (FIREBASE_SERVICE_ACCOUNT_PATH) - Recommended for local development
 * 2. Environment variables (FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL) - For production
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

let firebaseInitialized = false;

/**
 * Initialize Firebase Admin SDK
 * Supports both JSON file and environment variable configuration
 * @returns {admin.app.App|null} Initialized Firebase Admin app or null if failed
 */
const initializeFirebaseAdmin = () => {
  // Return existing app if already initialized
  if (firebaseInitialized && admin.apps.length > 0) {
    return admin.apps[0];
  }

  try {
    // Initialize Firebase Admin SDK
    if (admin.apps.length === 0) {
      let credential;

      // Method 1: Load from JSON file (easier for local development)
      if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
        const serviceAccountPath = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);

        if (!fs.existsSync(serviceAccountPath)) {
          console.error(`❌ Firebase service account file not found: ${serviceAccountPath}`);
          console.error('   Please check FIREBASE_SERVICE_ACCOUNT_PATH in your .env file');
          return null;
        }

        try {
          const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
          credential = admin.credential.cert(serviceAccount);
          console.log('✅ Firebase Admin SDK initialized from JSON file');
          console.log(`   File: ${serviceAccountPath}`);
          console.log(`   Project ID: ${serviceAccount.project_id}`);
        } catch (fileError) {
          console.error('❌ Error reading Firebase service account file:', fileError.message);
          return null;
        }
      }
      // Method 2: Load from environment variables (for production)
      else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
        const serviceAccount = {
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        };

        credential = admin.credential.cert(serviceAccount);
        console.log('✅ Firebase Admin SDK initialized from environment variables');
        console.log(`   Project ID: ${process.env.FIREBASE_PROJECT_ID}`);
      }
      // No configuration found
      else {
        console.warn('⚠️  Firebase Admin SDK credentials not configured.');
        console.warn('');
        console.warn('   Option 1 (Recommended for local dev): Set FIREBASE_SERVICE_ACCOUNT_PATH in .env');
        console.warn('      Example: FIREBASE_SERVICE_ACCOUNT_PATH=./config/firebase-service-account.json');
        console.warn('');
        console.warn('   Option 2 (For production): Set these in .env:');
        console.warn('      FIREBASE_PROJECT_ID=your-project-id');
        console.warn('      FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"');
        console.warn('      FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com');
        console.warn('');
        console.warn('   Firebase token verification will not work until configured.');
        return null;
      }

      admin.initializeApp({
        credential: credential,
      });

      firebaseInitialized = true;
      return admin.apps[0];
    }

    firebaseInitialized = true;
    return admin.apps[0];
  } catch (error) {
    console.error('❌ Error initializing Firebase Admin SDK:', error.message);
    firebaseInitialized = false;
    return null;
  }
};

/**
 * Verify Firebase ID token
 * @param {string} idToken - Firebase ID token from client
 * @returns {Promise<admin.auth.DecodedIdToken>} Decoded token
 * @throws {Error} If token is invalid or verification fails
 */
const verifyIdToken = async (idToken) => {
  const app = initializeFirebaseAdmin();

  if (!app) {
    throw new Error('Firebase Admin SDK not initialized. Please configure Firebase credentials.');
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    console.error('❌ Firebase token verification failed:', error.message);
    throw error;
  }
};

/**
 * Get Firebase Auth instance
 * @returns {admin.auth.Auth} Firebase Auth instance
 */
const getAuth = () => {
  const app = initializeFirebaseAdmin();
  if (!app) {
    throw new Error('Firebase Admin SDK not initialized');
  }
  return admin.auth();
};

/**
 * Check if Firebase Admin SDK is initialized
 * @returns {boolean}
 */
const isInitialized = () => {
  return firebaseInitialized && admin.apps.length > 0;
};

module.exports = {
  initializeFirebaseAdmin,
  verifyIdToken,
  getAuth,
  isInitialized,
  admin, // Export admin for advanced usage
};

