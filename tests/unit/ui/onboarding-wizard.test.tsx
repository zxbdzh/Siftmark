import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  ChromeOnboardingStore,
  ONBOARDING_STEPS,
  ONBOARDING_STORAGE_KEY,
  type OnboardingStorageArea
} from '../../../src/onboarding/onboarding-store';
import { OnboardingWizard } from '../../../src/ui/onboarding/OnboardingWizard';
import { ScanStep } from '../../../src/ui/onboarding/ScanStep';
import type { BookmarkRepository } from '../../../src/bookmarks/ports';
import type { MetadataRepository } from '../../../src/storage/types';

describe('onboarding', () => {
  it('resumes at the first unfinished step after close and reopen', async () => {
    const storage = new MemoryStorage();
    const firstSession = new ChromeOnboardingStore(storage, () => 10);
    await firstSession.skipStep('permissions-privacy');
    await firstSession.skipStep('special-folders');

    const reopened = new ChromeOnboardingStore(storage, () => 20);

    expect(await reopened.load()).toMatchObject({
      status: 'in-progress',
      currentStep: 'model',
      skippedSteps: ['permissions-privacy', 'special-folders']
    });
    expect(
      (await storage.get(ONBOARDING_STORAGE_KEY))[ONBOARDING_STORAGE_KEY]
    ).not.toHaveProperty('file');
  });

  it('allows every step, including optional model setup, to be skipped', async () => {
    const storage = new MemoryStorage();
    const store = new ChromeOnboardingStore(storage, () => 30);
    const completed = vi.fn();
    render(<OnboardingWizard store={store} onComplete={completed} />);

    for (const title of [
      '权限与隐私',
      '特殊文件夹',
      '可选模型',
      '迁移数据',
      '只读扫描'
    ]) {
      expect(
        await screen.findByRole('heading', { name: title })
      ).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: '跳过此步' }));
    }

    expect(completed).toHaveBeenCalledOnce();
    expect(await store.load()).toMatchObject({
      status: 'completed',
      currentStep: null,
      skippedSteps: ONBOARDING_STEPS
    });
  });

  it('moves legacy floating-button progress to model setup', async () => {
    const storage = new MemoryStorage();
    await storage.set({
      [ONBOARDING_STORAGE_KEY]: {
        version: 1,
        status: 'in-progress',
        currentStep: 'floating-button',
        completedSteps: ['permissions-privacy', 'special-folders'],
        skippedSteps: [],
        updatedAt: 1
      }
    });

    await expect(new ChromeOnboardingStore(storage, () => 40).load()).resolves.toMatchObject({
      currentStep: 'model',
      completedSteps: ['permissions-privacy', 'special-folders'],
      updatedAt: 40
    });
  });

  it('summarizes duplicates, health, and triage only after a read-only user scan', async () => {
    const repository = {
      getTree: vi.fn().mockResolvedValue([
        { id: 'folder', parentId: '0', index: 0, title: '工作' },
        {
          id: 'bookmark',
          parentId: 'folder',
          index: 0,
          title: '文档',
          url: 'https://example.com'
        },
        {
          id: 'duplicate',
          parentId: 'folder',
          index: 1,
          title: '文档副本',
          url: 'https://example.com/'
        }
      ]),
      create: vi.fn(),
      move: vi.fn(),
      update: vi.fn(),
      remove: vi.fn()
    } as unknown as BookmarkRepository;
    const metadata = {
      list: vi.fn().mockResolvedValue([
        {
          bookmarkId: 'bookmark',
          summary: '已整理',
          tags: ['文档'],
          note: '',
          confidence: 'high',
          reason: '',
          health: 'healthy',
          updatedAt: 1
        }
      ]),
      get: vi.fn(),
      put: vi.fn(),
      softDelete: vi.fn(),
      restore: vi.fn(),
      purgeDeletedBefore: vi.fn()
    } as unknown as MetadataRepository;
    render(<ScanStep bookmarks={repository} metadata={metadata} />);

    expect(repository.getTree).not.toHaveBeenCalled();
    expect(metadata.list).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '扫描现有书签' }));

    expect(await screen.findByText('1 个文件夹，2 个书签')).toBeInTheDocument();
    expect(screen.getByText('1 组重复网址，涉及 2 个书签')).toBeInTheDocument();
    expect(screen.getByText('1 个已检查，1 个未检查')).toBeInTheDocument();
    expect(screen.getByText('1 个书签待整理')).toBeInTheDocument();
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.move).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.remove).not.toHaveBeenCalled();
    expect(metadata.put).not.toHaveBeenCalled();
  });
});

class MemoryStorage implements OnboardingStorageArea {
  private readonly values: Record<string, unknown> = {};

  async get(key: string) {
    return { [key]: this.values[key] };
  }

  async set(items: Record<string, unknown>) {
    Object.assign(this.values, items);
  }
}
