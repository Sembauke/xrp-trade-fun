import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

function deriveApiBase(envValue: string | undefined, fallbackPath: string) {
  if (envValue && envValue.trim() !== '') return envValue.trim();
  return `${window.location.origin}${fallbackPath}`;
}

const API_XRP = deriveApiBase(import.meta.env.VITE_API_BASE_XRP, '/api');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App apiBase={API_XRP} expectedSymbol="XRPUSDT" />
  </React.StrictMode>,
);
