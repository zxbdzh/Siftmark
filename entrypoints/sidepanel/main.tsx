import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/ui/styles/base.css';
import App from './App';
import './sidepanel.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
