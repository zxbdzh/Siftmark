import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImportConflict } from '../../../src/backup/conflict-detector';
import type { ImportGraph } from '../../../src/backup/types';
import { ImportPreview } from '../../../src/ui/backup/ImportPreview';

afterEach(cleanup);

describe('import preview', () => {
  it('shows safety details and returns explicit per-conflict decisions', async () => {
    const graph: ImportGraph = {
      format: 'markai',
      version: 1,
      nodes: [
        {
          sourceId: 'folder',
          kind: 'folder',
          parentSourceId: null,
          title: '开发',
          index: 0
        },
        {
          sourceId: 'bookmark',
          kind: 'bookmark',
          parentSourceId: 'folder',
          title: 'Siftmark',
          url: 'https://example.com',
          index: 0
        }
      ],
      operations: [],
      settings: {},
      history: [],
      blockedDomains: [],
      unknownFields: ['storage.sync.futureSetting'],
      integrity: 'unverified',
      keyPresence: 'redacted',
      thumbnailBytes: 1536
    };
    const conflicts: ImportConflict[] = [
      {
        id: 'folder-title:folder',
        sourceId: 'folder',
        kind: 'folder-title',
        existingBookmarkId: 'existing-folder',
        defaultDecision: 'keep-existing'
      },
      {
        id: 'metadata-only:bookmark',
        sourceId: 'bookmark',
        kind: 'metadata-only',
        existingBookmarkId: 'existing-bookmark',
        mergeableFields: ['tags', 'note'],
        defaultDecision: 'keep-existing'
      }
    ];
    const onConfirm = vi.fn();
    render(
      <ImportPreview
        graph={graph}
        conflicts={conflicts}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByText('MarkAI · 版本 1')).toBeVisible();
    expect(screen.getByText('未校验')).toBeVisible();
    expect(screen.getByText('已发现但不会导入')).toBeVisible();
    expect(screen.getByText('1.5 KB')).toBeVisible();
    expect(screen.getByText('storage.sync.futureSetting')).toBeVisible();
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(
      screen
        .getAllByRole('combobox')
        .every(
          (select) => (select as HTMLSelectElement).value === 'keep-existing'
        )
    ).toBe(true);

    await userEvent.selectOptions(
      screen.getByLabelText('Siftmark 的处理方式'),
      'merge-metadata'
    );
    await userEvent.click(screen.getByRole('button', { name: '确认导入方案' }));
    expect(onConfirm).toHaveBeenCalledWith({
      folder: 'keep-existing',
      bookmark: 'merge-metadata'
    });
  });
});
