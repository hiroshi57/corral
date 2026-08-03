// 🕸 タスクグラフ（グラフ・エンジニアリング）+ GUIエディタ
// - nodes = セッション / edges = dependsOn（DAG）
// - 編集モード: ノードをドラッグで配置、ポートをドラッグで配線、エッジ条件(成功/失敗/どちらでも)を切替
import { useMemo, useRef, useState } from 'react';
import type { SessionSummary, SessionStatus } from '../lib/types';
import { AGENT_LABEL, STATUS_META } from '../lib/types';
import { api } from '../lib/api';

const NODE_W = 190;
const NODE_H = 54;
const COL_GAP = 90;
const ROW_GAP = 22;
const PAD = 24;

const STATUS_FILL: Record<SessionStatus, string> = {
  queued: '#1e2733',
  running: '#0c4a6e',
  needs_review: '#78350f',
  done: '#064e3b',
  error: '#7f1d1d',
  stopped: '#334155',
};
const STATUS_STROKE: Record<SessionStatus, string> = {
  queued: '#94a3b8',
  running: '#38bdf8',
  needs_review: '#fbbf24',
  done: '#34d399',
  error: '#f43f5e',
  stopped: '#64748b',
};
const COND_COLOR = { success: '#34d399', failure: '#f43f5e', any: '#94a3b8' } as const;
const COND_LABEL = { success: '成功時', failure: '失敗時', any: 'どちらでも' } as const;

type Cond = 'success' | 'failure' | 'any';

export function TaskGraph({
  sessions,
  selected,
  onSelect,
  onChanged,
  canEdit = true,
}: {
  sessions: SessionSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
  onChanged?: () => void;
  canEdit?: boolean;
}) {
  const [edit, setEdit] = useState(false);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [wire, setWire] = useState<{ from: string; x: number; y: number } | null>(null);
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});
  const svgRef = useRef<SVGSVGElement>(null);

  const auto = useMemo(() => computeLayout(sessions), [sessions]);
  // 手動座標（graphPos or ドラッグ中）を優先
  const at = (id: string) =>
    pos[id] ?? sessions.find((s) => s.id === id)?.graphPos ?? auto.pos[id] ?? { x: 0, y: 0 };

  const toLocal = (e: React.MouseEvent) => {
    const r = svgRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const p = toLocal(e);
    if (drag) setPos((prev) => ({ ...prev, [drag.id]: { x: p.x - drag.dx, y: p.y - drag.dy } }));
    else if (wire) setWire({ ...wire, x: p.x, y: p.y });
  };

  const endDrag = async () => {
    if (drag) {
      const p = pos[drag.id];
      setDrag(null);
      if (p) await api.updateGraph(drag.id, { graphPos: p }).catch(() => {});
    }
    setWire(null);
  };

  /** ポートから別ノードへドロップ = 依存エッジを追加 */
  const dropOnNode = async (targetId: string) => {
    if (!wire || wire.from === targetId) return setWire(null);
    const target = sessions.find((s) => s.id === targetId);
    if (!target) return setWire(null);
    const next = [...new Set([...(target.dependsOn ?? []), wire.from])];
    setWire(null);
    await api.updateGraph(targetId, { dependsOn: next }).catch(() => {});
    onChanged?.();
  };

  const removeEdge = async (from: string, to: string) => {
    const t = sessions.find((s) => s.id === to);
    if (!t) return;
    await api.updateGraph(to, { dependsOn: (t.dependsOn ?? []).filter((d) => d !== from) });
    onChanged?.();
  };

  const cycleCondition = async (to: string, cur: Cond) => {
    const order: Cond[] = ['success', 'failure', 'any'];
    const next = order[(order.indexOf(cur) + 1) % order.length];
    await api.updateGraph(to, { dependsCondition: next });
    onChanged?.();
  };

  if (sessions.length === 0) {
    return (
      <div className="grid flex-1 place-items-center text-sm text-slate-600">
        この案件にタスクがありません。ドキュメント割り当ての「構成」で AI にグラフを組ませることもできます。
      </div>
    );
  }

  const width = Math.max(auto.width, ...sessions.map((s) => at(s.id).x + NODE_W + PAD));
  const height = Math.max(auto.height, ...sessions.map((s) => at(s.id).y + NODE_H + PAD));

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-edge bg-panel2">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2 text-xs text-slate-400">
        <span className="text-sm font-bold text-slate-200">タスクグラフ</span>
        <span>{edit ? 'ノードをドラッグで移動／右の●から他ノードへドラッグで依存を追加' : '依存関係（DAG）。← 左が先、右が後続'}</span>
        {canEdit && (
          <button
            onClick={() => setEdit((v) => !v)}
            className={`ml-2 rounded-lg px-2 py-1 text-xs ${edit ? 'bg-accent font-bold text-black' : 'border border-edge bg-panel hover:border-accent'}`}
          >
            {edit ? '✓ 編集中' : '✎ 編集'}
          </button>
        )}
        <span className="ml-auto">{sessions.length} ノード / {auto.edges.length} エッジ</span>
      </div>

      <div className="flex-1 overflow-auto">
        <svg
          ref={svgRef}
          width={width}
          height={height}
          className="block"
          onMouseMove={onMouseMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
        >
          <defs>
            {(['success', 'failure', 'any'] as Cond[]).map((c) => (
              <marker key={c} id={`arrow-${c}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill={COND_COLOR[c]} />
              </marker>
            ))}
          </defs>

          {/* edges */}
          {auto.edges.map((e, i) => {
            const a = at(e.from);
            const b = at(e.to);
            const cond = (sessions.find((s) => s.id === e.to)?.dependsCondition ?? 'success') as Cond;
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x;
            const y2 = b.y + NODE_H / 2;
            const mx = (x1 + x2) / 2;
            return (
              <g key={i}>
                <path
                  d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                  fill="none"
                  stroke={COND_COLOR[cond]}
                  strokeWidth={1.6}
                  strokeDasharray={cond === 'failure' ? '5 3' : undefined}
                  markerEnd={`url(#arrow-${cond})`}
                  opacity={0.85}
                />
                {edit && (
                  <>
                    <text
                      x={mx}
                      y={(y1 + y2) / 2 - 6}
                      fontSize={9}
                      fill={COND_COLOR[cond]}
                      textAnchor="middle"
                      className="cursor-pointer"
                      onClick={() => cycleCondition(e.to, cond)}
                    >
                      {COND_LABEL[cond]}
                    </text>
                    <circle
                      cx={mx}
                      cy={(y1 + y2) / 2 + 8}
                      r={7}
                      fill="#161b24"
                      stroke="#f43f5e"
                      className="cursor-pointer"
                      onClick={() => removeEdge(e.from, e.to)}
                    />
                    <text x={mx} y={(y1 + y2) / 2 + 11} fontSize={8} fill="#f43f5e" textAnchor="middle" className="pointer-events-none">
                      ✕
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {/* wiring preview */}
          {wire && (
            <path
              d={`M${at(wire.from).x + NODE_W},${at(wire.from).y + NODE_H / 2} L${wire.x},${wire.y}`}
              stroke="#5eead4"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              fill="none"
            />
          )}

          {/* nodes */}
          {sessions.map((s) => {
            const p = at(s.id);
            const active = s.id === selected;
            const meta = STATUS_META[s.status];
            return (
              <g key={s.id} transform={`translate(${p.x},${p.y})`}>
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={10}
                  fill={STATUS_FILL[s.status]}
                  stroke={active ? '#5eead4' : STATUS_STROKE[s.status]}
                  strokeWidth={active ? 2.5 : 1.5}
                  className={edit ? 'cursor-move' : 'cursor-pointer'}
                  onMouseDown={(e) => {
                    if (!edit) return;
                    const l = toLocal(e);
                    setDrag({ id: s.id, dx: l.x - p.x, dy: l.y - p.y });
                  }}
                  onMouseUp={() => wire && dropOnNode(s.id)}
                  onClick={() => !edit && onSelect(s.id)}
                />
                <text x={10} y={20} fontSize={11} fill="#e5e9f0" className="pointer-events-none">
                  {s.title.length > 24 ? s.title.slice(0, 23) + '…' : s.title}
                </text>
                <text x={10} y={38} fontSize={9} fill="#94a3b8" className="pointer-events-none">
                  {AGENT_LABEL[s.agent]}
                </text>
                <text x={NODE_W - 10} y={38} fontSize={9} fill={STATUS_STROKE[s.status]} textAnchor="end" className="pointer-events-none">
                  {meta.label}
                </text>
                {/* 出力ポート（ここからドラッグして配線） */}
                {edit && (
                  <circle
                    cx={NODE_W}
                    cy={NODE_H / 2}
                    r={6}
                    fill="#5eead4"
                    className="cursor-crosshair"
                    onMouseDown={(e) => {
                      const l = toLocal(e);
                      setWire({ from: s.id, x: l.x, y: l.y });
                    }}
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {edit && (
        <div className="flex items-center gap-3 border-t border-edge px-3 py-1.5 text-[10px] text-slate-500">
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: COND_COLOR.success }} />成功時</span>
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: COND_COLOR.failure }} />失敗時（点線）</span>
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: COND_COLOR.any }} />どちらでも</span>
          <span className="ml-auto">条件ラベルをクリックで切替／✕でエッジ削除</span>
        </div>
      )}
    </div>
  );
}

function computeLayout(sessions: SessionSummary[]) {
  const ids = new Set(sessions.map((s) => s.id));
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const edges: Array<{ from: string; to: string }> = [];
  for (const s of sessions) {
    for (const dep of s.dependsOn ?? []) if (ids.has(dep)) edges.push({ from: dep, to: s.id });
  }

  const level = new Map<string, number>();
  const calc = (id: string, seen: Set<string>): number => {
    if (level.has(id)) return level.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const deps = (byId.get(id)?.dependsOn ?? []).filter((d) => ids.has(d));
    const lv = deps.length ? Math.max(...deps.map((d) => calc(d, seen))) + 1 : 0;
    level.set(id, Math.min(lv, 20));
    return level.get(id)!;
  };
  for (const s of sessions) calc(s.id, new Set());

  const byLevel = new Map<number, string[]>();
  for (const s of sessions) {
    const lv = level.get(s.id) ?? 0;
    (byLevel.get(lv) ?? byLevel.set(lv, []).get(lv)!).push(s.id);
  }
  const pos: Record<string, { x: number; y: number }> = {};
  let maxRows = 0;
  for (const [lv, group] of byLevel) {
    group.forEach((id, row) => {
      pos[id] = { x: PAD + lv * (NODE_W + COL_GAP), y: PAD + row * (NODE_H + ROW_GAP) };
    });
    maxRows = Math.max(maxRows, group.length);
  }
  const cols = Math.max(...[...byLevel.keys()], 0) + 1;
  return {
    pos,
    edges,
    width: PAD * 2 + cols * (NODE_W + COL_GAP),
    height: PAD * 2 + maxRows * (NODE_H + ROW_GAP),
  };
}
