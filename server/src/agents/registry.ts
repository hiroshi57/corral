// エージェント起動プロファイル（Claude Squad / Vibe Kanban のプロファイル思想）
import type { AgentKind } from '../types.js';

export interface AgentProfile {
  kind: AgentKind;
  label: string;
  /** 実行コマンド */
  command: string;
  /**
   * 引数を組み立てる。
   * @param prompt ユーザーのタスク文
   * @param autoAccept 自動承認（yolo）モードか
   */
  buildArgs: (prompt: string, autoAccept: boolean) => string[];
}

/**
 * 各エージェントの CLI 呼び出し方。
 * ※コマンド仕様はバージョンで変わりうるため、上書き可能にしてある。
 */
export const AGENT_PROFILES: Record<AgentKind, AgentProfile> = {
  claude: {
    kind: 'claude',
    label: 'Claude Code',
    command: 'claude',
    buildArgs: (prompt, autoAccept) => {
      const args = ['-p', prompt];
      if (autoAccept) args.push('--permission-mode', 'acceptEdits');
      return args;
    },
  },
  codex: {
    kind: 'codex',
    label: 'Codex',
    command: 'codex',
    buildArgs: (prompt, autoAccept) => {
      const args = ['exec', prompt];
      if (autoAccept) args.push('--full-auto');
      return args;
    },
  },
  gemini: {
    kind: 'gemini',
    label: 'Gemini CLI',
    command: 'gemini',
    buildArgs: (prompt) => ['-p', prompt],
  },
  aider: {
    kind: 'aider',
    label: 'Aider',
    command: 'aider',
    buildArgs: (prompt, autoAccept) => {
      const args = ['--message', prompt];
      if (autoAccept) args.push('--yes-always');
      return args;
    },
  },
  custom: {
    kind: 'custom',
    label: 'カスタム',
    command: process.env.CORRAL_CUSTOM_CMD ?? 'echo',
    buildArgs: (prompt) => [prompt],
  },
};

export function getProfile(kind: AgentKind): AgentProfile {
  return AGENT_PROFILES[kind] ?? AGENT_PROFILES.custom;
}
