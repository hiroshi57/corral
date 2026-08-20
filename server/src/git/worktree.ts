// git worktree 管理（Orca/uzi/squad/Conductor 共通の隔離手法）
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd = config.repoRoot): Promise<string> {
  // core.quotepath=false: 日本語ファイル名を \346... とエスケープせずそのまま表示する
  // （資料フォルダの案件では日本語ファイル名が主になるため必須）
  const { stdout } = await execFileAsync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
    encoding: 'utf8',
  });
  return stdout;
}

export async function isGitRepo(repoRoot = config.repoRoot): Promise<boolean> {
  try {
    await git(['rev-parse', '--is-inside-work-tree'], repoRoot);
    return true;
  } catch {
    return false;
  }
}

/** git worktree を使うべきか（本番かつ対象が git リポジトリ） */
async function useGit(repoRoot = config.repoRoot): Promise<boolean> {
  return !config.demo && (await isGitRepo(repoRoot));
}

/**
 * 対象フォルダを「案件」として使えるようにする。
 * git 管理でない場合（提案書・議事録などの資料フォルダ）は自動で git init して
 * 初回コミットを作る。これにより、コードでない案件でも
 * 作業コピーの隔離・差分レビュー・承認（履歴）が同じ仕組みで使える。
 */
export async function ensureRepo(
  repoRoot: string = config.repoRoot
): Promise<{ ok: boolean; initialized: boolean }> {
  if (config.demo) return { ok: false, initialized: false };
  if (await isGitRepo(repoRoot)) return { ok: true, initialized: false };
  if (!config.autoGitInit) return { ok: false, initialized: false };
  try {
    await fs.mkdir(repoRoot, { recursive: true });
    await git(['init'], repoRoot);
    await git(['add', '-A'], repoRoot).catch(() => {});
    await git(
      [
        '-c',
        'user.name=Corral',
        '-c',
        'user.email=corral@local',
        'commit',
        '-m',
        'corral: 案件フォルダを初期化',
        '--allow-empty',
      ],
      repoRoot
    );
    return { ok: true, initialized: true };
  } catch {
    return { ok: false, initialized: false };
  }
}

/** #4 マルチリポ: 対象リポジトリ(repoRoot)から worktree を作る */
export async function createWorktree(
  sessionId: string,
  repoRoot: string = config.repoRoot
): Promise<{ worktreePath: string; branch: string; initializedRepo: boolean }> {
  const branch = `corral/${sessionId}`;
  const worktreePath = path.join(config.worktreeBase, sessionId);
  await fs.mkdir(config.worktreeBase, { recursive: true });

  // 資料フォルダ等（非git）は必要なら初期化してから隔離する
  const { ok, initialized } = await ensureRepo(repoRoot);

  if (!ok || !(await useGit(repoRoot))) {
    // どうしても git を使えない場合のみ、素のフォルダで作業する
    await fs.mkdir(worktreePath, { recursive: true });
    return { worktreePath, branch, initializedRepo: false };
  }

  await git(['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], repoRoot);
  return { worktreePath, branch, initializedRepo: initialized };
}

export async function removeWorktree(
  worktreePath: string,
  branch: string | null,
  repoRoot: string = config.repoRoot
): Promise<void> {
  if (!(await useGit(repoRoot))) {
    await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => {});
    return;
  }
  await git(['worktree', 'remove', worktreePath, '--force'], repoRoot).catch(() => {});
  if (branch) await git(['branch', '-D', branch], repoRoot).catch(() => {});
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

/** 変更されたファイルの相対パス一覧（ガードレール用） */
export async function changedFilePaths(worktreePath: string): Promise<string[]> {
  if (!(await useGit(worktreePath))) return listFiles(worktreePath);
  try {
    const out = await git(['status', '--porcelain'], worktreePath);
    return out
      .split('\n')
      .map((l) => l.slice(3).trim())
      .filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

/** 変更ファイル数 */
export async function countChanges(worktreePath: string): Promise<number> {
  if (!(await useGit(worktreePath))) return (await listFiles(worktreePath)).length;
  try {
    const out = await git(['status', '--porcelain'], worktreePath);
    return out.split('\n').filter((l) => l.trim().length > 0).length;
  } catch {
    return 0;
  }
}

/** diff テキスト（レビュー画面用）。非git時はファイル内容を疑似 diff として返す */
export async function getDiff(worktreePath: string): Promise<string> {
  if (!(await useGit(worktreePath))) {
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
    const pending = await git(['diff', 'HEAD'], worktreePath);
    if (pending.trim()) return pending;
    // 承認(commit)済みで未コミット差分が無い場合は、このブランチのコミット内容を表示する
    const committed = await git(
      ['diff', '--stat', '-p', 'HEAD~1..HEAD'],
      worktreePath
    ).catch(() => git(['show', '--format=%s%n', 'HEAD'], worktreePath));
    return committed.trim() ? `# 承認済み（コミット内容）\n${committed}` : '変更はありません';
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
  if (!(await useGit(worktreePath))) return { committed: count > 0, count };
  await git(['add', '-A'], worktreePath);
  try {
    await git(['commit', '-m', message], worktreePath);
    return { committed: true, count };
  } catch {
    return { committed: false, count: 0 };
  }
}
