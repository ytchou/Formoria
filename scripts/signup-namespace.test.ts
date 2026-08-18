import { describe, expect, it } from 'vitest';
import {
  isNamespacedTestUser,
  normalizeEmail,
  SIGNUP_TEST_EMAIL_PREFIX,
} from '../e2e/helpers/signup-namespace';

describe('staging auth cleanup namespace', () => {
  it('never selects durable E2E accounts even when their emails use a disposable prefix', () => {
    const prefixes = [SIGNUP_TEST_EMAIL_PREFIX, 'e2e-signout-'];
    const durable = [
      '  E2E-SIGNUP-owner@example.test ',
      'e2e-signout-admin@example.test',
    ];

    expect(normalizeEmail(durable[0])).toBe('e2e-signup-owner@example.test');
    expect(isNamespacedTestUser(durable[0], prefixes, durable)).toBe(false);
    expect(isNamespacedTestUser(durable[1], prefixes, durable)).toBe(false);
    expect(isNamespacedTestUser('e2e-signup-temporary@example.test', prefixes, durable)).toBe(true);
  });
});
