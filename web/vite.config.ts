import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const DAEMON = process.env.CORRAL_DAEMON ?? 'http://127.0.0.1:4319';

// デーモンが書き出したトークンを読む（無ければ空）。プロキシがヘッダに付与する。
function readToken(): string {
  const p = path.resolve(__dirname, '..', '.corral', 'token');
  try {
    return fs.readFileSync(p, 'utf8').trim();
  } catch {
    return process.env.CORRAL_TOKEN ?? '';
  }
}

// 開発時は API / WS をデーモンへプロキシし、認証トークンを注入する
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5319,
    proxy: {
      '/api': {
        target: DAEMON,
        changeOrigin: false, // Origin を保持（デーモンの CORS 許可オリジンに合致させる）
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            const t = readToken();
            if (t) proxyReq.setHeader('x-corral-token', t);
          });
        },
      },
      '/ws': {
        target: DAEMON,
        ws: true,
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on('proxyReqWs', (proxyReq: { setHeader: (k: string, v: string) => void }) => {
            const t = readToken();
            if (t) proxyReq.setHeader('x-corral-token', t);
          });
        },
      },
    },
  },
});
