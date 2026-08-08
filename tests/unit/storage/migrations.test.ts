import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, schemaStores } from '../../../src/storage/migrations';

describe('storage schema', () => {
  it('declares the initial version and all durable stores', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(2);
    expect(Object.keys(schemaStores)).toEqual(expect.arrayContaining(['bookmarkMetadata', 'tasks', 'softDeletedMetadata']));
  });
});
