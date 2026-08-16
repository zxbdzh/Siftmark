import { describe, expect, it } from 'vitest';
import {
  MODEL_INPUT_LIMITS,
  sanitizeAiRequestContext
} from '../../../src/ai/security/model-input-sanitizer';

describe('sanitizeAiRequestContext', () => {
  it('redacts sensitive text and bounds every model-visible collection', () => {
    const context = sanitizeAiRequestContext({
      title: 'Owner dev@example.test',
      url: 'https://user:password@example.test/docs?token=private#account',
      currentFolderPath: ['dev@example.test'],
      description: `Contact dev@example.test ${'d'.repeat(600)}`,
      pageText: `Bearer abcdefghijklmnop ${'p'.repeat(7_000)}`,
      additionalRules: 'Use sk-abcdefghijklmnop',
      availableFolderPaths: Array.from(
        { length: 30 },
        (_, index) => `Folder ${index} dev@example.test`
      ),
      relatedBookmarks: Array.from({ length: 8 }, (_, index) => ({
        title: `Related ${index} dev@example.test`,
        url: `https://user:password@example.test/${index}?token=private#part`,
        summary: `password=private ${'s'.repeat(600)}`
      }))
    });

    expect(context).toMatchObject({
      title: 'Owner [REDACTED_EMAIL]',
      url: 'https://example.test/docs',
      currentFolderPath: ['[REDACTED_EMAIL]'],
      additionalRules: 'Use [REDACTED_API_KEY]'
    });
    expect(context.description).toHaveLength(MODEL_INPUT_LIMITS.description);
    expect(context.description).toContain('[REDACTED_EMAIL]');
    expect(context.pageText).toHaveLength(MODEL_INPUT_LIMITS.pageText);
    expect(context.pageText).toContain('Bearer [REDACTED_TOKEN]');
    expect(context.availableFolderPaths).toHaveLength(
      MODEL_INPUT_LIMITS.folderCandidates
    );
    expect(context.availableFolderPaths?.[0]).toContain('[REDACTED_EMAIL]');
    expect(context.relatedBookmarks).toHaveLength(
      MODEL_INPUT_LIMITS.relatedBookmarks
    );
    expect(context.relatedBookmarks?.[0]).toMatchObject({
      title: 'Related 0 [REDACTED_EMAIL]',
      url: 'https://example.test/0'
    });
    expect(context.relatedBookmarks?.[0]?.summary).toHaveLength(
      MODEL_INPUT_LIMITS.description
    );
    expect(context.relatedBookmarks?.[0]?.summary).toContain(
      'password=[REDACTED_PASSWORD]'
    );
  });
});
