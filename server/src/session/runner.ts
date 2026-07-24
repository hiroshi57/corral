// 実行抽象：実プロセス起動 or デモ疑似実行
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { config } from '../config.js';
import { getProfile } from '../agents/registry.js';
import type { AgentKind } from '../types.js';

export interface RunnerEvents {
  output: (stream: 'stdout' | 'stderr', text: string) => void;
  exit: (code: number | null) => void;
}

export interface Runner {
  on<K extends keyof RunnerEvents>(event: K, listener: RunnerEvents[K]): void;
  /** 追加指示を標準入力へ送る（broadcast / 差し戻し） */
  send(text: string): void;
  stop(): void;
}

/** 実エージェント CLI を子プロセスで起動 */
export class ProcessRunner extends EventEmitter implements Runner {
  private child: ChildProcess;

  constructor(agent: AgentKind, prompt: string, autoAccept: boolean, cwd: string) {
    super();
    const profile = getProfile(agent);
    const args = profile.buildArgs(prompt, autoAccept);
    this.child = spawn(profile.command, args, {
      cwd,
      shell: process.platform === 'win32', // Windows で .cmd 解決のため
      env: process.env,
    });

    this.child.stdout?.on('data', (b: Buffer) => this.emit('output', 'stdout', b.toString()));
    this.child.stderr?.on('data', (b: Buffer) => this.emit('output', 'stderr', b.toString()));
    this.child.on('error', (err) => {
      this.emit('output', 'stderr', `[起動エラー] ${err.message}\n`);
      this.emit('exit', 1);
    });
    this.child.on('exit', (code) => this.emit('exit', code));
  }

  send(text: string): void {
    this.child.stdin?.write(text.endsWith('\n') ? text : text + '\n');
  }

  stop(): void {
    this.child.kill();
  }
}

/** デモ用：エージェントが無くても動く疑似実行 */
export class DemoRunner extends EventEmitter implements Runner {
  private timers: NodeJS.Timeout[] = [];
  private stopped = false;

  constructor(agent: AgentKind, prompt: string) {
    super();
    const profile = getProfile(agent);
    const steps = [
      `${profile.label} を worktree で起動しました。`,
      `タスクを解析中: 「${prompt}」`,
      'ファイルを走査しています...',
      '3 ファイルの変更案を生成しました。',
      '変更を適用しました。人間のレビューを待ちます。',
    ];
    steps.forEach((line, i) => {
      const t = setTimeout(() => {
        if (this.stopped) return;
        this.emit('output', 'stdout', line + '\n');
        if (i === steps.length - 1) this.emit('exit', 0);
      }, 700 * (i + 1));
      this.timers.push(t);
    });
  }

  send(text: string): void {
    this.emit('output', 'stdout', `[追加指示を受信] ${text}\n`);
  }

  stop(): void {
    this.stopped = true;
    this.timers.forEach(clearTimeout);
    this.emit('exit', null);
  }
}

export function createRunner(
  agent: AgentKind,
  prompt: string,
  autoAccept: boolean,
  cwd: string
): Runner {
  return config.demo
    ? new DemoRunner(agent, prompt)
    : new ProcessRunner(agent, prompt, autoAccept, cwd);
}
