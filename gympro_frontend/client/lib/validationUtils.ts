/**
 * License Management Validation Utilities
 * Centralized validation functions for the License Management system
 */

export interface ValidationError {
  field: string;
  message: string;
}

export interface FormErrors {
  companyName?: string;
  companyPhone?: string;
  companyEmail?: string;
  businessTypes?: string;
  businesses?: { [key: string]: { [key: number]: { [field: string]: string } } };
}

/**
 * Validates email format
 * @param email - Email string to validate
 * @returns true if valid email format
 */
export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validates phone number format and length
 * @param phone - Phone string to validate
 * @returns true if valid phone format with at least 10 digits
 */
export const validatePhone = (phone: string): boolean => {
  const phoneRegex = /^[\d\s\-\+\(\)]+$/;
  return phoneRegex.test(phone) && phone.replace(/\D/g, '').length >= 10;
};

/**
 * Validates company name format and length
 * @param name - Company name to validate
 * @returns true if valid company name
 */
export const validateCompanyName = (name: string): boolean => {
  return name.trim().length >= 2 && /^[a-zA-Z0-9\s\-\.\_\&]+$/.test(name);
};

/**
 * Validates account name format and length
 * @param name - Account name to validate
 * @returns true if valid account name
 */
export const validateAccountName = (name: string): boolean => {
  return name.trim().length >= 2 && /^[a-zA-Z0-9\s\-\.\_]+$/.test(name);
};

/**
 * Validates retail count range and type
 * @param count - Number to validate
 * @returns true if valid retail count (1-999, integer)
 */
export const validateRetailCount = (count: number): boolean => {
  return count >= 1 && count <= 999 && Number.isInteger(count);
};

/**
 * Validates that a date is in the future
 * @param date - Date to validate
 * @returns true if date is after today
 */
export const validateFutureDate = (date: Date): boolean => {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Reset time to start of day
  return date > today;
};

/**
 * Gets validation error message for a specific field and value
 * @param field - Field name
 * @param value - Field value
 * @returns Error message or null if valid
 */
export const getValidationError = (field: string, value: any): string | null => {
  switch (field) {
    case 'companyName':
      if (!value || !value.trim()) {
        return "Company name is required";
      }
      if (!validateCompanyName(value)) {
        return "Company name must be at least 2 characters and contain only letters, numbers, spaces, hyphens, dots, underscores, and ampersands";
      }
      break;

    case 'companyPhone':
    case 'accountPhone':
      if (!value || !value.trim()) {
        return "Phone number is required";
      }
      if (!validatePhone(value)) {
        return "Please enter a valid phone number with at least 10 digits";
      }
      break;

    case 'companyEmail':
      if (!value || !value.trim()) {
        return "Email address is required";
      }
      if (!validateEmail(value)) {
        return "Please enter a valid email address";
      }
      break;

    case 'accountName':
      if (!value || !value.trim()) {
        return "Account name is required";
      }
      if (!validateAccountName(value)) {
        return "Account name must be at least 2 characters and contain only letters, numbers, spaces, hyphens, dots, and underscores";
      }
      break;

    case 'retailCount':
      if (!validateRetailCount(value)) {
        return "Retail count must be a number between 1 and 999";
      }
      break;

    case 'licensePeriod':
      if (!value) {
        return "License period is required";
      }
      break;

    case 'customEndDate':
      if (!value) {
        return "Custom end date is required when custom period is selected";
      }
      if (!validateFutureDate(new Date(value))) {
        return "Custom end date must be in the future";
      }
      break;

    default:
      return null;
  }

  return null;
};

/**
 * Validation error messages for different scenarios
 */
export const ValidationMessages = {
  REQUIRED: "This field is required",
  INVALID_EMAIL: "Please enter a valid email address",
  INVALID_PHONE: "Please enter a valid phone number with at least 10 digits",
  INVALID_COMPANY_NAME: "Company name must be at least 2 characters and contain only letters, numbers, spaces, hyphens, dots, underscores, and ampersands",
  INVALID_ACCOUNT_NAME: "Account name must be at least 2 characters and contain only letters, numbers, spaces, hyphens, dots, and underscores",
  INVALID_RETAIL_COUNT: "Retail count must be a number between 1 and 999",
  INVALID_FUTURE_DATE: "Date must be in the future",
  BUSINESS_TYPE_REQUIRED: "At least one business type must be selected",
  LICENSE_PERIOD_REQUIRED: "License period is required",
  CUSTOM_DATE_REQUIRED: "Custom end date is required when custom period is selected"
} as const;

/**
 * Regex patterns used for validation
 */
export const ValidationPatterns = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  PHONE: /^[\d\s\-\+\(\)]+$/,
  COMPANY_NAME: /^[a-zA-Z0-9\s\-\.\_\&]+$/,
  ACCOUNT_NAME: /^[a-zA-Z0-9\s\-\.\_]+$/
} as const;

/**
 * Validation constraints
 */
export const ValidationConstraints = {
  NAME_MIN_LENGTH: 2,
  PHONE_MIN_DIGITS: 10,
  RETAIL_COUNT_MIN: 1,
  RETAIL_COUNT_MAX: 999
} as const;
