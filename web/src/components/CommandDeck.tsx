// 司令塔ペイン：新規タスク投入 + 一斉指示(broadcast)
import { useState } from 'react';
import type { AgentKind } from '../lib/types';
import { AGENT_LABEL } from '../lib/types';
import { api } from '../lib/api';

const AGENTS: AgentKind[] = ['claude', 'codex', 'gemini', 'aider'];

export function CommandDeck({
  onChanged,
  canCreate = true,
  canInstruct = true,
}: {
  onChanged: () => void;
  canCreate?: boolean;
  canInstruct?: boolean;
}) {
  const [agent, setAgent] = useState<AgentKind>('claude');
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(1);
  const [autoAccept, setAutoAccept] = useState(false);
  const [broadcastText, setBroadcastText] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  };

  const dispatch = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    try {
      const created = await api.createSessions({ agent, prompt, count, autoAccept });
      setPrompt('');
      flash(`${created.length} 体のワーカーを起動しました`);
      onChanged();
    } catch (e) {
      flash(`起動失敗: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const doBroadcast = async () => {
    if (!broadcastText.trim()) return;
    setBusy(true);
    try {
      const { delivered } = await api.broadcast(broadcastText);
      setBroadcastText('');
      flash(`${delivered} 体へ一斉指示を送信しました`);
    } catch (e) {
      flash(`送信失敗: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-panel2 border border-edge rounded-xl p-4 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-lg">🎯</span>
        <h2 className="font-bold">司令塔</h2>
        <span className="text-xs text-slate-500">指示を出して、結果を待つだけ</span>
      </div>

      {/* 新規タスク */}
      <div className="flex flex-col gap-2">
        <label className="text-xs text-slate-400">新しいタスクを割り当て</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="例：認証まわりのバグを直して。テストも追加して。"
          rows={3}
          className="bg-panel border border-edge rounded-lg p-2 text-sm resize-none focus:outline-none focus:border-accent"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value as AgentKind)}
            className="bg-panel border border-edge rounded-lg px-2 py-1 text-sm"
          >
            {AGENTS.map((a) => (
              <option key={a} value={a}>
                {AGENT_LABEL[a]}
              </option>
            ))}
          </select>
          <label className="text-xs text-slate-400 flex items-center gap-1">
            台数
            <input
              type="number"
              min={1}
              max={10}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-14 bg-panel border border-edge rounded-lg px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs text-slate-400 flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={autoAccept}
              onChange={(e) => setAutoAccept(e.target.checked)}
            />
            自動承認(yolo)
          </label>
          <button
            onClick={dispatch}
            disabled={busy || !prompt.trim() || !canCreate}
            title={canCreate ? '' : '起動権限がありません（閲覧者）'}
            className="ml-auto bg-accent text-black font-bold rounded-lg px-4 py-1.5 text-sm disabled:opacity-40"
          >
            ▶ 起動
          </button>
        </div>
      </div>

      <div className="h-px bg-edge" />

      {/* 一斉指示 */}
      <div className="flex flex-col gap-2">
        <label className="text-xs text-slate-400">全ワーカーへ一斉指示（broadcast）</label>
        <div className="flex gap-2">
          <input
            value={broadcastText}
            onChange={(e) => setBroadcastText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doBroadcast()}
            placeholder="例：入力バリデーションも忘れずに"
            className="flex-1 bg-panel border border-edge rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
          />
          <button
            onClick={doBroadcast}
            disabled={busy || !broadcastText.trim() || !canInstruct}
            title={canInstruct ? '' : '指示権限がありません（閲覧者）'}
            className="bg-panel border border-edge rounded-lg px-3 py-1.5 text-sm disabled:opacity-40 hover:border-accent"
          >
            📣 送信
          </button>
        </div>
      </div>

      {toast && (
        <div className="text-xs text-accent bg-accent/10 border border-accent/30 rounded-lg px-3 py-2">
          {toast}
        </div>
      )}
    </div>
  );
}
