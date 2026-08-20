// エージェント起動プロファイル
//
// 設計上の重要点:
//  - claude -p / codex exec は「ワンショットの非対話モード」。実行中の stdin に
//    追記しても会話は継続しない（OpenAI 公式 "Non-interactive mode" で確認済み）。
//    → 追加指示は stdin 注入ではなく「継続run」で反映する（buildFollowup）。
//  - ユーザーのプロンプト文字列は argv / シェルに一切載せない。stdin かファイルで渡す
//    ことでコマンドインジェクションを構造的に排除する（deliver フィールド）。
import type { AgentKind } from '../types.js';

export interface RunSpec {
  /** 実行コマンド（引数は静的フラグのみ。ユーザー文字列を含めない） */
  command: string;
  args: string[];
  /** プロンプトの渡し方 */
  deliver: 'stdin' | 'file';
  /** deliver=file のとき、ファイルパスを差し込むフラグ（例: --message-file） */
  fileFlag?: string;
}

export interface AgentProfile {
  kind: AgentKind;
  label: string;
  command: string;
  /** ネイティブに会話継続できるか（できない場合は文脈を結合して渡す） */
  nativeResume: boolean;
  /** 初回実行 */
  buildInitial: (autoAccept: boolean) => RunSpec;
  /** 継続実行（追加指示）。nativeResume=false のときは呼び出し側が文脈結合済み文を渡す */
  buildFollowup: (autoAccept: boolean) => RunSpec;
}

export const AGENT_PROFILES: Record<AgentKind, AgentProfile> = {
  claude: {
    kind: 'claude',
    label: 'Claude Code',
    command: 'claude',
    nativeResume: true, // claude -p --continue で直近会話を継続
    buildInitial: (autoAccept) => ({
      command: 'claude',
      args: ['-p', ...(autoAccept ? ['--permission-mode', 'acceptEdits'] : [])],
      deliver: 'stdin',
    }),
    buildFollowup: (autoAccept) => ({
      command: 'claude',
      args: ['-p', '--continue', ...(autoAccept ? ['--permission-mode', 'acceptEdits'] : [])],
      deliver: 'stdin',
    }),
  },
  codex: {
    kind: 'codex',
    label: 'Codex',
    command: 'codex',
    nativeResume: true, // codex exec resume --last で直近セッションを継続
    // --full-auto は非推奨（公式が warning を出す）。--sandbox workspace-write を使う
    buildInitial: (autoAccept) => ({
      command: 'codex',
      args: ['exec', ...(autoAccept ? ['--sandbox', 'workspace-write'] : [])],
      deliver: 'stdin',
    }),
    buildFollowup: (autoAccept) => ({
      command: 'codex',
      args: ['exec', 'resume', '--last', ...(autoAccept ? ['--sandbox', 'workspace-write'] : [])],
      deliver: 'stdin',
    }),
  },
  gemini: {
    kind: 'gemini',
    label: 'Gemini CLI',
    command: 'gemini',
    nativeResume: false, // 継続は文脈結合で対応
    buildInitial: () => ({ command: 'gemini', args: ['-p'], deliver: 'stdin' }),
    buildFollowup: () => ({ command: 'gemini', args: ['-p'], deliver: 'stdin' }),
  },
  aider: {
    kind: 'aider',
    label: 'Aider',
    command: 'aider',
    nativeResume: false, // メッセージ単位で実行。文脈は結合して渡す
    // プロンプトは --message-file でファイル経由（argv に載せない）
    buildInitial: (autoAccept) => ({
      command: 'aider',
      args: [...(autoAccept ? ['--yes-always'] : []), '--message-file'],
      deliver: 'file',
      fileFlag: '--message-file',
    }),
    buildFollowup: (autoAccept) => ({
      command: 'aider',
      args: [...(autoAccept ? ['--yes-always'] : []), '--message-file'],
      deliver: 'file',
      fileFlag: '--message-file',
    }),
  },
  custom: {
    kind: 'custom',
    label: 'カスタム',
    command: process.env.CORRAL_CUSTOM_CMD ?? 'cat',
    nativeResume: false,
    buildInitial: () => ({
      command: process.env.CORRAL_CUSTOM_CMD ?? 'cat',
      args: [],
      deliver: 'stdin',
    }),
    buildFollowup: () => ({
      command: process.env.CORRAL_CUSTOM_CMD ?? 'cat',
      args: [],
      deliver: 'stdin',
    }),
  },
};

/**
 * エージェントごとのモデル指定（任意）。
 * 例: CORRAL_CODEX_MODEL=gpt-5.1  CORRAL_CLAUDE_MODEL=sonnet
 * 既定モデルがアカウント種別で使えない場合に、設定だけで切り替えられるようにする。
 */
const MODEL_ENV: Partial<Record<AgentKind, { env: string; flag: string }>> = {
  claude: { env: 'CORRAL_CLAUDE_MODEL', flag: '--model' },
  codex: { env: 'CORRAL_CODEX_MODEL', flag: '-m' },
  gemini: { env: 'CORRAL_GEMINI_MODEL', flag: '-m' },
};

/** モデル指定があれば引数に足す（コマンド直後に置く） */
function withModel(kind: AgentKind, args: string[]): string[] {
  const m = MODEL_ENV[kind];
  const value = m ? process.env[m.env] : undefined;
  if (!m || !value) return args;
  // codex は `exec` などのサブコマンドの後にフラグを置く必要があるため末尾寄りに挿入
  return [...args, m.flag, value];
}

export function getProfile(kind: AgentKind): AgentProfile {
  const base = AGENT_PROFILES[kind] ?? AGENT_PROFILES.custom;
  // モデル指定を反映したプロファイルを返す
  return {
    ...base,
    buildInitial: (autoAccept) => {
      const spec = base.buildInitial(autoAccept);
      return { ...spec, args: withModel(base.kind, spec.args) };
    },
    buildFollowup: (autoAccept) => {
      const spec = base.buildFollowup(autoAccept);
      return { ...spec, args: withModel(base.kind, spec.args) };
    },
  };
}
