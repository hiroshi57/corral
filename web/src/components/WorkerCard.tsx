// ワーカー状態カード（herdr の "state at a glance"）
import type { SessionSummary } from '../lib/types';
import { AGENT_LABEL, STATUS_META } from '../lib/types';

export function WorkerCard({
  session,
  active,
  onSelect,
}: {
  session: SessionSummary;
  active: boolean;
  onSelect: () => void;
}) {
  const meta = STATUS_META[session.status];
  return (
    <button
      onClick={onSelect}
      className={`text-left bg-panel2 border rounded-xl p-3 transition hover:border-accent/60 ${
        active ? 'border-accent' : 'border-edge'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
        <span className={`text-xs font-medium ${meta.color}`}>{meta.label}</span>
        <span className="ml-auto text-[10px] text-slate-500">
          {AGENT_LABEL[session.agent]}
        </span>
      </div>
      <div className="text-sm font-medium truncate" title={session.title}>
        {session.title}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500">
        <span className="font-mono">{session.branch ?? '—'}</span>
        {session.changedFiles > 0 && (
          <span className="text-amber-300">±{session.changedFiles} ファイル</span>
        )}
        {session.autoAccept && <span className="text-sky-400">auto</span>}
      </div>
    </button>
  );
}
