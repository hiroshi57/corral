// Corral デーモン エントリポイント
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { SessionManager } from './session/manager.js';
import { createRouter } from './api/routes.js';
import { attachWebSocket } from './ws/hub.js';

// --- トークンを共有ファイルへ書き出す（Vite プロキシが読んでヘッダに付与） ---
try {
  fs.mkdirSync(path.dirname(config.tokenFile), { recursive: true });
  fs.writeFileSync(config.tokenFile, config.token, 'utf8');
} catch {
  /* 書けなくても致命的ではない */
}

const app = express();
app.disable('x-powered-by');

// (1) Host ヘッダ検証：DNS リバインディング対策。
//     攻撃サイトが evil.com→127.0.0.1 に解決させても Host が loopback でないので弾く。
app.use((req: Request, res: Response, next: NextFunction) => {
  const host = (req.headers.host ?? '').split(':')[0];
  if (!config.allowedHosts.has(host)) {
    return res.status(403).json({ error: `不正な Host ヘッダ: ${host}` });
  }
  next();
});

// (2) CORS：ローカルのダッシュボード由来のオリジンのみ許可。
//     カスタムヘッダ(x-corral-token)を要求するため、許可外オリジンからの
//     クロスサイト要求はプリフライトで遮断される（CSRF対策）。
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // 同一オリジン/非ブラウザ
      cb(null, config.allowedOrigins.includes(origin));
    },
    allowedHeaders: ['Content-Type', 'x-corral-token'],
  })
);

app.use(express.json({ limit: '2mb' }));

// (3) トークン検証：health 以外の /api を保護。
function requireToken(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'OPTIONS') return next();
  if (req.path === '/health') return next();
  if (req.header('x-corral-token') !== config.token) {
    return res.status(401).json({ error: '認証トークンが不正です' });
  }
  next();
}

const sessions = new SessionManager();
app.use('/api', requireToken, createRouter(sessions));

// (4) 本番：ビルド済み Web を同一オリジンで配信し、token を HTML に注入
const webDist = path.join(config.corralRoot, 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.get('/', (_req, res) => {
    let html = fs.readFileSync(path.join(webDist, 'index.html'), 'utf8');
    html = html.replace(
      '</head>',
      `<script>window.__CORRAL_TOKEN__=${JSON.stringify(config.token)}</script></head>`
    );
    res.type('html').send(html);
  });
  app.use(express.static(webDist));
}

const server = http.createServer(app);
attachWebSocket(server, sessions);

server.listen(config.port, config.host, () => {
  console.log(`\n🐎 Corral デーモン起動`);
  console.log(`   REST: http://${config.host}:${config.port}/api`);
  console.log(`   WS  : ws://${config.host}:${config.port}/ws`);
  console.log(`   モード: ${config.demo ? 'DEMO（疑似実行）' : '本番（実エージェント起動）'}`);
  console.log(`   対象リポ: ${config.repoRoot}`);
  console.log(`   トークン: ${config.token}`);
  console.log(`   (Host検証: loopbackのみ / CORS: ダッシュボードのみ)\n`);
});
