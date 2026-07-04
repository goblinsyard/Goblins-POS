import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { applyDir } from './lib/i18n';
import './index.css';
import '../../../packages/ui/theme.css';

// Apply the saved appearance + language direction before first paint (default: light goblin, LTR).
const mode = localStorage.getItem('bo.mode') ?? 'light';
document.documentElement.className = mode === 'dark' ? 'theme-goblin' : 'light theme-goblin';
applyDir();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
