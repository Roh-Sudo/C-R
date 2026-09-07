import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ root: 'apps/web', plugins: [react()], server: { port: 5173, allowedHosts: ['rogiths-macbook-air.tail23a342.ts.net'], proxy: { '/api': 'http://localhost:8787' } } });
