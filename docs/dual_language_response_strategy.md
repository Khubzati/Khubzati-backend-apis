# Dual-Language API Response Strategy (English & Arabic)

## 1. Objective

To ensure all API responses from the Khubzati application can provide messages and relevant data in both English and Arabic, as per user requirements.

## 2. Approach

We will adopt a strategy where response messages (e.g., success messages, error messages, validation messages) are structured to include both English and Arabic versions. Data itself (e.g., product names, descriptions) will eventually need to be stored and retrieved in both languages from the database, but for initial API response structure, we will focus on message localization.

### 2.1. Standard Response Structure

All API responses will follow a consistent JSON structure. For messages, we will use a nested object:

```json
{
  "success": true, // boolean
  "message": {
    "en": "Operation completed successfully.",
    "ar": "تمت العملية بنجاح."
  },
  "data": { ... } // or null
}
```

For error responses:

```json
{
  "success": false,
  "message": {
    "en": "An error occurred.",
    "ar": "حدث خطأ ما."
  },
  "errors": [ // Optional, for validation errors or more details
    {
      "field": "email",
      "message": {
        "en": "Email is required.",
        "ar": "البريد الإلكتروني مطلوب."
      }
    }
  ]
}
```

### 2.2. Implementation Details

*   **Message Strings**: A centralized location (e.g., JSON files or a dedicated module) will store all standard messages in both English and Arabic. This will make management and updates easier.
    *   Example: `messages/en.json`, `messages/ar.json`
*   **Utility Function**: A utility function will be created to generate these response objects. This function will take the English message key, Arabic message key (or the messages directly), data, and success status as parameters.
    *   `const createApiResponse = (messageEn, messageAr, data, success, errors) => { ... }`
*   **Controllers**: Controllers will use this utility function to format their responses.
*   **Database Schema for Localized Data**: For data fields that need to be multilingual (e.g., product names, descriptions, category names), the database schema (as defined in `database_schema.txt` and to be implemented in Sequelize models) will need to be adapted. Common approaches include:
    *   Separate columns for each language (e.g., `name_en`, `name_ar`). This is simpler for a fixed number of languages.
    *   A related translations table (e.g., `ProductTranslations` with `product_id`, `language_code`, `name`, `description`). This is more scalable for many languages but adds query complexity.
    *   For Khubzati, with two primary languages, separate columns (`*_en`, `*_ar`) in the relevant tables (`Products`, `Categories`, etc.) will be the preferred approach for simplicity in query and model definition.
*   **Request Language Preference (Optional for now, but good to consider)**: While the requirement is to *return* in both languages, future enhancements might involve allowing clients to specify a preferred language via an `Accept-Language` header. For now, all messages will include both `en` and `ar` fields.

## 3. Example Usage in a Controller

```javascript
// Example: authController.js
const { createUser } = require('../services/userService');
const { createApiResponse } = require('../utils/responseHandler');
const messages = require('../config/messages'); // Assuming messages are loaded here

exports.registerUser = async (req, res) => {
  try {
    const user = await createUser(req.body);
    // Assuming messages.REGISTRATION_SUCCESS.en and .ar exist
    return res.status(201).json(createApiResponse(messages.REGISTRATION_SUCCESS.en, messages.REGISTRATION_SUCCESS.ar, user, true));
  } catch (error) {
    // Assuming messages.REGISTRATION_ERROR.en and .ar exist
    // And error object might contain specific validation errors to be formatted
    let validationErrors = null;
    if (error.name === 'SequelizeValidationError') {
        validationErrors = error.errors.map(err => ({
            field: err.path,
            message: {
                en: err.message, // Or a more generic English validation message key
                ar: getArabicValidationMessage(err.path, err.validatorKey) // Function to get Arabic validation message
            }
        }));
    }
    return res.status(400).json(createApiResponse(messages.REGISTRATION_ERROR.en, messages.REGISTRATION_ERROR.ar, null, false, validationErrors));
  }
};
```

## 4. Next Steps

1.  Create the `utils/responseHandler.js` module with the `createApiResponse` function.
2.  Create initial `config/messages/en.json` and `config/messages/ar.json` files.
3.  Update Sequelize models (when created) to include `_en` and `_ar` fields for localizable attributes as identified in the database schema (e.g., `Products.name_en`, `Products.name_ar`, `Categories.description_en`, `Categories.description_ar`).
4.  Ensure all new endpoint implementations adhere to this response structure.

