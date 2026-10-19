import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { CustomerDisplay } from './screens/CustomerDisplay';
import './index.css';
import '../../../packages/ui/theme.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).get('display') === 'customer' ? <CustomerDisplay /> : <App />}
  </React.StrictMode>,
);
