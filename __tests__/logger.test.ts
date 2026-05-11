import { redact } from '../src/logger.js';

describe('logger redact', () => {
  it('returns empty string for undefined-like values', () => {
    expect(redact(undefined)).toBe('');
    expect(redact(null)).toBe('');
    expect(redact('')).toBe('');
  });

  it('fully hides non-empty values', () => {
    expect(redact('ab')).toBe('***');
    expect(redact('secret-token-value')).toBe('***');
    expect(redact('JIRA_TOKEN_SHOULD_NOT_LEAK')).not.toContain('JIR');
    expect(redact('JIRA_TOKEN_SHOULD_NOT_LEAK')).toBe('***');
  });
});
