// 🕸 タスクグラフ（グラフ・エンジニアリング）
// エージェント群を「一直線」でなく DAG（依存グラフ）として可視化する。
// nodes = セッション、edges = dependsOn。トポロジカルに階層化して描画。
import { useMemo } from 'react';
import type { SessionSummary, SessionStatus } from '../lib/types';
import { AGENT_LABEL, STATUS_META } from '../lib/types';

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

export function TaskGraph({
  sessions,
  selected,
  onSelect,
}: {
  sessions: SessionSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const layout = useMemo(() => computeLayout(sessions), [sessions]);

  if (sessions.length === 0) {
    return (
      <div className="grid flex-1 place-items-center text-sm text-slate-600">
        この案件にタスクがありません。ドキュメント割り当てで「段階(フェーズ)」構成にすると、依存グラフが構築されます。
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto rounded-xl border border-edge bg-panel2">
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2 text-xs text-slate-400">
        <span className="text-sm font-bold text-slate-200">タスクグラフ</span>
        <span>依存関係（DAG）で艦隊を編成。← 左が先に実行、右が後続</span>
        <span className="ml-auto">{sessions.length} ノード / {layout.edges.length} エッジ</span>
      </div>
      <svg width={layout.width} height={layout.height} className="block">
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="#5eead4" />
          </marker>
        </defs>
        {/* edges */}
        {layout.edges.map((e, i) => {
          const a = layout.pos[e.from];
          const b = layout.pos[e.to];
          if (!a || !b) return null;
          const x1 = a.x + NODE_W;
          const y1 = a.y + NODE_H / 2;
          const x2 = b.x;
          const y2 = b.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={i}
              d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
              fill="none"
              stroke="#2b3442"
              strokeWidth={1.5}
              markerEnd="url(#arrow)"
            />
          );
        })}
        {/* nodes */}
        {sessions.map((s) => {
          const p = layout.pos[s.id];
          if (!p) return null;
          const active = s.id === selected;
          const meta = STATUS_META[s.status];
          return (
            <g key={s.id} transform={`translate(${p.x},${p.y})`} onClick={() => onSelect(s.id)} className="cursor-pointer">
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={10}
                fill={STATUS_FILL[s.status]}
                stroke={active ? '#5eead4' : STATUS_STROKE[s.status]}
                strokeWidth={active ? 2.5 : 1.5}
              />
              <text x={10} y={20} fontSize={11} fill="#e5e9f0">
                {s.title.length > 24 ? s.title.slice(0, 23) + '…' : s.title}
              </text>
              <text x={10} y={38} fontSize={9} fill="#94a3b8">
                {AGENT_LABEL[s.agent]}
              </text>
              <text x={NODE_W - 10} y={38} fontSize={9} fill={STATUS_STROKE[s.status]} textAnchor="end">
                {meta.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function computeLayout(sessions: SessionSummary[]) {
  const ids = new Set(sessions.map((s) => s.id));
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const edges: Array<{ from: string; to: string }> = [];
  for (const s of sessions) {
    for (const dep of s.dependsOn ?? []) {
      if (ids.has(dep)) edges.push({ from: dep, to: s.id });
    }
  }

  // レベル（トポロジカル深さ）を計算。循環は上限でガード
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

  // レベルごとに縦に並べる
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
