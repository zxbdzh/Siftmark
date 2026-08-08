import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThumbnailPreview } from '../../../src/ui/manager/ThumbnailPreview';

describe('ThumbnailPreview', () => {
  it('shows a failure fallback and independent refresh/open commands', async () => {
    const repository = { get: vi.fn().mockResolvedValue({ bookmarkId: 'b', state: 'failed', errorKind: 'restricted', createdAt: 1, lastAccessedAt: 1 }) };
    render(<ThumbnailPreview bookmarkId="b" url="https://example.com" repository={repository as never} onRefresh={vi.fn()}/>);
    expect(await screen.findByText('缩略图捕获失败')).toBeVisible();
    expect(screen.getByRole('button', { name: '刷新缩略图' })).toBeVisible();
    expect(screen.getByRole('button', { name: '打开网页' })).toBeVisible();
  });
});
