import React from 'react';
import { createRoot } from 'react-dom/client';
import { FloatingButton } from '../src/ui/content/FloatingButton';
import { ContentToast } from '../src/ui/content/ContentToast';

const contentStyles = '.siftmark-floating{position:fixed;right:18px;bottom:18px;z-index:2147483647;display:flex;background:#111;border-radius:8px}.siftmark-floating button{width:38px;height:38px;border:0;background:transparent;color:#fff}.siftmark-toast{position:fixed;right:18px;bottom:64px;background:#111;color:#fff;padding:8px 12px}';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  cssInjectionMode: 'ui',
  async main() {
    const settings = await browser.storage.local.get('siftmark.content.floating');
    if (settings['siftmark.content.floating'] !== true) return;
    const host = document.createElement('div');
    host.id = 'siftmark-root';
    document.documentElement.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const mount = document.createElement('div');
    shadow.append(mount);
    const hide = () => {
      void browser.storage.local.set({ [`siftmark.content.hidden.${location.hostname}`]: true });
      host.remove();
    };
    createRoot(mount).render(React.createElement(React.Fragment, null,
      React.createElement('style', null, contentStyles),
      React.createElement(FloatingButton, { enabled: true, onSave: () => void browser.runtime.sendMessage({ type: 'save-current-page' }), onHide: hide }),
      React.createElement(ContentToast, null)
    ));
  }
});
