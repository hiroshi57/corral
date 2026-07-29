// 提案書/マニュアル/議事録をドロップ → AIがタスク分解 → レビュー → 案件へ一括割り当て
import { useState } from 'react';
import type { AgentKind, Repo } from '../lib/types';
import { AGENT_LABEL } from '../lib/types';
import { extractText, decomposeToTasks } from '../lib/intake';
import { api } from '../lib/api';

const AGENTS: AgentKind[] = ['claude', 'codex', 'gemini', 'aider'];

interface Candidate {
  text: string;
  enabled: boolean;
}

export function DocumentIntake({
  onChanged,
  repos = [],
  canCreate = true,
}: {
  onChanged: () => void;
  repos?: Repo[];
  canCreate?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [docName, setDocName] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [agent, setAgent] = useState<AgentKind>('claude');
  const [repoId, setRepoId] = useState('');
  const [autoAccept, setAutoAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 3000);
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const texts: string[] = [];
      const names: string[] = [];
      for (const f of Array.from(files)) {
        const r = await extractText(f);
        if (r.ok && r.text.trim()) {
          texts.push(r.text);
          names.push(f.name);
        } else if (r.note) {
          flash(`${f.name}: ${r.note}`);
        }
      }
      if (!texts.length) return;
      setDocName(names.join(', '));
      const merged = texts.join('\n\n');
      // まず実エージェント(LLMプランナー)で分解 → 無ければヒューリスティックにフォールバック
      let tasks: string[] = [];
      try {
        tasks = (await api.planTasks(merged, agent)).tasks;
      } catch {
        /* fallback below */
      }
      if (!tasks.length) tasks = decomposeToTasks(merged);
      setCandidates(tasks.map((t) => ({ text: t, enabled: true })));
      if (repos.length && !repoId) setRepoId(repos[0].id);
      if (tasks.length === 0) flash('タスク候補を抽出できませんでした。内容をご確認ください。');
    } finally {
      setBusy(false);
    }
  };

  const dispatch = async () => {
    const chosen = candidates.filter((c) => c.enabled && c.text.trim());
    if (!chosen.length) return;
    setBusy(true);
    try {
      // 案件（現在のワークスペース）へ 1 タスク=1 ワーカーで一括割り当て
      for (const c of chosen) {
        await api.createSessions({
          agent,
          prompt: c.text,
          count: 1,
          autoAccept,
          repoId: repoId || undefined,
          title: c.text.slice(0, 40),
        });
      }
      flash(`${chosen.length} 件のタスクを案件へ割り当てました`);
      setCandidates([]);
      setDocName('');
      onChanged();
    } catch (e) {
      flash(`割り当て失敗: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const enabledCount = candidates.filter((c) => c.enabled).length;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-edge bg-panel2 p-4">
      <div className="flex items-center gap-2">
        <span className="text-lg">📎</span>
        <h2 className="font-bold">ドキュメントから割り当て</h2>
        <span className="text-xs text-slate-500">提案書・議事録・マニュアルをドロップ</span>
      </div>

      {/* ドロップゾーン */}
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (canCreate) handleFiles(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-6 text-center text-xs transition ${
          dragOver ? 'border-accent bg-accent/10' : 'border-edge text-slate-500 hover:border-accent/50'
        } ${!canCreate ? 'pointer-events-none opacity-40' : ''}`}
      >
        <span className="text-2xl">⬇️</span>
        <span>ここにファイルをドラッグ&ドロップ</span>
        <span className="text-[10px] text-slate-600">
          対応: .txt / .md / .csv / .json / .docx（PDFは今後対応）
        </span>
        <input
          type="file"
          multiple
          accept=".txt,.md,.markdown,.csv,.tsv,.json,.log,.yml,.yaml,.docx,text/*"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </label>

      {busy && candidates.length === 0 && <div className="text-xs text-slate-500">解析中…</div>}

      {/* 抽出タスクのレビュー */}
      {candidates.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="truncate">📄 {docName}</span>
            <span className="ml-auto text-accent">{enabledCount} / {candidates.length} 件</span>
          </div>
          <div className="max-h-56 overflow-auto rounded-lg border border-edge">
            {candidates.map((c, i) => (
              <div key={i} className="flex items-start gap-2 border-b border-edge/40 px-2 py-1.5 last:border-0">
                <input
                  type="checkbox"
                  checked={c.enabled}
                  onChange={(e) =>
                    setCandidates((prev) => prev.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))
                  }
                  className="mt-1"
                />
                <input
                  value={c.text}
                  onChange={(e) =>
                    setCandidates((prev) => prev.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                  }
                  className="flex-1 bg-transparent text-xs focus:outline-none"
                />
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select value={agent} onChange={(e) => setAgent(e.target.value as AgentKind)} className="rounded-lg border border-edge bg-panel px-2 py-1 text-sm">
              {AGENTS.map((a) => (
                <option key={a} value={a}>{AGENT_LABEL[a]}</option>
              ))}
            </select>
            {repos.length > 0 && (
              <select value={repoId} onChange={(e) => setRepoId(e.target.value)} className="rounded-lg border border-edge bg-panel px-2 py-1 text-sm">
                {repos.map((r) => (
                  <option key={r.id} value={r.id}>📁 {r.name}</option>
                ))}
              </select>
            )}
            <label className="flex cursor-pointer items-center gap-1 text-xs text-slate-400">
              <input type="checkbox" checked={autoAccept} onChange={(e) => setAutoAccept(e.target.checked)} />
              自動承認
            </label>
            <button
              onClick={dispatch}
              disabled={busy || enabledCount === 0 || !canCreate}
              className="ml-auto rounded-lg bg-accent px-4 py-1.5 text-sm font-bold text-black disabled:opacity-40"
            >
              ▶ {enabledCount} 件を案件へ割り当て
            </button>
          </div>
        </div>
      )}

      {msg && (
        <div className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent">{msg}</div>
      )}
    </div>
  );
}
