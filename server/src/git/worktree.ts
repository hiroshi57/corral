// git worktree 管理（Orca/uzi/squad 共通の隔離手法）
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd = config.repoRoot): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

/** 対象がgitリポジトリか */
export async function isGitRepo(): Promise<boolean> {
  try {
    await git(['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

/**
 * セッション専用の worktree とブランチを作る。
 * デモモードや非gitでは通常ディレクトリを作って代替する。
 */
export async function createWorktree(
  sessionId: string
): Promise<{ worktreePath: string; branch: string }> {
  const branch = `corral/${sessionId}`;
  const worktreePath = path.join(config.worktreeBase, sessionId);
  await fs.mkdir(config.worktreeBase, { recursive: true });

  if (config.demo || !(await isGitRepo())) {
    await fs.mkdir(worktreePath, { recursive: true });
    return { worktreePath, branch };
  }

  await git(['worktree', 'add', '-b', branch, worktreePath, 'HEAD']);
  return { worktreePath, branch };
}

/** worktree を削除（差し戻し/破棄） */
export async function removeWorktree(worktreePath: string, branch: string | null): Promise<void> {
  if (config.demo || !(await isGitRepo())) {
    await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => {});
    return;
  }
  await git(['worktree', 'remove', worktreePath, '--force']).catch(() => {});
  if (branch) await git(['branch', '-D', branch]).catch(() => {});
}

/** worktree の変更ファイル数を数える */
export async function countChanges(worktreePath: string): Promise<number> {
  if (config.demo || !(await isGitRepo())) return 0;
  try {
    const out = await git(['status', '--porcelain'], worktreePath);
    return out.split('\n').filter((l) => l.trim().length > 0).length;
  } catch {
    return 0;
  }
}

/** diff テキストを取得（レビュー画面用） */
export async function getDiff(worktreePath: string): Promise<string> {
  if (config.demo || !(await isGitRepo())) {
    return '（デモモード：実 diff はありません。実リポジトリで CORRAL_DEMO=0 として起動してください）';
  }
  try {
    return await git(['diff', 'HEAD'], worktreePath);
  } catch {
    return '';
  }
}

/**
 * 承認 = 変更を commit（uzi の checkpoint 相当）。
 */
export async function checkpoint(
  worktreePath: string,
  message: string
): Promise<{ committed: boolean }> {
  if (config.demo || !(await isGitRepo())) return { committed: false };
  await git(['add', '-A'], worktreePath);
  try {
    await git(['commit', '-m', message], worktreePath);
    return { committed: true };
  } catch {
    return { committed: false }; // 変更なし等
  }
}
