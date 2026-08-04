// 🕸 タスクグラフ（グラフ・エンジニアリング）+ GUIエディタ
// - nodes = セッション / edges = dependsOn（DAG）
// - 同一レベルは折り返してグリッド配置（縦一列にならないように）
// - ラベルは2行まで折り返し、担当エージェント・状態・コストを表示
// - 編集モード: ノードをドラッグで配置、ポートをドラッグで配線、条件(成功/失敗/どちらでも)を切替
import { useMemo, useRef, useState } from 'react';
import type { SessionSummary, SessionStatus } from '../lib/types';
import { AGENT_LABEL, STATUS_META } from '../lib/types';
import { api } from '../lib/api';

const NODE_W = 236;
const NODE_H = 70;
const COL_GAP = 76;
const ROW_GAP = 18;
const PAD = 28;
/** 同一レベル内で縦に並べる上限（超えたら隣の列へ折り返す） */
const MAX_ROWS = 4;

const STATUS_FILL: Record<SessionStatus, string> = {
  queued: '#171e27',
  running: '#082f45',
  needs_review: '#3b2508',
  done: '#052e23',
  error: '#3d1119',
  stopped: '#1b2430',
};
const STATUS_STROKE: Record<SessionStatus, string> = {
  queued: '#64748b',
  running: '#38bdf8',
  needs_review: '#fbbf24',
  done: '#34d399',
  error: '#f43f5e',
  stopped: '#64748b',
};
const COND_COLOR = { success: '#34d399', failure: '#f43f5e', any: '#94a3b8' } as const;
const COND_LABEL = { success: '成功時', failure: '失敗時', any: 'どちらでも' } as const;

type Cond = 'success' | 'failure' | 'any';

/** 日本語込みで N 文字ごとに折り返し、最大 maxLines 行に収める */
function wrapText(s: string, per = 17, maxLines = 2): string[] {
  const lines: string[] = [];
  for (let i = 0; i < s.length && lines.length < maxLines; i += per) lines.push(s.slice(i, i + per));
  if (s.length > per * maxLines && lines.length === maxLines) {
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, per - 1) + '…';
  }
  return lines;
}

const fmtUsd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;

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
  const [scale, setScale] = useState(1);
  const [hover, setHover] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [wire, setWire] = useState<{ from: string; x: number; y: number } | null>(null);
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});
  const svgRef = useRef<SVGSVGElement>(null);

  const auto = useMemo(() => computeLayout(sessions), [sessions]);
  const at = (id: string) =>
    pos[id] ?? sessions.find((s) => s.id === id)?.graphPos ?? auto.pos[id] ?? { x: PAD, y: PAD };

  const toLocal = (e: React.MouseEvent) => {
    const r = svgRef.current?.getBoundingClientRect();
    return { x: (e.clientX - (r?.left ?? 0)) / scale, y: (e.clientY - (r?.top ?? 0)) / scale };
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
    await api.updateGraph(to, { dependsCondition: order[(order.indexOf(cur) + 1) % order.length] });
    onChanged?.();
  };

  if (sessions.length === 0) {
    return (
      <div className="grid flex-1 place-items-center rounded-xl border border-dashed border-edge text-sm text-slate-600">
        この案件にタスクがありません。プレイブックの展開や、ドキュメント割り当ての「構成」で
        AI にグラフを組ませることもできます。
      </div>
    );
  }

  const contentW = Math.max(auto.width, ...sessions.map((s) => at(s.id).x + NODE_W + PAD));
  const contentH = Math.max(auto.height, ...sessions.map((s) => at(s.id).y + NODE_H + PAD));

  /** 選択中ノードに接続するエッジかどうか（強調表示用） */
  const isFocusEdge = (from: string, to: string) => {
    const f = selected ?? hover;
    return !!f && (from === f || to === f);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-edge bg-panel2">
      {/* ヘッダ */}
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
        <span className="text-sm font-bold text-slate-200">タスクグラフ</span>
        <span className="rounded bg-panel px-1.5 py-0.5 text-[10px] text-slate-400">
          {sessions.length} ノード / {auto.edges.length} エッジ
        </span>
        <span className="hidden text-[11px] text-slate-500 sm:inline">
          {edit ? 'ドラッグで移動／右の ● から他ノードへドラッグで依存を追加' : '← 左が先に実行、右が後続'}
        </span>

        <div className="ml-auto flex items-center gap-1">
          {/* ズーム */}
          <div className="flex items-center gap-0.5 rounded-lg border border-edge bg-panel px-1 py-0.5">
            <button
              onClick={() => setScale((s) => Math.max(0.5, +(s - 0.1).toFixed(2)))}
              className="px-1.5 text-xs text-slate-400 hover:text-accent"
              title="縮小"
            >
              −
            </button>
            <span className="w-9 text-center text-[10px] text-slate-500">{Math.round(scale * 100)}%</span>
            <button
              onClick={() => setScale((s) => Math.min(1.5, +(s + 0.1).toFixed(2)))}
              className="px-1.5 text-xs text-slate-400 hover:text-accent"
              title="拡大"
            >
              ＋
            </button>
            <button
              onClick={() => {
                setScale(1);
                setPos({});
              }}
              className="px-1.5 text-[10px] text-slate-400 hover:text-accent"
              title="自動整列に戻す"
            >
              ⤢
            </button>
          </div>
          {canEdit && (
            <button
              onClick={() => setEdit((v) => !v)}
              className={`rounded-lg px-2.5 py-1 text-xs ${
                edit ? 'bg-accent font-bold text-black' : 'border border-edge bg-panel hover:border-accent'
              }`}
            >
              {edit ? '✓ 編集中' : '✎ 編集'}
            </button>
          )}
        </div>
      </div>

      {/* キャンバス */}
      <div className="flex-1 overflow-auto bg-[#0d1117]">
        <svg
          ref={svgRef}
          width={contentW * scale}
          height={contentH * scale}
          className="block"
          onMouseMove={onMouseMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
        >
          <defs>
            {(['success', 'failure', 'any'] as Cond[]).map((c) => (
              <marker key={c} id={`ar-${c}`} markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
                <path d="M0,0 L9,4.5 L0,9 Z" fill={COND_COLOR[c]} />
              </marker>
            ))}
            <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M24 0 L0 0 0 24" fill="none" stroke="#161d27" strokeWidth="1" />
            </pattern>
          </defs>

          <g transform={`scale(${scale})`}>
            {/* 背景グリッド */}
            <rect width={contentW} height={contentH} fill="url(#grid)" />

            {/* エッジ */}
            {auto.edges.map((e, i) => {
              const a = at(e.from);
              const b = at(e.to);
              const cond = (sessions.find((s) => s.id === e.to)?.dependsCondition ?? 'success') as Cond;
              const x1 = a.x + NODE_W;
              const y1 = a.y + NODE_H / 2;
              const x2 = b.x;
              const y2 = b.y + NODE_H / 2;
              const mx = (x1 + x2) / 2;
              const focus = isFocusEdge(e.from, e.to);
              return (
                <g key={i}>
                  <path
                    d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                    fill="none"
                    stroke={COND_COLOR[cond]}
                    strokeWidth={focus ? 2.4 : 1.5}
                    strokeDasharray={cond === 'failure' ? '6 4' : undefined}
                    markerEnd={`url(#ar-${cond})`}
                    opacity={selected || hover ? (focus ? 1 : 0.25) : 0.7}
                  />
                  {edit && (
                    <>
                      <rect x={mx - 22} y={(y1 + y2) / 2 - 17} width={44} height={13} rx={3} fill="#0d1117" opacity={0.9} />
                      <text
                        x={mx}
                        y={(y1 + y2) / 2 - 7}
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
                        fill="#0d1117"
                        stroke="#f43f5e"
                        className="cursor-pointer"
                        onClick={() => removeEdge(e.from, e.to)}
                      />
                      <text
                        x={mx}
                        y={(y1 + y2) / 2 + 11}
                        fontSize={8}
                        fill="#f43f5e"
                        textAnchor="middle"
                        className="pointer-events-none"
                      >
                        ✕
                      </text>
                    </>
                  )}
                </g>
              );
            })}

            {/* 配線プレビュー */}
            {wire && (
              <path
                d={`M${at(wire.from).x + NODE_W},${at(wire.from).y + NODE_H / 2} L${wire.x},${wire.y}`}
                stroke="#5eead4"
                strokeWidth={2}
                strokeDasharray="5 4"
                fill="none"
              />
            )}

            {/* ノード */}
            {sessions.map((s) => {
              const p = at(s.id);
              const active = s.id === selected;
              const meta = STATUS_META[s.status];
              const lines = wrapText(s.title);
              const dim = !!(selected || hover) && !active && s.id !== hover && !hasLink(auto.edges, s.id, selected ?? hover);
              return (
                <g
                  key={s.id}
                  transform={`translate(${p.x},${p.y})`}
                  opacity={dim ? 0.45 : 1}
                  onMouseEnter={() => setHover(s.id)}
                  onMouseLeave={() => setHover(null)}
                >
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={12}
                    fill={STATUS_FILL[s.status]}
                    stroke={active ? '#5eead4' : STATUS_STROKE[s.status]}
                    strokeWidth={active ? 2.5 : 1.4}
                    className={edit ? 'cursor-move' : 'cursor-pointer'}
                    onMouseDown={(e) => {
                      if (!edit) return;
                      const l = toLocal(e);
                      setDrag({ id: s.id, dx: l.x - p.x, dy: l.y - p.y });
                    }}
                    onMouseUp={() => wire && dropOnNode(s.id)}
                    onClick={() => !edit && onSelect(s.id)}
                  />

                  {/* 状態インジケータ（左の縦バー） */}
                  <rect x={0} y={10} width={4} height={NODE_H - 20} rx={2} fill={STATUS_STROKE[s.status]} className="pointer-events-none" />

                  {/* タイトル（2行まで） */}
                  {lines.map((ln, i) => (
                    <text key={i} x={14} y={22 + i * 15} fontSize={11.5} fill="#e5e9f0" className="pointer-events-none">
                      {ln}
                    </text>
                  ))}

                  {/* フッタ: 担当 / コスト / 状態 */}
                  <text x={14} y={NODE_H - 12} fontSize={9.5} fill="#8b98a9" className="pointer-events-none">
                    {AGENT_LABEL[s.agent]}
                    {s.usage?.costUsd > 0 ? ` · ${fmtUsd(s.usage.costUsd)}` : ''}
                    {s.violations?.length ? ' · 🛡' : ''}
                  </text>
                  <text
                    x={NODE_W - 12}
                    y={NODE_H - 12}
                    fontSize={9.5}
                    fill={STATUS_STROKE[s.status]}
                    textAnchor="end"
                    className="pointer-events-none"
                  >
                    {meta.label}
                    {s.status === 'queued' && (s.dependsOn?.length ?? 0) > 0 ? '（依存待ち）' : ''}
                  </text>

                  {/* 出力ポート */}
                  {edit && (
                    <circle
                      cx={NODE_W}
                      cy={NODE_H / 2}
                      r={6.5}
                      fill="#5eead4"
                      stroke="#0d1117"
                      strokeWidth={1.5}
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
          </g>
        </svg>
      </div>

      {/* 凡例 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-edge px-3 py-1.5 text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4" style={{ background: COND_COLOR.success }} />成功時
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 border-t border-dashed" style={{ borderColor: COND_COLOR.failure }} />失敗時
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4" style={{ background: COND_COLOR.any }} />どちらでも
        </span>
        <span className="mx-1 text-edge">|</span>
        {(['running', 'needs_review', 'done', 'error', 'queued'] as SessionStatus[]).map((st) => (
          <span key={st} className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: STATUS_STROKE[st] }} />
            {STATUS_META[st].label}
          </span>
        ))}
        {edit && <span className="ml-auto">条件ラベルをクリックで切替／✕でエッジ削除</span>}
      </div>
    </div>
  );
}

/** from/to のどちらかが id と繋がるエッジがあるか（強調表示用） */
function hasLink(edges: Array<{ from: string; to: string }>, id: string, focus: string | null): boolean {
  if (!focus) return false;
  return edges.some((e) => (e.from === focus && e.to === id) || (e.to === focus && e.from === id));
}

function computeLayout(sessions: SessionSummary[]) {
  const ids = new Set(sessions.map((s) => s.id));
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const edges: Array<{ from: string; to: string }> = [];
  for (const s of sessions) {
    for (const dep of s.dependsOn ?? []) if (ids.has(dep)) edges.push({ from: dep, to: s.id });
  }

  // トポロジカル深さ（循環は上限でガード）
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

  // レベルごとに列を割り当て、同一レベルは MAX_ROWS で折り返す（縦一列を避ける）
  const pos: Record<string, { x: number; y: number }> = {};
  const levels = [...byLevel.keys()].sort((a, b) => a - b);
  let cursorX = PAD;
  let maxRows = 0;
  for (const lv of levels) {
    const group = byLevel.get(lv)!;
    const subCols = Math.max(1, Math.ceil(group.length / MAX_ROWS));
    group.forEach((id, i) => {
      const sub = Math.floor(i / MAX_ROWS);
      const row = i % MAX_ROWS;
      pos[id] = { x: cursorX + sub * (NODE_W + COL_GAP), y: PAD + row * (NODE_H + ROW_GAP) };
    });
    maxRows = Math.max(maxRows, Math.min(group.length, MAX_ROWS));
    cursorX += subCols * (NODE_W + COL_GAP);
  }

  return {
    pos,
    edges,
    width: cursorX + PAD,
    height: PAD * 2 + maxRows * (NODE_H + ROW_GAP),
  };
}
