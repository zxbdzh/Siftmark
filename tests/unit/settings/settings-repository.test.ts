import { describe, expect, it } from 'vitest';
import { ChromeSettingsRepository } from '../../../src/settings/settings-repository';

describe('ChromeSettingsRepository', () => {
  it('persists independent sort choices per folder', async () => {
    const values: Record<string, unknown> = {};
    const repository = new ChromeSettingsRepository({ get: async (key) => ({ [key]: values[key] }), set: async (items) => { Object.assign(values, items); } });
    await repository.setFolderSort('folder-a', { field: 'title', direction: 'desc' });
    await repository.setFolderSort('folder-b', { field: 'health', direction: 'asc' });
    await expect(repository.getFolderSort('folder-a')).resolves.toEqual({ field: 'title', direction: 'desc' });
    await expect(repository.getFolderSort('folder-b')).resolves.toEqual({ field: 'health', direction: 'asc' });
  });
});
