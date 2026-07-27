// ②③ 生産性ダッシュボード + FinOps
// dashboard-depth 準拠: 多角的KPI・状態内訳・時系列・将来予測・総評まで。
import { useMemo } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { SessionSummary, SessionStatus } from '../lib/types';
import { AGENT_LABEL, STATUS_META } from '../lib/types';

const STATUS_COLOR: Record<SessionStatus, string> = {
  queued: '#94a3b8',
  running: '#38bdf8',
  needs_review: '#fbbf24',
  done: '#34d399',
  error: '#f43f5e',
  stopped: '#64748b',
};
const AGENT_COLOR: Record<string, string> = {
  claude: '#a78bfa',
  codex: '#5eead4',
  gemini: '#60a5fa',
  aider: '#f472b6',
  custom: '#94a3b8',
};

const fmtUsd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const fmtDur = (ms: number) =>
  ms >= 60000 ? `${(ms / 60000).toFixed(1)}分` : `${(ms / 1000).toFixed(1)}秒`;

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-edge bg-panel2 p-3">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-bold text-slate-100">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

export function Dashboard({ sessions }: { sessions: SessionSummary[] }) {
  const m = useMemo(() => compute(sessions), [sessions]);

  if (sessions.length === 0) {
    return (
      <div className="grid flex-1 place-items-center text-sm text-slate-600">
        まだデータがありません。司令塔でタスクを起動すると、ここに生産性とコストが集計されます。
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4 overflow-auto pr-1">
      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="総タスク" value={`${m.total}`} sub={`実行中 ${m.byStatus.running ?? 0}`} />
        <Kpi label="完了率" value={`${(m.completionRate * 100).toFixed(0)}%`} sub={`完了 ${m.completed}`} />
        <Kpi label="平均所要" value={m.avgDurationMs ? fmtDur(m.avgDurationMs) : '—'} />
        <Kpi label="総コスト" value={fmtUsd(m.totalCost)} sub={`${(m.totalTokens / 1000).toFixed(1)}k tok`} />
        <Kpi label="人手介入率" value={`${(m.interventionRate * 100).toFixed(0)}%`} sub={`介入 ${m.interventions} 回`} />
        <Kpi label="変更ファイル" value={`${m.changedFiles}`} sub={`エラー ${m.byStatus.error ?? 0}`} />
      </div>

      {/* 将来予測 */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Kpi
          label="完了ペース（将来予測）"
          value={m.ratePerHour !== null ? `${m.ratePerHour.toFixed(1)} 件/時` : '計測中'}
          sub={m.projected24h !== null ? `この調子なら 24h で約 ${Math.round(m.projected24h)} 件` : '—'}
        />
        <Kpi
          label="コストペース（将来予測）"
          value={m.costPerHour !== null ? `${fmtUsd(m.costPerHour)}/時` : '計測中'}
          sub={m.projectedMonthCost !== null ? `月換算 約 ${fmtUsd(m.projectedMonthCost)}` : '—'}
        />
        <Kpi
          label="1タスク平均コスト"
          value={m.completed ? fmtUsd(m.totalCost / m.completed) : '—'}
          sub={`最安: ${m.cheapestAgent ? AGENT_LABEL[m.cheapestAgent as keyof typeof AGENT_LABEL] : '—'}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 状態内訳 */}
        <div className="rounded-xl border border-edge bg-panel2 p-3">
          <div className="mb-2 text-sm font-bold">状態内訳</div>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={m.statusData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                {m.statusData.map((d) => (
                  <Cell key={d.status} fill={STATUS_COLOR[d.status]} />
                ))}
              </Pie>
              <Tooltip contentStyle={TIP} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* エージェント別コスト（FinOps） */}
        <div className="rounded-xl border border-edge bg-panel2 p-3">
          <div className="mb-2 text-sm font-bold">エージェント別コスト（FinOps）</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={m.agentCost}>
              <CartesianGrid strokeDasharray="3 3" stroke="#232b38" />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
              <Tooltip contentStyle={TIP} formatter={(v) => fmtUsd(Number(v))} />
              <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                {m.agentCost.map((d) => (
                  <Cell key={d.key} fill={AGENT_COLOR[d.key] ?? '#94a3b8'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 時系列（累積） */}
      <div className="rounded-xl border border-edge bg-panel2 p-3">
        <div className="mb-2 text-sm font-bold">推移（累積の完了数とコスト）</div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={m.timeline}>
            <CartesianGrid strokeDasharray="3 3" stroke="#232b38" />
            <XAxis dataKey="t" tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis yAxisId="l" tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis yAxisId="r" orientation="right" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
            <Tooltip contentStyle={TIP} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line yAxisId="l" type="monotone" dataKey="完了" stroke="#34d399" strokeWidth={2} dot={false} />
            <Line yAxisId="r" type="monotone" dataKey="コスト" stroke="#5eead4" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 総評 */}
      <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
        <div className="mb-1 text-sm font-bold text-accent">総評</div>
        <p className="whitespace-pre-line text-sm leading-relaxed text-slate-200">{m.verdict}</p>
      </div>
    </div>
  );
}

const TIP = {
  background: '#161b24',
  border: '1px solid #232b38',
  borderRadius: 8,
  fontSize: 12,
} as const;

function compute(sessions: SessionSummary[]) {
  const total = sessions.length;
  const byStatus = {} as Record<SessionStatus, number>;
  for (const s of sessions) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  const completed = byStatus.done ?? 0;
  const completionRate = total ? completed / total : 0;

  const durations = sessions.filter((s) => s.durationMs > 0).map((s) => s.durationMs);
  const avgDurationMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  const totalCost = sessions.reduce((a, s) => a + s.usage.costUsd, 0);
  const totalTokens = sessions.reduce((a, s) => a + s.usage.inputTokens + s.usage.outputTokens, 0);
  const interventions = sessions.reduce((a, s) => a + s.interventions, 0);
  const interventionRate = total ? sessions.filter((s) => s.interventions > 0).length / total : 0;
  const changedFiles = sessions.reduce((a, s) => a + s.changedFiles, 0);

  // 状態内訳
  const statusData = (Object.keys(byStatus) as SessionStatus[]).map((status) => ({
    status,
    name: STATUS_META[status].label,
    value: byStatus[status],
  }));

  // エージェント別コスト
  const agentMap = {} as Record<string, { cost: number; sessions: number }>;
  for (const s of sessions) {
    agentMap[s.agent] ??= { cost: 0, sessions: 0 };
    agentMap[s.agent].cost += s.usage.costUsd;
    agentMap[s.agent].sessions += 1;
  }
  const agentCost = Object.entries(agentMap).map(([key, v]) => ({
    key,
    name: AGENT_LABEL[key as keyof typeof AGENT_LABEL] ?? key,
    cost: Number(v.cost.toFixed(4)),
  }));

  // 1タスク平均が最安のエージェント
  let cheapestAgent: string | null = null;
  let cheapest = Infinity;
  for (const [k, v] of Object.entries(agentMap)) {
    if (v.sessions === 0) continue;
    const per = v.cost / v.sessions;
    if (per < cheapest) {
      cheapest = per;
      cheapestAgent = k;
    }
  }
  let topAgent: string | null = null;
  let topN = -1;
  for (const [k, v] of Object.entries(agentMap)) if (v.sessions > topN) ((topN = v.sessions), (topAgent = k));

  // 将来予測（経過時間ベース）
  const first = Math.min(...sessions.map((s) => s.createdAt));
  const elapsedH = (Date.now() - first) / 3_600_000;
  const measurable = elapsedH >= 1 / 120; // 30秒以上で計測とみなす
  const ratePerHour = measurable ? completed / elapsedH : null;
  const projected24h = ratePerHour !== null ? ratePerHour * 24 : null;
  const costPerHour = measurable ? totalCost / elapsedH : null;
  const projectedMonthCost = costPerHour !== null ? costPerHour * 24 * 30 : null;

  // 時系列（完了順の累積）
  const done = sessions.filter((s) => s.status === 'done').sort((a, b) => a.updatedAt - b.updatedAt);
  let cumT = 0;
  let cumC = 0;
  const timeline = done.map((s) => {
    cumT += 1;
    cumC += s.usage.costUsd;
    return {
      t: new Date(s.updatedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
      完了: cumT,
      コスト: Number(cumC.toFixed(4)),
    };
  });

  // 総評
  const verdict = buildVerdict({
    total,
    completed,
    completionRate,
    interventionRate,
    totalCost,
    topAgent,
    cheapestAgent,
    projectedMonthCost,
    errors: byStatus.error ?? 0,
  });

  return {
    total,
    byStatus,
    completed,
    completionRate,
    avgDurationMs,
    totalCost,
    totalTokens,
    interventions,
    interventionRate,
    changedFiles,
    statusData,
    agentCost,
    cheapestAgent,
    ratePerHour,
    projected24h,
    costPerHour,
    projectedMonthCost,
    timeline,
    verdict,
  };
}

function buildVerdict(x: {
  total: number;
  completed: number;
  completionRate: number;
  interventionRate: number;
  totalCost: number;
  topAgent: string | null;
  cheapestAgent: string | null;
  projectedMonthCost: number | null;
  errors: number;
}): string {
  const lines: string[] = [];
  const label = (k: string | null) => (k ? AGENT_LABEL[k as keyof typeof AGENT_LABEL] ?? k : '—');

  lines.push(
    `全 ${x.total} タスク中 ${x.completed} 件完了（完了率 ${(x.completionRate * 100).toFixed(0)}%）。` +
      `最も稼働したのは ${label(x.topAgent)}、1タスク平均コストが最も安いのは ${label(x.cheapestAgent)}。`
  );

  if (x.interventionRate <= 0.2)
    lines.push('人手介入率は低く、自律的に完了できています。broadcast/自動承認の活用余地あり。');
  else if (x.interventionRate <= 0.5)
    lines.push('人手介入は中程度。プレイブック化やプロンプト改善で介入を減らせる余地があります。');
  else
    lines.push('人手介入率が高めです。タスク分解の粒度やテンプレートの整備を検討してください。');

  if (x.errors > 0)
    lines.push(`エラーが ${x.errors} 件あります。自動リトライ/ガードレールの導入が有効です。`);

  if (x.projectedMonthCost !== null)
    lines.push(
      `現在のペースだと月換算コストは約 ${fmtUsd(x.projectedMonthCost)}。予算アラート（FinOps）の設定を推奨します。`
    );

  return lines.join('\n');
}
