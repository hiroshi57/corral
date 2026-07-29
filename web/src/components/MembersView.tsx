// メンバー管理UI（member:manage）: 案件メンバーの一覧・招待・ロール変更
import { useEffect, useState } from 'react';
import type { Member } from '../lib/types';
import type { Role } from '../lib/auth';
import { ROLE_LABEL } from '../lib/auth';
import { api } from '../lib/api';

const ROLES: Role[] = ['owner', 'admin', 'member', 'viewer'];

export function MembersView({ workspaceName }: { workspaceName: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const refresh = () => api.listMembers().then(setMembers).catch(() => setMembers([]));
  useEffect(() => { refresh(); }, []); // eslint-disable-line

  const invite = async () => {
    if (!email.trim()) return;
    setBusy(true);
    try {
      await api.addMember(email.trim(), name.trim(), role);
      setEmail('');
      setName('');
      setMsg(`${email} を ${ROLE_LABEL[role]} として追加しました`);
      setTimeout(() => setMsg(''), 2500);
      refresh();
    } catch (e) {
      setMsg(`失敗: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (m: Member, r: Role) => {
    await api.addMember(m.email, m.name, r); // upsert = ロール変更
    refresh();
  };

  return (
    <div className="flex-1 overflow-auto">
      <h2 className="mb-1 text-sm font-bold">メンバー管理</h2>
      <p className="mb-3 text-xs text-slate-500">案件「{workspaceName}」のメンバーとロール</p>

      {/* 招待 */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-edge bg-panel2 p-3">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="メールアドレス" className="rounded-lg border border-edge bg-panel px-2 py-1 text-sm focus:border-accent focus:outline-none" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="表示名（任意）" className="rounded-lg border border-edge bg-panel px-2 py-1 text-sm focus:border-accent focus:outline-none" />
        <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="rounded-lg border border-edge bg-panel px-2 py-1 text-sm">
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <button onClick={invite} disabled={busy || !email.trim()} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-black disabled:opacity-40">
          ＋ 招待
        </button>
        {msg && <span className="text-xs text-accent">{msg}</span>}
      </div>

      {/* 一覧 */}
      <div className="overflow-hidden rounded-xl border border-edge">
        <table className="w-full text-left text-sm">
          <thead className="bg-panel2 text-xs text-slate-400">
            <tr><th className="px-3 py-2">名前</th><th className="px-3 py-2">メール</th><th className="px-3 py-2">プロバイダ</th><th className="px-3 py-2">ロール</th></tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-t border-edge/40">
                <td className="px-3 py-2">{m.name}</td>
                <td className="px-3 py-2 text-slate-400">{m.email}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{m.provider}</td>
                <td className="px-3 py-2">
                  <select value={m.role} onChange={(e) => changeRole(m, e.target.value as Role)} className="rounded border border-edge bg-panel px-2 py-1 text-xs">
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
