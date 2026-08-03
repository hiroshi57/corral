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
  /** AI が出したグラフの一時ID */
  ref?: number;
  /** 依存する ref 群（AI 生成の DAG） */
  deps?: number[];
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
  // グラフ・エンジニアリング: 直線でなく DAG として編成
  const [structure, setStructure] = useState<'ai' | 'parallel' | 'serial' | 'phased'>('ai');
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
      // ① AI にグラフ(依存付き)を直接出力させる → ② 平坦なタスク列 → ③ ヒューリスティック
      let cands: Candidate[] = [];
      try {
        const { nodes } = await api.planGraph(merged, agent);
        if (nodes.length) {
          cands = nodes.map((n) => ({ text: n.text, enabled: true, ref: n.ref, deps: n.deps }));
          flash(`AI が ${nodes.length} ノードの依存グラフを生成しました`);
        }
      } catch {
        /* fallthrough */
      }
      if (!cands.length) {
        let tasks: string[] = [];
        try {
          tasks = (await api.planTasks(merged, agent)).tasks;
        } catch {
          /* fallback below */
        }
        if (!tasks.length) tasks = decomposeToTasks(merged);
        cands = tasks.map((t) => ({ text: t, enabled: true }));
      }
      const tasks = cands.map((c) => c.text);
      setCandidates(cands);
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
      // グラフとして編成（parallel=独立 / serial=一直線 / phased=フェーズDAG）
      const create = async (text: string, dependsOn?: string[]) => {
        const created = await api.createSessions({
          agent,
          prompt: text,
          count: 1,
          autoAccept,
          repoId: repoId || undefined,
          title: text.slice(0, 40),
          dependsOn: dependsOn?.length ? dependsOn : undefined,
        });
        return created[0]?.id ?? null;
      };

      if (structure === 'ai' && chosen.some((c) => c.ref !== undefined)) {
        // AI が出した DAG をそのまま構築（ref → 実 session ID を解決しつつトポロジカル順に作成）
        const refToId = new Map<number, string>();
        const pending = [...chosen];
        let guard = 0;
        while (pending.length && guard++ < 200) {
          const idx = pending.findIndex((c) => (c.deps ?? []).every((d) => refToId.has(d) || !chosen.some((x) => x.ref === d)));
          const c = pending.splice(idx >= 0 ? idx : 0, 1)[0];
          const deps = (c.deps ?? []).map((d) => refToId.get(d)).filter((x): x is string => !!x);
          const id = await create(c.text, deps);
          if (id && c.ref !== undefined) refToId.set(c.ref, id);
        }
      } else if (structure === 'phased') {
        // 見出し接頭辞（"セクション: 内容" の先頭）でフェーズにグループ化。
        // 各フェーズは前フェーズの全タスク完了に依存（fan-in / fan-out の DAG）。
        const phases = new Map<string, string[]>();
        for (const c of chosen) {
          const key = c.text.includes(': ') ? c.text.split(': ')[0] : '__default__';
          (phases.get(key) ?? phases.set(key, []).get(key)!).push(c.text);
        }
        let prevIds: string[] = [];
        for (const [, texts] of phases) {
          const ids: string[] = [];
          for (const t of texts) {
            const id = await create(t, prevIds);
            if (id) ids.push(id);
          }
          prevIds = ids;
        }
      } else if (structure === 'serial') {
        let prev: string | null = null;
        for (const c of chosen) prev = await create(c.text, prev ? [prev] : undefined);
      } else {
        for (const c of chosen) await create(c.text);
      }
      const label =
        structure === 'ai'
          ? '（AI生成グラフ）'
          : structure === 'phased'
            ? '（段階DAG）'
            : structure === 'serial'
              ? '（直列）'
              : '';
      flash(`${chosen.length} 件のタスクを案件へ割り当てました${label}`);
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
          対応: .txt / .md / .csv / .json / .docx / .pptx / .pdf
        </span>
        <input
          type="file"
          multiple
          accept=".txt,.md,.markdown,.csv,.tsv,.json,.log,.yml,.yaml,.docx,.pptx,.pdf,text/*"
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
                {c.ref !== undefined && (
                  <span className="mt-0.5 shrink-0 font-mono text-[10px] text-slate-600" title="AI生成グラフのノード番号">
                    #{c.ref}
                  </span>
                )}
                <input
                  value={c.text}
                  onChange={(e) =>
                    setCandidates((prev) => prev.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                  }
                  className="flex-1 bg-transparent text-xs focus:outline-none"
                />
                {c.deps && c.deps.length > 0 && (
                  <span className="mt-0.5 shrink-0 text-[10px] text-accent" title="依存するノード">
                    ←{c.deps.join(',')}
                  </span>
                )}
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
            <label className="flex items-center gap-1 text-xs text-slate-400" title="グラフ・エンジニアリング: 直線でなく DAG として編成">
              構成
              <select
                value={structure}
                onChange={(e) => setStructure(e.target.value as typeof structure)}
                className="rounded-lg border border-edge bg-panel px-1.5 py-1 text-xs"
              >
                <option value="ai">AI生成グラフ（依存自動）</option>
                <option value="parallel">並列（独立）</option>
                <option value="serial">直列（順次）</option>
                <option value="phased">段階（フェーズDAG）</option>
              </select>
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
