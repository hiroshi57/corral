// #2 プレイブック: グラフ(DAG)テンプレの保存・再利用
import { useEffect, useState } from 'react';
import type { Playbook, Repo } from '../lib/types';
import { api } from '../lib/api';

export function Playbooks({
  onChanged,
  repos = [],
  hasSessions,
  canCreate = true,
}: {
  onChanged: () => void;
  repos?: Repo[];
  hasSessions: boolean;
  canCreate?: boolean;
}) {
  const [items, setItems] = useState<Playbook[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [autoAccept, setAutoAccept] = useState(false);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(''), 3000);
  };
  const refresh = () => api.listPlaybooks().then(setItems).catch(() => setItems([]));

  useEffect(() => {
    refresh();
  }, []); // eslint-disable-line

  const run = async (pb: Playbook) => {
    setBusy(pb.id);
    try {
      const created = await api.runPlaybook(pb.id, {
        repoId: repos[0]?.id,
        autoAccept,
      });
      flash(`「${pb.name}」を展開し ${created.length} タスクを起動しました`);
      onChanged();
    } catch (e) {
      flash(`実行失敗: ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  };

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.savePlaybook(name.trim());
      setName('');
      flash('現在のグラフをプレイブックとして保存しました');
      refresh();
    } catch (e) {
      flash(`保存失敗: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const del = async (pb: Playbook) => {
    await api.deletePlaybook(pb.id);
    refresh();
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-edge bg-panel2 p-4">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 text-left">
        <span className="text-lg">📚</span>
        <h2 className="font-bold">プレイブック</h2>
        <span className="text-xs text-slate-500">グラフのテンプレを再利用</span>
        <span className="ml-auto text-xs text-slate-500">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <>
          <div className="flex flex-col gap-1.5">
            {items.map((pb) => (
              <div key={pb.id} className="rounded-lg border border-edge bg-panel p-2">
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-xs font-medium" title={pb.description}>
                    {pb.builtin && <span className="mr-1 text-[10px] text-slate-500">標準</span>}
                    {pb.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-500">{pb.nodes.length}ノード</span>
                  <button
                    onClick={() => run(pb)}
                    disabled={!canCreate || busy === pb.id}
                    className="shrink-0 rounded bg-accent px-2 py-0.5 text-[11px] font-bold text-black disabled:opacity-40"
                  >
                    {busy === pb.id ? '…' : '▶ 展開'}
                  </button>
                  {!pb.builtin && (
                    <button onClick={() => del(pb)} className="shrink-0 text-[11px] text-slate-500 hover:text-rose-300">
                      🗑
                    </button>
                  )}
                </div>
                {pb.description && (
                  <div className="mt-0.5 truncate text-[10px] text-slate-500">{pb.description}</div>
                )}
              </div>
            ))}
          </div>

          <label className="flex cursor-pointer items-center gap-1 text-xs text-slate-400">
            <input type="checkbox" checked={autoAccept} onChange={(e) => setAutoAccept(e.target.checked)} />
            展開時に自動承認
          </label>

          {/* 現在のグラフを保存 */}
          {hasSessions && canCreate && (
            <div className="flex gap-2 border-t border-edge pt-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()}
                placeholder="現在のグラフをテンプレ保存（名前）"
                className="flex-1 rounded-lg border border-edge bg-panel px-2 py-1 text-xs focus:border-accent focus:outline-none"
              />
              <button
                onClick={save}
                disabled={saving || !name.trim()}
                className="rounded-lg border border-edge bg-panel px-2 py-1 text-xs hover:border-accent disabled:opacity-40"
              >
                💾 保存
              </button>
            </div>
          )}

          {msg && <div className="rounded-lg border border-accent/30 bg-accent/10 px-2 py-1.5 text-[11px] text-accent">{msg}</div>}
        </>
      )}
    </div>
  );
}
