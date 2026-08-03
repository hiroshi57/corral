// エージェント自動検出: インストール済み CLI を判定して UI に提示する
import { execFile } from 'node:child_process';
import { config } from '../config.js';
import { AGENT_PROFILES } from './registry.js';
import type { AgentKind } from '../types.js';

export interface DetectedAgent {
  kind: AgentKind;
  label: string;
  command: string;
  available: boolean;
  version?: string;
}

const isWin = process.platform === 'win32';
let cache: { at: number; data: DetectedAgent[] } | null = null;

function probe(command: string): Promise<{ ok: boolean; version?: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      command,
      ['--version'],
      { timeout: 5000, shell: isWin, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve({ ok: false });
        resolve({ ok: true, version: stdout.toString().trim().split('\n')[0]?.slice(0, 40) });
      }
    );
    child.on('error', () => resolve({ ok: false }));
  });
}

/** 各エージェント CLI の有無を検出（30秒キャッシュ） */
export async function detectAgents(): Promise<DetectedAgent[]> {
  if (cache && Date.now() - cache.at < 30_000) return cache.data;

  const kinds = Object.keys(AGENT_PROFILES) as AgentKind[];
  const data: DetectedAgent[] = await Promise.all(
    kinds.map(async (kind) => {
      const p = AGENT_PROFILES[kind];
      // DEMO では全て利用可能として見せる（UI 体験用）
      if (config.demo) {
        return { kind, label: p.label, command: p.command, available: kind !== 'custom' };
      }
      const r = await probe(p.command);
      return { kind, label: p.label, command: p.command, available: r.ok, version: r.version };
    })
  );
  cache = { at: Date.now(), data };
  return data;
}
