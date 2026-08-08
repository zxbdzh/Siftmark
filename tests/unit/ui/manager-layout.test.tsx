import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ManagerLayout } from '../../../src/ui/manager/ManagerLayout';
import type { BookmarkRepository } from '../../../src/bookmarks/ports';

describe('ManagerLayout', () => {
  it('exposes the three workspace regions', () => {
    render(<ManagerLayout nodes={[]} loading={false} repository={{} as BookmarkRepository}/>);
    expect(screen.getByLabelText('文件夹')).toBeInTheDocument();
    expect(screen.getByLabelText('书签列表')).toBeInTheDocument();
    expect(screen.getByLabelText('书签详情')).toBeInTheDocument();
  });
});
