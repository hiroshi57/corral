// #2 プレイブック: グラフ(DAG)テンプレートの保存・再利用
// 既存セッション群から「形」を抽出して保存し、別案件で再展開できる。
import { nanoid } from 'nanoid';
import type { Playbook, PlaybookNode, Session } from '../types.js';

/** 既定プリセット（すぐ使える標準ワークフロー） */
const BUILTIN: Playbook[] = [
  {
    id: 'pb-feature',
    name: '新機能開発（調査→設計→実装→テスト）',
    description: '調査と設計を並列で行い、実装で合流、最後にテストとドキュメント',
    workspaceId: null,
    builtin: true,
    createdAt: 0,
    nodes: [
      { ref: 1, text: '既存コードと関連仕様を調査し、影響範囲をまとめる', deps: [] },
      { ref: 2, text: 'データ構造とAPIインターフェースを設計する', deps: [] },
      { ref: 3, text: '設計に基づいて機能を実装する', deps: [1, 2] },
      { ref: 4, text: 'ユニットテストと結合テストを追加する', deps: [3] },
      { ref: 5, text: 'README とドキュメントを更新する', deps: [3] },
    ],
  },
  {
    id: 'pb-bugfix',
    name: 'バグ修正（再現→原因→修正→回帰テスト）',
    description: '再現手順の確立から回帰テストまで。修正失敗時のリカバリ経路つき',
    workspaceId: null,
    builtin: true,
    createdAt: 0,
    nodes: [
      { ref: 1, text: 'バグを再現する最小手順とテストを作成する', deps: [] },
      { ref: 2, text: '原因を特定し、根本原因を説明する', deps: [1] },
      { ref: 3, text: '原因に対する修正を実装する', deps: [2] },
      { ref: 4, text: '回帰テストを追加し、既存テストが通ることを確認する', deps: [3] },
      { ref: 5, text: '修正が失敗した場合、別アプローチを検討して再試行する', deps: [3], condition: 'failure' },
    ],
  },
  {
    id: 'pb-refactor',
    name: 'リファクタリング（棚卸し→分割実施→検証）',
    description: '対象の棚卸し後、複数箇所を並列で改善し、最後に検証で合流',
    workspaceId: null,
    builtin: true,
    createdAt: 0,
    nodes: [
      { ref: 1, text: 'リファクタリング対象を棚卸しし、優先順位をつける', deps: [] },
      { ref: 2, text: '重複コードを共通化する', deps: [1] },
      { ref: 3, text: '命名と型定義を整理する', deps: [1] },
      { ref: 4, text: '全体のテストを実行し、挙動が変わらないことを検証する', deps: [2, 3] },
    ],
  },
];

class PlaybookStore {
  private items = new Map<string, Playbook>();

  constructor() {
    for (const p of BUILTIN) this.items.set(p.id, p);
  }

  /** 案件で使えるプレイブック（共有プリセット + その案件のもの） */
  listFor(workspaceId: string): Playbook[] {
    return [...this.items.values()]
      .filter((p) => p.workspaceId === null || p.workspaceId === workspaceId)
      .sort((a, b) => (a.builtin ? -1 : 1) - (b.builtin ? -1 : 1) || b.createdAt - a.createdAt);
  }

  get(id: string): Playbook | undefined {
    return this.items.get(id);
  }

  create(input: {
    name: string;
    description?: string;
    workspaceId: string;
    nodes: PlaybookNode[];
  }): Playbook {
    const pb: Playbook = {
      id: nanoid(8),
      name: input.name,
      description: input.description,
      workspaceId: input.workspaceId,
      nodes: input.nodes,
      createdAt: Date.now(),
    };
    this.items.set(pb.id, pb);
    return pb;
  }

  remove(id: string): boolean {
    const p = this.items.get(id);
    if (!p || p.builtin) return false; // プリセットは削除不可
    return this.items.delete(id);
  }

  /**
   * 既存セッション群からグラフの「形」を抽出してプレイブック化する。
   * session ID → 連番 ref に変換し、依存関係と条件・エージェントを保持。
   */
  captureFromSessions(
    name: string,
    description: string | undefined,
    workspaceId: string,
    sessions: Session[]
  ): Playbook {
    const idToRef = new Map<string, number>();
    sessions.forEach((s, i) => idToRef.set(s.id, i + 1));
    const nodes: PlaybookNode[] = sessions.map((s) => ({
      ref: idToRef.get(s.id)!,
      // タイトルよりも実際の指示（初回プロンプト）を採用
      text: s.turns[0] ?? s.prompt,
      deps: s.dependsOn.map((d) => idToRef.get(d)).filter((x): x is number => x !== undefined),
      agent: s.agent,
      condition: s.dependsCondition,
    }));
    return this.create({ name, description, workspaceId, nodes });
  }
}

export const playbooks = new PlaybookStore();
