import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../../entrypoints/sidepanel/App';
import type { CaptureSession } from '../../../src/capture-agent';

const session: CaptureSession = {
  id: 'session-1',
  bookmarkId: 'bookmark-1',
  trigger: 'native-bookmark',
  sourceSnapshot: {
    id: 'bookmark-1',
    parentId: 'inbox',
    index: 0,
    title: '原始页面标题',
    url: 'https://example.com/article'
  },
  state: 'pending',
  plan: {
    destination: {
      folderId: 'development',
      path: [{ id: 'development', title: '开发' }],
      newFolders: ['Agent']
    },
    title: '更清晰的页面标题',
    tags: ['AI', '浏览器'],
    summary: '关于浏览器收藏 Agent 的设计。',
    confidence: 'medium',
    reason: '内容与开发工具相关。',
    relatedBookmarks: [],
    generatedAt: 1
  },
  risk: {
    decision: 'approval',
    reasons: ['new-folder'],
    canExecute: true
  },
  messages: [],
  createdAt: 1,
  updatedAt: 1,
  expiresAt: Date.now() + 60_000
};

describe('Side panel Agent workspace', () => {
  const sendMessage = vi.fn();

  beforeEach(() => {
    sendMessage.mockReset();
    sendMessage.mockImplementation(async (request: { type: string }) => {
      if (request.type === 'capture-agent-get-active') return session;
      if (request.type === 'capture-agent-list-pending') return [session];
      if (request.type === 'capture-agent-action') {
        return { success: true, session };
      }
      return null;
    });
    vi.stubGlobal('browser', {
      runtime: {
        sendMessage,
        openOptionsPage: vi.fn(),
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn()
        }
      },
      tabs: { create: vi.fn() }
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('sends with Enter while Shift+Enter remains available for a new line', async () => {
    render(<App />);
    const composer = await screen.findByRole('textbox', {
      name: '调整收藏方案'
    });
    fireEvent.change(composer, { target: { value: '换到产品目录' } });
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true });
    expect(actionRequests()).toHaveLength(0);

    fireEvent.keyDown(composer, { key: 'Enter' });
    await waitFor(() => expect(actionRequests()).toHaveLength(1));
    expect(actionRequests()[0]).toMatchObject({
      input: { action: 'message', message: '换到产品目录' }
    });
  });

  it('offers one-click adjustments based on the current proposal', async () => {
    render(<App />);
    await screen.findByText('更清晰的页面标题');

    fireEvent.click(screen.getByRole('button', { name: '不要新建目录' }));
    await waitFor(() => expect(actionRequests()).toHaveLength(1));
    expect(actionRequests()[0]).toMatchObject({
      input: { action: 'message', message: '不要新建目录，请改用已有目录' }
    });
  });

  function actionRequests() {
    return sendMessage.mock.calls
      .map(([request]) => request as { type?: string; input?: unknown })
      .filter((request) => request.type === 'capture-agent-action');
  }
});
