# Khubzati API Test Log

This log will document the manual testing process for the Khubzati API, covering functionality and dual-language support.

## Test Environment

- API Server: Running locally on `http://localhost:3000` (assuming default port from `app.js` or `.env`)
- Database: PostgreSQL (as configured in `config/config.json` and models)

## Testing Tools

- `curl` for sending HTTP requests.
- Manual inspection of responses (headers and body).

---





## Phase 1: Authentication Endpoints

### 1.1 User Registration (`POST /api/v1/auth/register`)

**Test Case 1: Successful Registration (English)**

*   **Request:**
    *   Method: `POST`
    *   URL: `http://localhost:3000/api/v1/auth/register`
    *   Headers: `Content-Type: application/json`, `Accept-Language: en`
    *   Body: `{"username": "testuser_en_02", "email": "testuser_en_02@example.com", "password": "Password123!", "phone_number": "1234567891", "role": "customer"}`
*   **Expected Response (Status Code):** `201 Created`
*   **Expected Response (Body - English):** 
    ```json
    {
        "success": true,
        "message": {
            "en": "User registered successfully. Please check your email to verify your account.",
            "ar": "تم تسجيل المستخدم بنجاح. يرجى التحقق من بريدك الإلكتروني لتفعيل حسابك."
        },
        "data": {
            "user": {
                "user_id": "<integer>",
                "username": "testuser_en_02",
                "email": "testuser_en_02@example.com",
                "full_name": null,
                "phone_number": "1234567891",
                "role": "customer",
                "is_verified": false,
                // ... other fields
            }
        }
    }
    ```
*   **Actual Response (Status Code):** `201 Created`
*   **Actual Response (Body):
    ```json
    {"success":true,"message":{"en":"User registered successfully. Please check your email to verify your account.","ar":"تم تسجيل المستخدم بنجاح. يرجى التحقق من بريدك الإلكتروني لتفعيل حسابك."},"data":{"user":{"user_id":1,"username":"testuser_en_02","email":"testuser_en_02@example.com","full_name":null,"phone_number":"1234567891","role":"customer","is_verified":false,"updatedAt":"2025-05-12T22:30:12.349Z","createdAt":"2025-05-12T22:30:12.349Z","profile_picture_url":null,"last_login":null,"emailVerificationToken":null,"emailVerificationExpires":null,"passwordResetToken":null,"passwordResetExpires":null}}}
    ```
*   **Result:** `PASS`
*   **Notes:** User ID 1 created. Response matches expected structure and English message.

---




**Test Case 2: Successful Registration (Arabic)**

*   **Request:**
    *   Method: `POST`
    *   URL: `http://localhost:3000/api/v1/auth/register`
    *   Headers: `Content-Type: application/json`, `Accept-Language: ar`
    *   Body: `{"username": "testuser_ar_01", "email": "testuser_ar_01@example.com", "password": "Password123!", "phone_number": "1234567892", "role": "customer"}`
*   **Expected Response (Status Code):** `201 Created`
*   **Expected Response (Body - Arabic focused):** 
    ```json
    {
        "success": true,
        "message": {
            "en": "User registered successfully. Please check your email to verify your account.",
            "ar": "تم تسجيل المستخدم بنجاح. يرجى التحقق من بريدك الإلكتروني لتفعيل حسابك."
        },
        "data": {
            "user": {
                "user_id": "<integer>",
                "username": "testuser_ar_01",
                "email": "testuser_ar_01@example.com",
                // ... other fields
            }
        }
    }
    ```
*   **Actual Response (Status Code):** `201 Created`
*   **Actual Response (Body):
    ```json
    {"success":true,"message":{"en":"User registered successfully. Please check your email to verify your account.","ar":"تم تسجيل المستخدم بنجاح. يرجى التحقق من بريدك الإلكتروني لتفعيل حسابك."},"data":{"user":{"user_id":2,"username":"testuser_ar_01","email":"testuser_ar_01@example.com","full_name":null,"phone_number":"1234567892","role":"customer","is_verified":false,"updatedAt":"2025-05-12T22:30:39.499Z","createdAt":"2025-05-12T22:30:39.499Z","profile_picture_url":null,"last_login":null,"emailVerificationToken":null,"emailVerificationExpires":null,"passwordResetToken":null,"passwordResetExpires":null}}}
    ```
*   **Result:** `PASS`
*   **Notes:** User ID 2 created. Response matches expected structure and Arabic message is present and correct.

---




### 1.2 User Login (`POST /api/v1/auth/login`)

**Test Case 1: Successful Login (English)**

*   **Request:**
    *   Method: `POST`
    *   URL: `http://localhost:3000/api/v1/auth/login`
    *   Headers: `Content-Type: application/json`, `Accept-Language: en`
    *   Body: `{"email": "testuser_en_02@example.com", "password": "Password123!"}`
*   **Expected Response (Status Code):** `200 OK`
*   **Expected Response (Body - English):** 
    ```json
    {
        "success": true,
        "message": {
            "en": "Login successful.",
            "ar": "تم تسجيل الدخول بنجاح."
        },
        "data": {
            "user": {
                "user_id": 1,
                "username": "testuser_en_02",
                // ... other user fields
            },
            "token": "<jwt_token>"
        }
    }
    ```
*   **Actual Response (Status Code):** `200 OK`
*   **Actual Response (Body):
    ```json
    {"success":true,"message":{"en":"Login successful.","ar":"تم تسجيل الدخول بنجاح."},"data":{"user":{"user_id":1,"username":"testuser_en_02","email":"testuser_en_02@example.com","phone_number":"1234567891","full_name":null,"profile_picture_url":null,"role":"customer","is_verified":false,"last_login":"2025-05-12T22:32:00.023Z","emailVerificationToken":null,"emailVerificationExpires":null,"passwordResetToken":null,"passwordResetExpires":null,"createdAt":"2025-05-12T22:30:12.349Z","updatedAt":"2025-05-12T22:32:00.024Z"},"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInJvbGUiOiJjdXN0b21lciIsImlhdCI6MTc0NzA4OTEyMCwiZXhwIjoxNzQ3MDkyNzIwfQ.V2LbylUUb8b386SGvcKcr6TIiArSDsRLUFWtIJB61ZU"}}
    ```
*   **Result:** `PASS`
*   **Notes:** Login successful for user_id 1. Token generated. Response matches expected structure and English message.

---




**Test Case 2: Successful Login (Arabic)**

*   **Request:**
    *   Method: `POST`
    *   URL: `http://localhost:3000/api/v1/auth/login`
    *   Headers: `Content-Type: application/json`, `Accept-Language: ar`
    *   Body: `{"email": "testuser_ar_01@example.com", "password": "Password123!"}`
*   **Expected Response (Status Code):** `200 OK`
*   **Expected Response (Body - Arabic focused):** 
    ```json
    {
        "success": true,
        "message": {
            "en": "Login successful.",
            "ar": "تم تسجيل الدخول بنجاح."
        },
        "data": {
            "user": {
                "user_id": 2,
                "username": "testuser_ar_01",
                // ... other user fields
            },
            "token": "<jwt_token>"
        }
    }
    ```
*   **Actual Response (Status Code):** `200 OK`
*   **Actual Response (Body):
    ```json
    {"success":true,"message":{"en":"Login successful.","ar":"تم تسجيل الدخول بنجاح."},"data":{"user":{"user_id":2,"username":"testuser_ar_01","email":"testuser_ar_01@example.com","phone_number":"1234567892","full_name":null,"profile_picture_url":null,"role":"customer","is_verified":false,"last_login":"2025-05-13T23:35:53.144Z","emailVerificationToken":null,"emailVerificationExpires":null,"passwordResetToken":null,"passwordResetExpires":null,"createdAt":"2025-05-12T22:30:39.499Z","updatedAt":"2025-05-13T23:35:53.144Z"},"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjIsInJvbGUiOiJjdXN0b21lciIsImlhdCI6MTc0NzE3OTM1MywiZXhwIjoxNzQ3MTgyOTUzfQ.bKJg4Tv_PXs0zsLIO_ZPIsEjGHg34s51by0H3dropbM"}}
    ```
*   **Result:** `PASS`
*   **Notes:** Login successful for user_id 2. Token generated. Response matches expected structure and Arabic message is present and correct.

---




### 1.3 User Logout (`POST /api/v1/auth/logout`)

**Test Case 1: Successful Logout (English)**

*   **Request:**
    *   Method: `POST`
    *   URL: `http://localhost:3000/api/v1/auth/logout`
    *   Headers: `Authorization: Bearer <token_from_testuser_en_02_login>`, `Accept-Language: en`
*   **Expected Response (Status Code):** `200 OK`
*   **Expected Response (Body - English):** 
    ```json
    {
        "success": true,
        "message": {
            "en": "Logout successful.",
            "ar": "تم تسجيل الخروج بنجاح."
        },
        "data": null
    }
    ```
*   **Actual Response (Status Code):** `200 OK`
*   **Actual Response (Body):
    ```json
    {"success":true,"message":{"en":"Logout successful.","ar":"تم تسجيل الخروج بنجاح."},"data":null}
    ```
*   **Result:** `PASS`
*   **Notes:** Logout successful. Token used: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInJvbGUiOiJjdXN0b21lciIsImlhdCI6MTc0NzA4OTEyMCwiZXhwIjoxNzQ3MDkyNzIwfQ.V2LbylUUb8b386SGvcKcr6TIiArSDsRLUFWtIJB61ZU`. Response matches expected structure and English message.

---

