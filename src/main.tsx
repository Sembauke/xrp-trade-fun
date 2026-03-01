import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import App from './App';
import { Landing } from './pages/Landing';
import { AssetPage } from './pages/AssetPage';
import './index.css';

const API_XRP = import.meta.env.VITE_API_BASE_XRP ?? '';
const API_BTC = import.meta.env.VITE_API_BASE_BTC ?? '';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/xrp" element={<AssetPage apiBase={API_XRP} />} />
        <Route path="/btc" element={<AssetPage apiBase={API_BTC} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
