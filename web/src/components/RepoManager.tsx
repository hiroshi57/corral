// 案件の「対象フォルダ」管理
// コードのリポジトリでも、提案書・議事録などの資料フォルダでも登録できる。
// これにより「案件を作る → 対象フォルダを指定 → 指示を出す」が画面内で完結する。
import { useState } from 'react';
import type { Repo } from '../lib/types';
import { api } from '../lib/api';

export function RepoManager({
  repos,
  onChanged,
  canManage = true,
}: {
  repos: Repo[];
  onChanged: () => void;
  canManage?: boolean;
}) {
  const [open, setOpen] = useState(repos.length === 0);
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const add = async () => {
    if (!path.trim()) return;
    setBusy(true);
    setMsg('');
    try {
      // 名前を省略したらフォルダ名を使う
      const guessed =
        name.trim() || path.trim().replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'フォルダ';
      await api.createRepo(guessed, path.trim());
      setName('');
      setPath('');
      setMsg('追加しました。司令塔の「📁」から選べます。');
      onChanged();
    } catch (e) {
      setMsg(`追加に失敗しました: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-edge bg-panel2 p-4">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
        <span className="text-lg">📁</span>
        <h2 className="font-bold">対象フォルダ</h2>
        <span className="text-xs text-slate-500">
          {repos.length > 0 ? `${repos.length} 件` : '未設定'}
        </span>
        <span className="ml-auto text-xs text-slate-500">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {repos.length === 0 && (
            <div className="rounded-lg border border-dashed border-edge px-3 py-2 text-[11px] text-slate-500">
              この案件の作業対象がまだありません。下の欄にフォルダのパスを入れて追加してください。
              <br />
              プログラムのリポジトリでも、提案書・議事録などの<b>資料フォルダ</b>でも構いません。
            </div>
          )}

          {repos.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-lg border border-edge bg-panel px-2.5 py-1.5">
              <span className="shrink-0 text-xs">📂</span>
              <span className="flex-1 truncate">
                <span className="block text-xs font-medium text-slate-200">{r.name}</span>
                <span className="block truncate font-mono text-[10px] text-slate-500" title={r.path}>
                  {r.path}
                </span>
              </span>
            </div>
          ))}

          {canManage && (
            <div className="flex flex-col gap-1.5 border-t border-edge pt-2">
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && add()}
                placeholder="例: C:\Users\...\Documents\LLMO提案_A社"
                className="rounded-lg border border-edge bg-panel px-2 py-1.5 font-mono text-[11px] focus:border-accent focus:outline-none"
              />
              <div className="flex gap-1.5">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && add()}
                  placeholder="表示名（省略可）"
                  className="flex-1 rounded-lg border border-edge bg-panel px-2 py-1 text-[11px] focus:border-accent focus:outline-none"
                />
                <button
                  onClick={add}
                  disabled={busy || !path.trim()}
                  className="rounded-lg bg-accent px-3 py-1 text-[11px] font-bold text-black disabled:opacity-40"
                >
                  ＋ 追加
                </button>
              </div>
              <div className="text-[10px] leading-relaxed text-slate-600">
                ※ 変更履歴の管理がないフォルダは、初回に自動で用意します（元のファイルは承認するまで変更されません）。
              </div>
            </div>
          )}

          {msg && <div className="text-[11px] text-accent">{msg}</div>}
        </div>
      )}
    </div>
  );
}
