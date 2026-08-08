import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FloatingButton } from '../src/ui/content/FloatingButton';
import { ContentToast } from '../src/ui/content/ContentToast';
import { extractPageCapture } from '../src/capture/extract-page';

const contentStyles = '.siftmark-floating{position:fixed;right:18px;bottom:18px;z-index:2147483647;display:flex;background:#111;border-radius:8px;box-shadow:0 8px 24px rgb(0 0 0 / 24%)}.siftmark-floating button{width:38px;height:38px;border:0;background:transparent;color:#fff;display:grid;place-items:center}.siftmark-floating svg{width:18px}.siftmark-floating .siftmark-drag{cursor:grab;color:#b7ff36}.siftmark-toast{position:fixed;right:18px;bottom:64px;z-index:2147483647;background:#111;color:#fff;padding:8px 12px;border-radius:4px;font:14px sans-serif}';

function ContentEntry({ host, initialPosition }: { host: HTMLElement; initialPosition: { x: number; y: number } }) {
  const [message, setMessage] = useState<string>();
  const hide = () => { void browser.storage.local.set({ [`siftmark.content.hidden.${location.hostname}`]: true }); host.remove(); };
  const save = async () => {
    setMessage('正在保存');
    try { await browser.runtime.sendMessage({ type: 'save-current-page' }); setMessage('已保存到书签'); }
    catch { setMessage('保存失败，请打开扩展重试'); }
  };
  return React.createElement(React.Fragment, null,
    React.createElement('style', null, contentStyles),
    React.createElement(FloatingButton, { enabled: true, initialPosition, onSave: () => void save(), onHide: hide, onPositionChange: (position) => void browser.storage.local.set({ 'siftmark.content.position': position }) }),
    React.createElement(ContentToast, { message })
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
    if (settings['siftmark.content.floating'] !== true || settings[hiddenKey] === true) return;
    const host = document.createElement('div');
    host.id = 'siftmark-root';
    document.documentElement.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const mount = document.createElement('div');
    shadow.append(mount);
    const storedPosition = settings['siftmark.content.position'];
    const initialPosition = typeof storedPosition === 'object' && storedPosition !== null && 'x' in storedPosition && 'y' in storedPosition ? { x: Number(storedPosition.x) || 0, y: Number(storedPosition.y) || 0 } : { x: 0, y: 0 };
    createRoot(mount).render(React.createElement(ContentEntry, { host, initialPosition }));
  }
});
