import { describe, test, expect } from 'vitest';
import { BrandInfoSchema } from './submission';

const t = (key: string) => key;

const validBase = {
  name: 'Test Brand',
  description: 'A'.repeat(40),
  category: 'fashion',
  logoUrl: 'https://example.com/logo.png',
};

describe('BrandInfoSchema — unifiedBusinessNumber', () => {
  test('accepts a valid 8-digit UBN', () => {
    const result = BrandInfoSchema(t).safeParse({
      ...validBase,
      unifiedBusinessNumber: '12345678',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.unifiedBusinessNumber).toBe('12345678');
  });

  test('accepts missing UBN (field is optional)', () => {
    const result = BrandInfoSchema(t).safeParse(validBase);
    expect(result.success).toBe(true);
  });

  test('transforms empty string to undefined', () => {
    const result = BrandInfoSchema(t).safeParse({
      ...validBase,
      unifiedBusinessNumber: '',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.unifiedBusinessNumber).toBeUndefined();
  });

  test('rejects 7-digit UBN', () => {
    const result = BrandInfoSchema(t).safeParse({
      ...validBase,
      unifiedBusinessNumber: '1234567',
    });
    expect(result.success).toBe(false);
  });

  test('rejects non-numeric UBN', () => {
    const result = BrandInfoSchema(t).safeParse({
      ...validBase,
      unifiedBusinessNumber: 'ABC12345',
    });
    expect(result.success).toBe(false);
  });

  test('rejects 9-digit UBN', () => {
    const result = BrandInfoSchema(t).safeParse({
      ...validBase,
      unifiedBusinessNumber: '123456789',
    });
    expect(result.success).toBe(false);
  });
});
