// LLM プランナー: ドキュメントを実エージェントに渡し、実行可能タスクへ構造化分解する。
// エージェント CLI が使えない/失敗時は空配列を返し、呼び出し側(クライアント)が
// ヒューリスティック分解にフォールバックする。
import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { getProfile } from '../agents/registry.js';
import type { AgentKind } from '../types.js';

const PLANNER_INSTRUCTION =
  'あなたはプロジェクトマネージャです。次のドキュメント（提案書/議事録/マニュアル等）を読み、' +
  '実行可能なタスクに分解してください。出力は日本語で、1行1タスク、必ず "- " で始め、' +
  '前置き・見出し・説明は書かないこと。最大30件。\n\n---ドキュメント---\n';

const isWin = process.platform === 'win32';

/** ドキュメントからタスク候補を抽出（実エージェント）。失敗時は [] */
export async function planDocument(text: string, agent: AgentKind = 'claude'): Promise<string[]> {
  if (config.demo) return []; // デモはクライアント側ヒューリスティックに委譲
  const profile = getProfile(agent);
  const spec = profile.buildInitial(false);
  const prompt = PLANNER_INSTRUCTION + text.slice(0, 20000); // 過大入力を抑制

  return new Promise<string[]>((resolve) => {
    let out = '';
    let settled = false;
    const done = (tasks: string[]) => {
      if (!settled) {
        settled = true;
        resolve(tasks);
      }
    };
    try {
      const child = spawn(spec.command, spec.args, {
        cwd: config.repoRoot,
        shell: isWin,
        env: process.env,
      });
      const timer = setTimeout(() => {
        child.kill();
        done(parseTasks(out));
      }, 90_000);
      child.stdout?.on('data', (b: Buffer) => (out += b.toString()));
      child.on('error', () => {
        clearTimeout(timer);
        done([]); // CLI 不在等 → フォールバック
      });
      child.on('exit', () => {
        clearTimeout(timer);
        done(parseTasks(out));
      });
      // プロンプトは stdin 経由（argv/シェルに載せない）
      if (spec.deliver === 'stdin' && child.stdin) {
        child.stdin.write(prompt + '\n');
        child.stdin.end();
      }
    } catch {
      done([]);
    }
  });
}

function parseTasks(out: string): string[] {
  const tasks = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, '').trim())
    .filter((l) => l.length >= 3 && l.length <= 160);
  return [...new Set(tasks)].slice(0, 30);
}
