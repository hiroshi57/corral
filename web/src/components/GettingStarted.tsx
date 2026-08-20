// はじめに：何をどう使うのかを、その場で体験できる手引き
// 「機能は分かるが使い方が分からない」を解消するための導線。
import { useState } from 'react';
import type { AgentKind, Repo } from '../lib/types';
import { api } from '../lib/api';

type Example = { label: string; prompt: string; note: string };

/** 案件の種類ごとの「そのまま使える指示」例（クリックで実行） */
const EXAMPLES: Record<'code' | 'docs', Example[]> = {
  // プログラムのリポジトリを対象にした案件
  code: [
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
  ],
  // 提案書・議事録・レポートなど「コードでない案件」
  docs: [
    {
      label: '資料を棚卸ししてもらう',
      prompt:
        'このフォルダにある資料をすべて読み、どんな資料が何のためにあるのかを一覧にして 資料一覧.md にまとめてください。',
      note: '安全（新規ファイルを1つ作るだけ）',
    },
    {
      label: '議事録から次アクションを出してもらう',
      prompt:
        '議事録（または打合せメモ）を読み、決定事項と課題を踏まえた「次アクション一覧」を 次アクション.md として作成してください。担当と期限の欄も用意してください。',
      note: '安全（新規ファイルを1つ作るだけ）',
    },
    {
      label: '提案書のたたき台を作ってもらう',
      prompt:
        'このフォルダの資料をもとに、顧客提案の骨子（課題・打ち手・期待効果・進め方・概算費用）を 提案骨子.md として作成してください。',
      note: '安全（新規ファイルを1つ作るだけ）',
    },
  ],
};

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
  const [kind, setKind] = useState<'code' | 'docs'>('code');
  const list = EXAMPLES[kind];

  const runExample = async (i: number) => {
    setBusy(i);
    setMsg('');
    try {
      await api.createSessions({
        agent: 'claude' as AgentKind,
        prompt: list[i].prompt,
        count: 1,
        repoId: repos[0]?.id,
        title: list[i].label,
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
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[11px] font-bold text-slate-300">まずは1つ試してみる</span>
          {/* 案件の種類でサンプルを切り替え（コードでない案件にも対応） */}
          <div className="ml-auto flex gap-0.5 rounded-lg border border-edge bg-panel2 p-0.5">
            <button
              onClick={() => setKind('code')}
              className={`rounded px-2 py-0.5 text-[10px] ${kind === 'code' ? 'bg-accent font-bold text-black' : 'text-slate-400'}`}
            >
              プログラム
            </button>
            <button
              onClick={() => setKind('docs')}
              className={`rounded px-2 py-0.5 text-[10px] ${kind === 'docs' ? 'bg-accent font-bold text-black' : 'text-slate-400'}`}
            >
              資料・ドキュメント
            </button>
          </div>
        </div>
        {kind === 'docs' && (
          <div className="mb-1.5 rounded bg-panel2 px-2 py-1 text-[10px] leading-relaxed text-slate-400">
            提案書・議事録・レポートなどの<b>資料フォルダも案件にできます</b>。
            <code className="mx-1 rounded bg-black/30 px-1">corral.config.cmd</code> の
            <code className="mx-1 rounded bg-black/30 px-1">CORRAL_REPO</code>
            に資料フォルダを指定してください（初回に変更履歴の管理を自動で用意します）。
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          {list.map((ex, i) => (
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
