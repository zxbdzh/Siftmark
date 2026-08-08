import { describe, expect, it } from 'vitest';
import { redactSensitiveText } from '../../../src/ai/security/redact-sensitive';

describe('redactSensitiveText', () => {
  it('redacts common secrets and personal data deterministically', () => {
    const result = redactSensitiveText('key=sk-example12345678901234567890 email=a@example.com phone=13812345678 password=hunter2');
    expect(result).toBe('key=[REDACTED_API_KEY] email=[REDACTED_EMAIL] phone=[REDACTED_PHONE] password=[REDACTED_PASSWORD]');
  });
  it('does not redact ordinary words that merely contain key-like text', () => {
    expect(redactSensitiveText('keyboard and sk-short')).toBe('keyboard and sk-short');
  });
});
