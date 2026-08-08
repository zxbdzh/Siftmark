import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '../../src/ui/styles/base.css';
import '../../src/ui/manager/manager.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
