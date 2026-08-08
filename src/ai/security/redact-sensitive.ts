const REDACTIONS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_API_KEY]'],
  [/\b(?:sk-ant|anthropic|xai)-[A-Za-z0-9_-]{12,}\b/gi, '[REDACTED_API_KEY]'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [REDACTED_TOKEN]'],
  [/(\b(?:password|passwd|密(?:码|碼))\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED_PASSWORD]'],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]'],
  [/(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g, '[REDACTED_PHONE]']
];

export function redactSensitiveText(input: string): string {
  return REDACTIONS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), input);
}
