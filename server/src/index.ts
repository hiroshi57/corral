// Corral デーモン エントリポイント
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { SessionManager } from './session/manager.js';
import { createRouter } from './api/routes.js';
import { attachWebSocket } from './ws/hub.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const sessions = new SessionManager();
app.use('/api', createRouter(sessions));

const server = http.createServer(app);
attachWebSocket(server, sessions);

server.listen(config.port, config.host, () => {
  console.log(`\n🐎 Corral デーモン起動`);
  console.log(`   REST: http://${config.host}:${config.port}/api`);
  console.log(`   WS  : ws://${config.host}:${config.port}/ws`);
  console.log(`   モード: ${config.demo ? 'DEMO（疑似実行）' : '本番（実エージェント起動）'}`);
  console.log(`   対象リポ: ${config.repoRoot}\n`);
});
