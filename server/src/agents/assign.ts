// ② エージェント別ノード自動割当
// タスク内容の性質（調査/設計/実装/テスト/ドキュメント等）と、
// 実際にインストールされているエージェント（自動検出）から最適な担当を選ぶ。
import { detectAgents } from './detect.js';
import type { AgentKind } from '../types.js';

/** タスクの性質 */
type Kind = 'research' | 'design' | 'implement' | 'test' | 'docs' | 'review' | 'general';

const RULES: Array<{ kind: Kind; words: string[] }> = [
  { kind: 'research', words: ['調査', '分析', '棚卸', '把握', '影響範囲', '原因', '特定', '再現', 'リサーチ'] },
  { kind: 'design', words: ['設計', '定義', '仕様', '構成', '方針', 'アーキ', 'インターフェース', '計画'] },
  { kind: 'test', words: ['テスト', '検証', '回帰', 'E2E', 'ユニット', '品質', 'lint', 'CI'] },
  { kind: 'docs', words: ['ドキュメント', 'README', '手順', 'マニュアル', '説明', '記載', '共有', '報告'] },
  { kind: 'review', words: ['レビュー', '指摘', '確認', '点検', '監査'] },
  { kind: 'implement', words: ['実装', '修正', '追加', '作成', '対応', '改善', '構築', '移行', '削除', '最適化'] },
];

/** 性質ごとの優先エージェント（上から順に、利用可能なものを採用） */
const PREFERENCE: Record<Kind, AgentKind[]> = {
  research: ['claude', 'gemini', 'codex', 'aider'],
  design: ['claude', 'codex', 'gemini', 'aider'],
  implement: ['codex', 'claude', 'aider', 'gemini'],
  test: ['codex', 'claude', 'aider', 'gemini'],
  docs: ['gemini', 'claude', 'codex', 'aider'],
  review: ['claude', 'codex', 'gemini', 'aider'],
  general: ['claude', 'codex', 'gemini', 'aider'],
};

export function classify(text: string): Kind {
  for (const r of RULES) if (r.words.some((w) => text.includes(w))) return r.kind;
  return 'general';
}

/**
 * タスク文から担当エージェントを決める。
 * @param fallback 明示指定があればそれを尊重（自動割当しない）
 */
export async function assignAgent(text: string, fallback?: AgentKind): Promise<AgentKind> {
  if (fallback) return fallback;
  const detected = await detectAgents();
  const available = new Set(detected.filter((d) => d.available).map((d) => d.kind));
  const kind = classify(text);
  for (const cand of PREFERENCE[kind]) if (available.has(cand)) return cand;
  // 何も検出できない場合は claude（既定）
  return 'claude';
}

export const KIND_LABEL: Record<Kind, string> = {
  research: '調査',
  design: '設計',
  implement: '実装',
  test: 'テスト',
  docs: 'ドキュメント',
  review: 'レビュー',
  general: '一般',
};
