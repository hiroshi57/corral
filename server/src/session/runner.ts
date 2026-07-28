// 実行抽象：1回のエージェント起動 = 1 Runner。
//
// セキュリティ設計:
//  - ユーザーのプロンプトは argv にもシェル文字列にも載せない。
//    stdin かファイル経由でのみ渡すため、コマンドインジェクションが構造的に起きない。
//  - POSIX では shell:false（配列 argv でそのまま実行）。
//    Windows は .cmd 実行のため shell を使うが、argv にユーザー文字列が無いので安全。
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getProfile, type RunSpec } from '../agents/registry.js';
import type { AgentKind } from '../types.js';

export interface Runner {
  on(event: 'output', listener: (stream: 'stdout' | 'stderr', text: string) => void): void;
  on(event: 'exit', listener: (code: number | null) => void): void;
  stop(): void;
}

const isWin = process.platform === 'win32';

/** 実エージェント CLI を子プロセスで1回起動 */
export class ProcessRunner extends EventEmitter implements Runner {
  private child: ChildProcess;

  constructor(spec: RunSpec, prompt: string, cwd: string) {
    super();
    const args = [...spec.args];

    // deliver=file: プロンプトを worktree 内のファイルへ書き、そのパスだけを argv に足す
    if (spec.deliver === 'file' && spec.fileFlag) {
      const promptDir = path.join(cwd, '.corral');
      fs.mkdirSync(promptDir, { recursive: true });
      const promptPath = path.join(promptDir, `prompt-${Date.now()}.txt`);
      fs.writeFileSync(promptPath, prompt, 'utf8');
      args.push(promptPath); // fileFlag は spec.args 末尾に含めてある
    }

    this.child = spawn(spec.command, args, {
      cwd,
      // Windows のみ shell（.cmd 解決）。argv にユーザー文字列が無いため注入は起きない
      shell: isWin,
      env: process.env,
    });

    this.child.stdout?.on('data', (b: Buffer) => this.emit('output', 'stdout', b.toString()));
    this.child.stderr?.on('data', (b: Buffer) => this.emit('output', 'stderr', b.toString()));
    this.child.on('error', (err) => {
      this.emit('output', 'stderr', `[起動エラー] ${err.message}\n`);
      this.emit('exit', 1);
    });
    this.child.on('exit', (code) => this.emit('exit', code));

    // deliver=stdin: プロンプトを標準入力へ流して閉じる（会話の1メッセージ）
    if (spec.deliver === 'stdin' && this.child.stdin) {
      this.child.stdin.write(prompt.endsWith('\n') ? prompt : prompt + '\n');
      this.child.stdin.end();
    }
  }

  stop(): void {
    this.child.kill();
  }
}

/** デモ用：worktree に実ファイルを書き、diff/変更数/commit が実体を持つ */
export class DemoRunner extends EventEmitter implements Runner {
  private timers: NodeJS.Timeout[] = [];
  private stopped = false;

  constructor(agent: AgentKind, prompt: string, isFollowup: boolean, cwd: string) {
    super();
    const label = getProfile(agent).label;
    const steps: Array<() => void> = [
      () => this.log(`${label} を worktree で起動しました。`),
      () => this.log(`${isFollowup ? '継続タスク' : 'タスク'}を解析中: 「${prompt}」`),
      () => {
        // 実ファイルを書き出す（差分が実体を持つ）
        try {
          fs.mkdirSync(cwd, { recursive: true });
          const n = fs.readdirSync(cwd).filter((f) => f.startsWith('demo_change_')).length + 1;
          const file = path.join(cwd, `demo_change_${n}.txt`);
          fs.writeFileSync(file, `# 変更 ${n}\n指示: ${prompt}\n生成時刻: ${new Date().toISOString()}\n`);
          this.log(`ファイル demo_change_${n}.txt を生成しました。`);
        } catch (e) {
          this.log(`ファイル生成に失敗: ${(e as Error).message}`);
        }
      },
      () => this.log('変更を適用しました。人間のレビューを待ちます。'),
    ];
    steps.forEach((fn, i) => {
      const t = setTimeout(() => {
        if (this.stopped) return;
        fn();
        if (i === steps.length - 1) this.emit('exit', 0);
      }, 600 * (i + 1));
      this.timers.push(t);
    });
  }

  private log(text: string): void {
    this.emit('output', 'stdout', text + '\n');
  }

  stop(): void {
    this.stopped = true;
    this.timers.forEach(clearTimeout);
    this.emit('exit', null);
  }
}

/** 1回の run を作る。isFollowup=true なら継続run（--continue / exec resume 等） */
/**
 * #18 サンドボックス実行: Docker コンテナ内でエージェントを起動。
 * --network none / メモリ・CPU 制限 / 非root / worktree のみマウント で隔離。
 * ※実走には Docker と image が必要（この環境では未実走。構成は本番同等）。
 */
export class DockerRunner extends ProcessRunner {
  constructor(spec: RunSpec, prompt: string, cwd: string) {
    const d = config.exec.docker;
    const dockerArgs = [
      'run',
      '--rm',
      '-i',
      '--network',
      d.network,
      '--memory',
      d.memory,
      '--cpus',
      d.cpus,
      '--user',
      '1000:1000',
      '-v',
      `${cwd}:/work`,
      '-w',
      '/work',
      d.image,
      spec.command,
      ...spec.args,
    ];
    super({ command: 'docker', args: dockerArgs, deliver: spec.deliver, fileFlag: spec.fileFlag }, prompt, cwd);
  }
}

/**
 * #5 クラウド/リモート実行: SSH 先でエージェントを起動（ノートPCを閉じても継続）。
 * ※実走には到達可能な CORRAL_SSH_HOST が必要（この環境では未実走）。
 */
export class SSHRunner extends ProcessRunner {
  constructor(spec: RunSpec, prompt: string, cwd: string) {
    const s = config.exec.ssh;
    const remoteCmd = [spec.command, ...spec.args].join(' ');
    super(
      { command: 'ssh', args: [s.host, `cd ${s.remoteRoot} && ${remoteCmd}`], deliver: spec.deliver, fileFlag: spec.fileFlag },
      prompt,
      cwd
    );
  }
}

export function createRunner(
  agent: AgentKind,
  prompt: string,
  autoAccept: boolean,
  cwd: string,
  isFollowup: boolean
): Runner {
  if (config.demo) return new DemoRunner(agent, prompt, isFollowup, cwd);
  const profile = getProfile(agent);
  const spec = isFollowup ? profile.buildFollowup(autoAccept) : profile.buildInitial(autoAccept);
  switch (config.exec.mode) {
    case 'docker':
      return new DockerRunner(spec, prompt, cwd);
    case 'ssh':
      return new SSHRunner(spec, prompt, cwd);
    default:
      return new ProcessRunner(spec, prompt, cwd);
  }
}
