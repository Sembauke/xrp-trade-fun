import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import App from './App';
import { Landing } from './pages/Landing';
import { AssetPage } from './pages/AssetPage';
import './index.css';

function deriveApiBase(envValue: string | undefined, fallbackPort: number) {
  if (envValue && envValue.trim() !== '') return envValue.trim();
  const url = new URL(window.location.origin);
  // If we're on localhost with a Vite port, swap to the API port.
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    url.port = String(fallbackPort);
    return url.origin;
  }
  // On NAS/production (no port in URL), explicitly target the API port to reach the right bot instance.
  if (!url.port) {
    url.port = String(fallbackPort);
  }
  return url.origin;
}

const API_XRP = deriveApiBase(import.meta.env.VITE_API_BASE_XRP, 8787);
const API_BTC = deriveApiBase(import.meta.env.VITE_API_BASE_BTC, 8788);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/xrp" element={<AssetPage apiBase={API_XRP} symbol="XRPUSDT" />} />
        <Route path="/btc" element={<AssetPage apiBase={API_BTC} symbol="BTCUSDT" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
