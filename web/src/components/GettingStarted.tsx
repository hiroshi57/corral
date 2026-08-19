// はじめに：何をどう使うのかを、その場で体験できる手引き
// 「機能は分かるが使い方が分からない」を解消するための導線。
import { useState } from 'react';
import type { AgentKind, Repo } from '../lib/types';
import { api } from '../lib/api';

/** そのまま使える指示の例（クリックでサンプル実行） */
const EXAMPLES: Array<{ label: string; prompt: string; note: string }> = [
  {
    label: 'コードを調べてもらう',
    prompt:
      'このリポジトリの構成を調べ、主要なディレクトリとその役割を docs/repo-overview.md にまとめてください。',
    note: '安全（新規ファイルを1つ作るだけ）',
  },
  {
    label: '改善点を出してもらう',
    prompt:
      'README.md を読み、改善したほうがよい点を3つ挙げて docs/review-notes.md に書き出してください。既存ファイルは変更しないでください。',
    note: '安全（新規ファイルを1つ作るだけ）',
  },
  {
    label: 'テストを追加してもらう',
    prompt:
      'テストが不足している箇所を1つ選び、テストを追加してください。既存の挙動は変えないでください。',
    note: '実コードに変更が入ります（承認前に差分を確認できます）',
  },
];

export function GettingStarted({
  repos = [],
  onChanged,
  onClose,
  canCreate = true,
  isDemo,
}: {
  repos?: Repo[];
  onChanged: () => void;
  onClose: () => void;
  canCreate?: boolean;
  isDemo: boolean;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState('');

  const runExample = async (i: number) => {
    setBusy(i);
    setMsg('');
    try {
      await api.createSessions({
        agent: 'claude' as AgentKind,
        prompt: EXAMPLES[i].prompt,
        count: 1,
        repoId: repos[0]?.id,
        title: EXAMPLES[i].label,
      });
      setMsg('起動しました。下の「ワーカー」に現れます。完了したら差分を確認して承認してください。');
      onChanged();
    } catch (e) {
      setMsg(`起動に失敗しました: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-lg">🚀</span>
        <h2 className="font-bold text-accent">はじめに — 3ステップで使えます</h2>
        <button onClick={onClose} className="ml-auto text-xs text-slate-500 hover:text-slate-300">
          閉じる
        </button>
      </div>

      <ol className="mb-3 space-y-1.5 text-xs leading-relaxed text-slate-300">
        <li>
          <span className="mr-1 font-bold text-accent">①</span>
          <b>指示を出す</b> … 上の「司令塔」に日本語でやってほしいことを書いて「▶ 起動」。
          <span className="text-slate-500">（提案書・議事録をドロップしてもタスクに分解できます）</span>
        </li>
        <li>
          <span className="mr-1 font-bold text-accent">②</span>
          <b>待つ</b> … エージェントが専用の作業コピー（git worktree）で作業します。あなたの作業中のコードは汚れません。
        </li>
        <li>
          <span className="mr-1 font-bold text-accent">③</span>
          <b>差分を見て承認</b> … 「差分」タブで変更を確認し「✓ 承認して commit」。直したい所は行をクリックして指摘（差し戻し）。
        </li>
      </ol>

      {/* まず1つ試す */}
      <div className="rounded-lg border border-edge bg-panel p-2.5">
        <div className="mb-1.5 text-[11px] font-bold text-slate-300">
          まずは1つ試してみる（クリックで実行）
        </div>
        <div className="flex flex-col gap-1.5">
          {EXAMPLES.map((ex, i) => (
            <button
              key={i}
              onClick={() => runExample(i)}
              disabled={!canCreate || busy !== null}
              className="flex items-start gap-2 rounded-lg border border-edge bg-panel2 px-2.5 py-2 text-left hover:border-accent disabled:opacity-50"
            >
              <span className="mt-0.5 text-xs">{busy === i ? '⏳' : '▶'}</span>
              <span className="flex-1">
                <span className="block text-xs font-medium text-slate-200">{ex.label}</span>
                <span className="block text-[10px] text-slate-500">{ex.prompt.slice(0, 56)}…</span>
                <span className="mt-0.5 block text-[10px] text-slate-600">{ex.note}</span>
              </span>
            </button>
          ))}
        </div>
        {isDemo && (
          <div className="mt-2 text-[10px] text-amber-300/90">
            ※ 今は DEMO モードのため、実行は疑似的なものです（実際のファイルは変更されません）。
          </div>
        )}
        {msg && <div className="mt-2 text-[11px] text-accent">{msg}</div>}
      </div>

      {/* 画面の説明 */}
      <details className="mt-3 text-[11px] text-slate-400">
        <summary className="cursor-pointer text-slate-300">各画面の役割（クリックで開く）</summary>
        <ul className="mt-1.5 space-y-1 pl-4">
          <li>
            <b>🎯 司令塔</b> … 指示を出す・ワーカーの状態を見る・差分を承認する（メイン画面）
          </li>
          <li>
            <b>🕸 グラフ</b> … タスクの依存関係を図で確認・編集（「これが終わったら次」を線でつなぐ）
          </li>
          <li>
            <b>📊 ダッシュボード</b> … 完了率・所要時間・コスト・将来予測などの集計
          </li>
          <li>
            <b>👥 メンバー</b> … 案件に人を招待して権限（閲覧のみ等）を設定
          </li>
          <li>
            <b>📋 監査</b> … 誰がいつ何をしたかの記録（エクスポート可）
          </li>
        </ul>
        <div className="mt-2 pl-4">
          <b>案件（ヘッダの選択）</b> … 仕事の単位。タスク・コスト・記録は案件ごとに分かれます。
          「＋案件」で新しい案件を作れます。
        </div>
      </details>
    </div>
  );
}
