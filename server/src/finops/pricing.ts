// ② FinOps: エージェント別のトークン単価とコスト計算
//
// 注意: 実際の課金はモデル/契約で変わる。ここは概算用の既定値で、
// 環境変数や設定で上書きできる前提の「参考単価」。1M トークンあたり USD。
import type { AgentKind, Usage } from '../types.js';

export interface TokenPrice {
  inputPerM: number; // 入力 100万トークンあたり USD
  outputPerM: number; // 出力 100万トークンあたり USD
}

/** エージェント別 参考単価（概算・上書き可能） */
export const DEFAULT_PRICING: Record<AgentKind, TokenPrice> = {
  claude: { inputPerM: 3, outputPerM: 15 }, // Claude 系の概算
  codex: { inputPerM: 2.5, outputPerM: 10 }, // Codex/GPT 系の概算
  gemini: { inputPerM: 1.25, outputPerM: 5 },
  aider: { inputPerM: 2.5, outputPerM: 10 },
  custom: { inputPerM: 0, outputPerM: 0 },
};

export function costOf(agent: AgentKind, inputTokens: number, outputTokens: number): number {
  const p = DEFAULT_PRICING[agent] ?? DEFAULT_PRICING.custom;
  return (inputTokens / 1_000_000) * p.inputPerM + (outputTokens / 1_000_000) * p.outputPerM;
}

/** 空の使用量 */
export function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, costUsd: 0, runs: 0 };
}

/**
 * 1回の run の使用量を推定して加算する。
 * - DEMO: 実トークンが無いので妥当な範囲で合成
 * - 本番: エージェント出力からのパースは仕様依存で不安定なため、
 *   出力バイト数からの概算（4B≒1token 近似）をフォールバックに使う。
 */
export function accrueRun(
  usage: Usage,
  agent: AgentKind,
  opts: { demo: boolean; outputChars?: number }
): Usage {
  let inTok: number;
  let outTok: number;
  if (opts.demo) {
    inTok = 1500 + Math.floor(Math.random() * 4000);
    outTok = 800 + Math.floor(Math.random() * 3000);
  } else {
    // 概算: 出力文字数 / 4 を出力トークン、入力はその 1.5 倍と仮定
    outTok = Math.max(1, Math.round((opts.outputChars ?? 0) / 4));
    inTok = Math.round(outTok * 1.5);
  }
  const next: Usage = {
    inputTokens: usage.inputTokens + inTok,
    outputTokens: usage.outputTokens + outTok,
    costUsd: usage.costUsd + costOf(agent, inTok, outTok),
    runs: usage.runs + 1,
  };
  return next;
}
