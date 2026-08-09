import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FloatingButton } from '../src/ui/content/FloatingButton';
import { ContentToast } from '../src/ui/content/ContentToast';
import { extractPageCapture } from '../src/capture/extract-page';

const contentStyles = '.siftmark-floating{position:fixed;right:18px;bottom:18px;z-index:2147483647;display:flex;background:#111;border-radius:8px;box-shadow:0 8px 24px rgb(0 0 0 / 24%)}.siftmark-floating button{width:38px;height:38px;border:0;background:transparent;color:#fff;display:grid;place-items:center}.siftmark-floating svg{width:18px}.siftmark-floating .siftmark-drag{cursor:grab;color:#b7ff36}.siftmark-toast{position:fixed;right:18px;bottom:64px;z-index:2147483647;display:flex;align-items:flex-start;gap:9px;width:min(360px,calc(100vw - 36px));padding:11px 13px;border:1px solid rgb(255 255 255 / 18%);border-radius:6px;background:#17191d;color:#fff;box-shadow:0 12px 30px rgb(0 0 0 / 26%);font:14px/1.45 "Noto Sans SC",system-ui,sans-serif}.siftmark-toast::before{content:"";flex:none;width:8px;height:8px;margin-top:6px;border-radius:50%;background:#4f6ef7}.siftmark-toast[data-tone="processing"]::before{animation:siftmark-pulse 1.1s ease-in-out infinite}.siftmark-toast[data-tone="success"]::before{background:#39b86c}.siftmark-toast[data-tone="error"]::before{background:#e05252}@keyframes siftmark-pulse{50%{opacity:.35;transform:scale(.72)}}@media(prefers-reduced-motion:reduce){.siftmark-toast[data-tone="processing"]::before{animation:none}}';

type ToastTone = 'processing' | 'success' | 'error';
interface ToastState {
  message: string;
  tone: ToastTone;
}

function ContentEntry({ floatingEnabled, initialPosition }: { floatingEnabled: boolean; initialPosition: { x: number; y: number } }) {
  const [buttonEnabled, setButtonEnabled] = useState(floatingEnabled);
  const [toast, setToast] = useState<ToastState>();
  const dismissTimer = useRef<ReturnType<typeof globalThis.setTimeout>>();
  const showToast = (message: string, tone: ToastTone, duration?: number) => {
    if (dismissTimer.current) globalThis.clearTimeout(dismissTimer.current);
    setToast({ message, tone });
    dismissTimer.current = duration
      ? globalThis.setTimeout(() => setToast(undefined), duration)
      : undefined;
  };
  useEffect(() => {
    const listener = (message: unknown) => {
      const value = message as {
        type?: string;
        status?: ToastTone;
        detail?: string;
      };
      if (value.type !== 'native-smart-bookmark-status' || !value.status) return;
      const fallback =
        value.status === 'processing'
          ? '正在整理书签…'
          : value.status === 'success'
            ? '收藏成功'
            : '智能收藏失败';
      showToast(
        value.detail || fallback,
        value.status,
        value.status === 'processing' ? undefined : value.status === 'success' ? 6_000 : 8_000
      );
    };
    browser.runtime.onMessage.addListener(listener);
    return () => {
      browser.runtime.onMessage.removeListener(listener);
      if (dismissTimer.current) globalThis.clearTimeout(dismissTimer.current);
    };
  }, []);
  const hide = () => {
    setButtonEnabled(false);
    void browser.storage.local.set({
      [`siftmark.content.hidden.${location.hostname}`]: true
    });
  };
  const save = async () => {
    showToast('正在分析页面并整理书签…', 'processing');
    try {
      const result = await browser.runtime.sendMessage({ type: 'save-current-page' }) as {
        success?: boolean;
        category?: string;
        error?: string;
      };
      showToast(
        result.success ? `已收藏到 ${result.category || '书签栏'}` : result.error || '智能收藏失败，请打开扩展重试',
        result.success ? 'success' : 'error',
        result.success ? 6_000 : 8_000
      );
    } catch {
      showToast('智能收藏失败，请打开扩展重试', 'error', 8_000);
    }
  };
  return React.createElement(React.Fragment, null,
    React.createElement('style', null, contentStyles),
    React.createElement(FloatingButton, { enabled: buttonEnabled, initialPosition, onSave: () => void save(), onHide: hide, onPositionChange: (position) => void browser.storage.local.set({ 'siftmark.content.position': position }) }),
    React.createElement(ContentToast, { message: toast?.message, tone: toast?.tone })
  );
}

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  cssInjectionMode: 'ui',
  async main() {
    browser.runtime.onMessage.addListener((message: unknown) => {
      const value = message as { type?: string; blockedDomains?: string[] };
      if (value.type === 'capture-page') return Promise.resolve(extractPageCapture(document, location, value.blockedDomains ?? []));
    });
    const hiddenKey = `siftmark.content.hidden.${location.hostname}`;
    const settings = await browser.storage.local.get(['siftmark.content.floating', 'siftmark.content.position', hiddenKey]);
    const host = document.createElement('div');
    host.id = 'siftmark-root';
    document.documentElement.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const mount = document.createElement('div');
    shadow.append(mount);
    const storedPosition = settings['siftmark.content.position'];
    const initialPosition = typeof storedPosition === 'object' && storedPosition !== null && 'x' in storedPosition && 'y' in storedPosition ? { x: Number(storedPosition.x) || 0, y: Number(storedPosition.y) || 0 } : { x: 0, y: 0 };
    const floatingEnabled = settings['siftmark.content.floating'] === true && settings[hiddenKey] !== true;
    createRoot(mount).render(React.createElement(ContentEntry, { floatingEnabled, initialPosition }));
  }
});
