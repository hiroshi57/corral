import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const DAEMON = process.env.CORRAL_DAEMON ?? 'http://127.0.0.1:4319';

// 開発時は API / WS をデーモンへプロキシ
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5319,
    proxy: {
      '/api': { target: DAEMON, changeOrigin: true },
      '/ws': { target: DAEMON, ws: true },
    },
  },
});
