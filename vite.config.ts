import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

const gitSha = process.env.GIT_SHA?.slice(0, 7) ?? process.env.VITE_GIT_SHA?.slice(0, 7) ?? '';
const appVersionBase = process.env.VITE_APP_VERSION?.trim() || pkg.version;
const appVersion = gitSha ? `${appVersionBase}+${gitSha}` : appVersionBase;
const buildTime = new Date().toISOString();

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
});
