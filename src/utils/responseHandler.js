/**
 * Creates a standardized API response object with dual-language support for messages.
 * @param {string} messageEn - The English version of the message.
 * @param {string} messageAr - The Arabic version of the message.
 * @param {any} data - The data payload of the response (can be null).
 * @param {boolean} success - Indicates if the operation was successful.
 * @param {Array<Object>} [errors=null] - An optional array of error objects, typically for validation.
 * @returns {Object} The standardized API response object.
 */
const createApiResponse = (messageEn, messageAr, data, success, errors = null) => {
  const response = {
    success: success,
    message: {
      en: messageEn,
      ar: messageAr,
    },
    data: data,
  };
  if (errors) {
    response.errors = errors;
  }
  return response;
};

module.exports = {
  createApiResponse,
};

