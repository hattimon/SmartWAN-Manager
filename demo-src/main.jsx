import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import DemoHarness from './DemoHarness.jsx';
import { installDemoBackend } from './mockApi.js';

const requestedLanguage = new URLSearchParams(window.location.search).get('lang');
localStorage.setItem('smartwan-language', requestedLanguage === 'pl' ? 'pl' : 'en');
localStorage.setItem('smartwan-ui-mode', 'expert');
localStorage.setItem('aurelka-animation-enabled', '1');
localStorage.setItem('aurelka-bubbles-visible', '1');

installDemoBackend();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <DemoHarness />
  </React.StrictMode>,
);
