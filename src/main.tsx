import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import App from './App';
import { Landing } from './pages/Landing';
import { AssetPage } from './pages/AssetPage';
import './index.css';

function deriveApiBase(envValue: string | undefined, fallbackPath: string) {
  if (envValue && envValue.trim() !== '') return envValue.trim();
  return `${window.location.origin}${fallbackPath}`;
}

const API_XRP = deriveApiBase(import.meta.env.VITE_API_BASE_XRP, '/api/xrp');
const API_BTC = deriveApiBase(import.meta.env.VITE_API_BASE_BTC, '/api/btc');

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
