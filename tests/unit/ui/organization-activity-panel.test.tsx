import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrganizationActivityPanel } from '../../../src/ui/manager/OrganizationActivityPanel';

describe('analysis batch activity', () => {
  it('shows real waiting, retry, completion summaries and elapsed time', () => {
    render(
      <OrganizationActivityPanel
        stage="reading"
        concurrency={2}
        now={6000}
        batches={[
          {
            id: 'r1',
            stage: 'reading',
            batch: 1,
            count: 80,
            status: 'running',
            attempt: 1,
            startedAt: 1000
          },
          {
            id: 'r2',
            stage: 'reading',
            batch: 2,
            count: 40,
            status: 'retrying',
            attempt: 1,
            retryAfterMs: 1000,
            startedAt: 1000
          },
          {
            id: 'r3',
            stage: 'reading',
            batch: 3,
            count: 10,
            status: 'completed',
            attempt: 2,
            startedAt: 1000,
            finishedAt: 3000,
            summary: '开发 / 文档'
          }
        ]}
      />
    );
    expect(screen.getByText('1 批运行 · 并发上限 2')).toBeVisible();
    expect(screen.getByText('模型尚未返回结果')).toBeVisible();
    expect(screen.getByText('等待重试 · 1 秒后')).toBeVisible();
    expect(screen.getByText('开发 / 文档')).toBeVisible();
    expect(screen.getByText('2 秒')).toBeVisible();
  });
});
