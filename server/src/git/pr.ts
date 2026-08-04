// ④ PR 自動作成（#7）: worktree の変更を push し、gh CLI で Pull Request を作る。
// 説明文はエージェントの成果（指示履歴・差分統計）から自動生成する。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import type { Session } from '../types.js';

const execFileAsync = promisify(execFile);

async function run(cmd: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout.toString();
}

/** gh CLI が使えるか */
export async function ghAvailable(): Promise<boolean> {
  if (config.demo) return false;
  try {
    await execFileAsync('gh', ['--version'], { timeout: 5000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/** PR 本文を自動生成（AI生成説明文の代替＝実績ベースの構造化サマリ） */
export function buildPrBody(session: Session, diffStat: string): string {
  const turns = session.turns.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const cost = session.usage.costUsd;
  const lines = [
    '## 概要',
    session.turns[0] ?? session.prompt,
    '',
    '## 指示の履歴',
    turns,
    '',
    '## 変更内容',
    '```',
    diffStat.trim() || '(統計なし)',
    '```',
    '',
    '## 実行情報',
    `- エージェント: ${session.agent}`,
    `- ブランチ: ${session.branch ?? '-'}`,
    `- 変更ファイル数: ${session.changedFiles}`,
    `- 実行回数: ${session.usage.runs} / 所要: ${(session.durationMs / 1000).toFixed(1)}秒`,
    `- 推定コスト: $${cost.toFixed(cost < 1 ? 4 : 2)}`,
    `- 人手介入: ${session.interventions} 回`,
  ];
  if (session.violations.length) {
    lines.push(
      '',
      '## ガードレール',
      ...session.violations.map((v) => `- ${v.blocked ? '⛔' : '⚠️'} ${v.detail}`)
    );
  }
  lines.push('', '---', '🐎 Generated with Corral');
  return lines.join('\n');
}

export interface PrResult {
  ok: boolean;
  url?: string;
  error?: string;
}

/**
 * worktree のブランチを push し、PR を作成する。
 * 事前に commit（承認）済みであることを想定。未コミット分があれば取り込む。
 */
export async function createPullRequest(
  session: Session,
  opts: { title?: string; draft?: boolean; base?: string } = {}
): Promise<PrResult> {
  if (config.demo) {
    return { ok: false, error: 'DEMO モードでは PR を作成しません（実リポジトリで実行してください）' };
  }
  const cwd = session.worktreePath;
  if (!cwd || !session.branch) return { ok: false, error: 'worktree がありません' };
  if (!(await ghAvailable())) {
    return { ok: false, error: 'gh CLI が見つかりません（GitHub CLI をインストールしてください）' };
  }

  try {
    // 未コミットの変更があれば取り込む
    const status = await run('git', ['status', '--porcelain'], cwd);
    if (status.trim()) {
      await run('git', ['add', '-A'], cwd);
      await run('git', ['commit', '-m', `corral: ${session.title}`], cwd);
    }

    // 差分統計（PR 本文用）
    let diffStat = '';
    try {
      const base = opts.base ?? (await defaultBase(cwd));
      diffStat = await run('git', ['diff', '--stat', `${base}...HEAD`], cwd);
    } catch {
      diffStat = await run('git', ['show', '--stat', '--oneline', 'HEAD'], cwd).catch(() => '');
    }

    // push（upstream 未設定なら設定）
    await run('git', ['push', '-u', 'origin', session.branch], cwd);

    // PR 作成
    const args = [
      'pr',
      'create',
      '--head',
      session.branch,
      '--title',
      opts.title ?? `corral: ${session.title}`,
      '--body',
      buildPrBody(session, diffStat),
    ];
    if (opts.base) args.push('--base', opts.base);
    if (opts.draft) args.push('--draft');

    const out = await run('gh', args, cwd);
    const url = out.match(/https:\/\/\S+/)?.[0];
    return { ok: true, url };
  } catch (e) {
    const err = e as Error & { stderr?: string };
    return { ok: false, error: (err.stderr || err.message || '').toString().slice(0, 500) };
  }
}

/** 既定ベースブランチを推定 */
async function defaultBase(cwd: string): Promise<string> {
  try {
    const out = await run('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], cwd);
    return out.trim().replace('refs/remotes/', '');
  } catch {
    return 'origin/main';
  }
}
