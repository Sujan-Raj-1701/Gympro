import { describe, it, expect } from 'vitest';

// Validation functions (local to this test for now)
const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validatePhone = (phone: string): boolean => {
  const phoneRegex = /^[\d\s\-\+\(\)]+$/;
  return phoneRegex.test(phone) && phone.replace(/\D/g, '').length >= 10;
};

const validateCompanyName = (name: string): boolean => {
  return name.trim().length >= 2 && /^[a-zA-Z0-9\s\-\.\_\&]+$/.test(name);
};

const validateAccountName = (name: string): boolean => {
  return name.trim().length >= 2 && /^[a-zA-Z0-9\s\-\.\_]+$/.test(name);
};

const validateRetailCount = (count: number): boolean => {
  return count >= 1 && count <= 999 && Number.isInteger(count);
};

describe('License Management Validation', () => {
  it('validates emails correctly', () => {
    expect(validateEmail('test@example.com')).toBe(true);
    expect(validateEmail('invalid-email')).toBe(false);
    expect(validateEmail('test@')).toBe(false);
    expect(validateEmail('@example.com')).toBe(false);
  });

  it('validates phone numbers correctly', () => {
    expect(validatePhone('+1-234-567-8900')).toBe(true);
    expect(validatePhone('1234567890')).toBe(true);
    expect(validatePhone('(123) 456-7890')).toBe(true);
    expect(validatePhone('123456789')).toBe(false); // too short
    expect(validatePhone('abcd567890')).toBe(false); // letters not allowed
  });

  it('validates company names correctly', () => {
    expect(validateCompanyName('Acme Corp & Co.')).toBe(true);
    expect(validateCompanyName('Tech-Solutions_2024')).toBe(true);
    expect(validateCompanyName('A')).toBe(false); // too short
    expect(validateCompanyName('Company@Name')).toBe(false); // @ not allowed
  });

  it('validates account names correctly', () => {
    expect(validateAccountName('Restaurant Main')).toBe(true);
    expect(validateAccountName('Store-Location_1')).toBe(true);
    expect(validateAccountName('R')).toBe(false); // too short
    expect(validateAccountName('Store&Location')).toBe(false); // & not allowed
  });

  it('validates retail count correctly', () => {
    expect(validateRetailCount(1)).toBe(true);
    expect(validateRetailCount(50)).toBe(true);
    expect(validateRetailCount(999)).toBe(true);
    expect(validateRetailCount(0)).toBe(false);
    expect(validateRetailCount(1000)).toBe(false);
    expect(validateRetailCount(1.5)).toBe(false);
  });
});
