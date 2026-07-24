// git worktree 管理（Orca/uzi/squad/Conductor 共通の隔離手法）
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

export async function isGitRepo(): Promise<boolean> {
  try {
    await git(['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

/** git worktree を使うべきか（本番かつ対象が git リポジトリ） */
async function useGit(): Promise<boolean> {
  return !config.demo && (await isGitRepo());
}

export async function createWorktree(
  sessionId: string
): Promise<{ worktreePath: string; branch: string }> {
  const branch = `corral/${sessionId}`;
  const worktreePath = path.join(config.worktreeBase, sessionId);
  await fs.mkdir(config.worktreeBase, { recursive: true });

  if (!(await useGit())) {
    await fs.mkdir(worktreePath, { recursive: true });
    return { worktreePath, branch };
  }

  await git(['worktree', 'add', '-b', branch, worktreePath, 'HEAD']);
  return { worktreePath, branch };
}

export async function removeWorktree(worktreePath: string, branch: string | null): Promise<void> {
  if (!(await useGit())) {
    await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => {});
    return;
  }
  await git(['worktree', 'remove', worktreePath, '--force']).catch(() => {});
  if (branch) await git(['branch', '-D', branch]).catch(() => {});
}

/** 作業ツリー配下のファイル一覧（非git時に使用。.corral は除外） */
async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  let entries: import('node:fs').Dirent[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === '.corral' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(full, base)));
    else out.push(path.relative(base, full));
  }
  return out;
}

/** 変更ファイル数 */
export async function countChanges(worktreePath: string): Promise<number> {
  if (!(await useGit())) return (await listFiles(worktreePath)).length;
  try {
    const out = await git(['status', '--porcelain'], worktreePath);
    return out.split('\n').filter((l) => l.trim().length > 0).length;
  } catch {
    return 0;
  }
}

/** diff テキスト（レビュー画面用）。非git時はファイル内容を疑似 diff として返す */
export async function getDiff(worktreePath: string): Promise<string> {
  if (!(await useGit())) {
    const files = await listFiles(worktreePath);
    if (files.length === 0) return '変更はありません';
    const parts: string[] = [];
    for (const rel of files) {
      const content = await fs.readFile(path.join(worktreePath, rel), 'utf8').catch(() => '');
      parts.push(
        `diff --corral a/${rel} b/${rel}\n+++ ${rel}\n` +
          content
            .split('\n')
            .map((l) => `+${l}`)
            .join('\n')
      );
    }
    return parts.join('\n\n');
  }
  try {
    return await git(['diff', 'HEAD'], worktreePath);
  } catch {
    return '';
  }
}

/** 承認 = 変更を記録（uzi の checkpoint 相当）。非git時は件数だけ返す */
export async function checkpoint(
  worktreePath: string,
  message: string
): Promise<{ committed: boolean; count: number }> {
  const count = await countChanges(worktreePath);
  if (!(await useGit())) return { committed: count > 0, count };
  await git(['add', '-A'], worktreePath);
  try {
    await git(['commit', '-m', message], worktreePath);
    return { committed: true, count };
  } catch {
    return { committed: false, count: 0 };
  }
}
