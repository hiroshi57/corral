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

/**
 * グラフ・エンジニアリング版プランナー:
 * タスクを「一直線」ではなく依存グラフ(DAG)として出力させる。
 * 形式: "1|タスク内容|依存番号(カンマ区切り、なければ空)"
 */
const GRAPH_INSTRUCTION =
  'あなたは熟練のプロジェクトマネージャです。次のドキュメントを読み、実行可能なタスクへ分解し、' +
  '**依存関係のあるグラフ(DAG)**として設計してください。一直線にせず、並列実行できるものは並列に、' +
  '前提が必要なものだけ依存させ、統合作業は複数タスクに合流(fan-in)させてください。\n' +
  '出力形式は厳守（1行1タスク・前置きや説明なし・最大30行）:\n' +
  '番号|タスク内容|依存する番号(カンマ区切り、なければ空)\n' +
  '例:\n1|現状のAPI構造を調査|\n2|DB設計を作成|\n3|認証APIを実装|1,2\n4|E2Eテストを追加|3\n' +
  '\n---ドキュメント---\n';

export interface PlannedNode {
  /** ドキュメント内の一時ID（1始まりの番号） */
  ref: number;
  text: string;
  /** 依存する ref 番号 */
  deps: number[];
}

const isWin = process.platform === 'win32';

/** ドキュメントからタスク候補を抽出（実エージェント）。失敗時は [] */
export async function planDocument(text: string, agent: AgentKind = 'claude'): Promise<string[]> {
  const out = await runAgent(PLANNER_INSTRUCTION + text.slice(0, 20000), agent);
  return parseTasks(out);
}

/**
 * ドキュメントを依存グラフ(DAG)として分解。失敗時は []。
 * 記事「GRAPH ENGINEERING」の思想（直線でなくグラフで艦隊を編成）に対応。
 */
export async function planGraph(text: string, agent: AgentKind = 'claude'): Promise<PlannedNode[]> {
  const out = await runAgent(GRAPH_INSTRUCTION + text.slice(0, 20000), agent);
  return parseGraph(out);
}

function parseGraph(out: string): PlannedNode[] {
  const nodes: PlannedNode[] = [];
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*]\s*/, '');
    const m = line.match(/^(\d+)\s*\|\s*([^|]+?)\s*\|\s*([\d,\s]*)$/);
    if (!m) continue;
    const ref = Number(m[1]);
    const body = m[2].trim();
    if (!body || body.length > 200) continue;
    const deps = m[3]
      .split(',')
      .map((d) => Number(d.trim()))
      .filter((d) => Number.isFinite(d) && d > 0 && d !== ref);
    nodes.push({ ref, text: body, deps });
  }
  // 存在しない ref への依存を除去
  const refs = new Set(nodes.map((n) => n.ref));
  for (const n of nodes) n.deps = n.deps.filter((d) => refs.has(d));
  return nodes.slice(0, 30);
}

/** エージェント CLI を1回起動して stdout を返す（失敗時は空文字） */
function runAgent(prompt: string, agent: AgentKind): Promise<string> {
  if (config.demo) return Promise.resolve(''); // デモはクライアント側にフォールバック
  const profile = getProfile(agent);
  const spec = profile.buildInitial(false);

  return new Promise<string>((resolve) => {
    let out = '';
    let settled = false;
    const done = (text: string) => {
      if (!settled) {
        settled = true;
        resolve(text);
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
        done(out);
      }, 90_000);
      child.stdout?.on('data', (b: Buffer) => (out += b.toString()));
      child.on('error', () => {
        clearTimeout(timer);
        done(''); // CLI 不在等 → フォールバック
      });
      child.on('exit', () => {
        clearTimeout(timer);
        done(out);
      });
      // プロンプトは stdin 経由（argv/シェルに載せない）
      if (spec.deliver === 'stdin' && child.stdin) {
        child.stdin.write(prompt + '\n');
        child.stdin.end();
      }
    } catch {
      done('');
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
