import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
import '../../../packages/ui/theme.css';

// Always-on kitchen display: dark goblin theme (no light mode).
document.documentElement.className = 'theme-goblin';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
