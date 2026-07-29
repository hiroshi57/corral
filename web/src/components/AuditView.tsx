// 監査UIビュー（owner/admin）: 監査ログの一覧・フィルタ・NDJSON エクスポート・SIEM状態
import { useEffect, useState } from 'react';
import type { AuditEvent } from '../lib/types';

const OUTCOME: Record<AuditEvent['outcome'], string> = {
  success: 'text-emerald-300',
  denied: 'text-rose-300',
  error: 'text-amber-300',
};

export function AuditView({
  load,
}: {
  load: (action?: string) => Promise<{ siemConnected: boolean; events: AuditEvent[] }>;
}) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [siem, setSiem] = useState(false);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    load(filter || undefined)
      .then((r) => {
        setEvents(r.events);
        setSiem(r.siemConnected);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []); // eslint-disable-line

  const exportNdjson = () => {
    const nd = events.map((e) => JSON.stringify(e)).join('\n');
    const blob = new Blob([nd], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'corral-audit.ndjson';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold">監査ログ</h2>
        <span
          className={`rounded border px-2 py-0.5 text-[10px] ${
            siem ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-edge text-slate-500'
          }`}
        >
          SIEM連携: {siem ? '接続済' : '未接続'}
        </span>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && refresh()}
          placeholder="action で絞り込み（例: session.）"
          className="rounded-lg border border-edge bg-panel px-2 py-1 text-xs focus:border-accent focus:outline-none"
        />
        <button onClick={refresh} className="rounded-lg border border-edge bg-panel px-2 py-1 text-xs hover:border-accent">
          更新
        </button>
        <button onClick={exportNdjson} className="ml-auto rounded-lg border border-edge bg-panel px-3 py-1 text-xs hover:border-accent">
          ⬇ NDJSON エクスポート
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-edge">
        <table className="w-full text-left text-xs">
          <thead className="bg-panel2 text-slate-400">
            <tr>
              <th className="px-2 py-1.5">時刻</th>
              <th className="px-2 py-1.5">実行者</th>
              <th className="px-2 py-1.5">アクション</th>
              <th className="px-2 py-1.5">対象</th>
              <th className="px-2 py-1.5">結果</th>
              <th className="px-2 py-1.5">詳細</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="px-2 py-6 text-center text-slate-600">読み込み中…</td></tr>
            )}
            {!loading && events.length === 0 && (
              <tr><td colSpan={6} className="px-2 py-6 text-center text-slate-600">監査ログはありません</td></tr>
            )}
            {events.map((e, i) => (
              <tr key={i} className="border-t border-edge/40">
                <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">
                  {new Date(e.ts).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </td>
                <td className="px-2 py-1.5 text-slate-300">{e.actorEmail}</td>
                <td className="px-2 py-1.5 font-mono text-accent">{e.action}</td>
                <td className="max-w-[140px] truncate px-2 py-1.5 font-mono text-slate-500">{e.target ?? '—'}</td>
                <td className={`px-2 py-1.5 ${OUTCOME[e.outcome]}`}>{e.outcome}</td>
                <td className="max-w-[220px] truncate px-2 py-1.5 text-slate-400">{e.detail ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-slate-600">
        ※ 各行は SHA256 ハッシュチェーンで改ざん検知可能。SIEM(Splunk/Datadog等)へは Webhook で自動転送されます。
      </p>
    </div>
  );
}
