// ④ 案件（ワークスペース）セレクタ ＋ ⑤ ロール表示（デモはロール切替可）
import { useState } from 'react';
import type { Role, WorkspaceInfo } from '../lib/auth';
import { ROLE_LABEL } from '../lib/auth';

const ROLES: Role[] = ['owner', 'admin', 'member', 'viewer'];

export function WorkspaceBar({
  workspaces,
  currentWs,
  role,
  isDemo,
  user,
  onSwitch,
  onCreate,
  onRoleChange,
  onLogout,
}: {
  workspaces: WorkspaceInfo[];
  currentWs: string;
  role: Role;
  isDemo: boolean;
  user: string;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onRoleChange: (r: Role) => void;
  onLogout: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const submit = () => {
    if (name.trim()) {
      onCreate(name.trim());
      setName('');
      setCreating(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500">案件</span>
      <select
        value={currentWs}
        onChange={(e) => onSwitch(e.target.value)}
        className="max-w-[200px] rounded-lg border border-edge bg-panel px-2 py-1 text-sm"
        title="案件（ワークスペース）を切り替え"
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>

      {creating ? (
        <span className="flex items-center gap-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="新しい案件名"
            className="w-40 rounded-lg border border-edge bg-panel px-2 py-1 text-sm focus:border-accent focus:outline-none"
          />
          <button onClick={submit} className="rounded-lg bg-accent px-2 py-1 text-xs font-bold text-black">
            作成
          </button>
          <button onClick={() => setCreating(false)} className="text-xs text-slate-500">
            ✕
          </button>
        </span>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="rounded-lg border border-edge bg-panel px-2 py-1 text-xs hover:border-accent"
          title="案件を追加"
        >
          ＋案件
        </button>
      )}

      {/* ロール */}
      {isDemo ? (
        <label className="ml-2 flex items-center gap-1 text-xs text-slate-500" title="デモ: ロールを切り替えて権限(RBAC)を体験">
          ロール
          <select
            value={role}
            onChange={(e) => onRoleChange(e.target.value as Role)}
            className="rounded-lg border border-edge bg-panel px-1.5 py-1 text-xs"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span className="ml-2 rounded border border-edge bg-panel px-2 py-0.5 text-[11px] text-slate-300">
          {user}・{ROLE_LABEL[role]}
        </span>
      )}
      {!isDemo && (
        <button onClick={onLogout} className="text-[11px] text-slate-500 hover:text-rose-300">
          ログアウト
        </button>
      )}
    </div>
  );
}
