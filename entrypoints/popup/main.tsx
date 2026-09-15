import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '../../src/ui/styles/base.css';
import './popup.css';
import { ChromeSettingsRepository } from '../../src/settings/settings-repository';
import { hydrateTheme } from '../../src/ui/theme/theme-store';

const settings = new ChromeSettingsRepository(browser.storage.local);
void hydrateTheme(settings);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

