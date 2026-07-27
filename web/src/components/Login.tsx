// ⑤ ログイン画面（本番で未認証時）。dev ログイン＋Google SSO（設定時）。
import { useState } from 'react';

export function Login({
  providers,
  onDevLogin,
}: {
  providers: { devLogin: boolean; google: boolean };
  onDevLogin: (email: string, name: string) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setErr('');
    try {
      await onDevLogin(email.trim(), name.trim());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-full place-items-center bg-[#0b0e13]">
      <div className="w-[360px] rounded-2xl border border-edge bg-panel2 p-6">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-2xl">🐎</span>
          <h1 className="text-lg font-bold">Corral</h1>
        </div>
        <p className="mb-5 text-xs text-slate-500">エージェント司令塔にサインイン</p>

        {providers.google && (
          <a
            href="/api/auth/sso/google"
            className="mb-3 block rounded-lg border border-edge bg-panel px-3 py-2 text-center text-sm hover:border-accent"
          >
            Google でログイン
          </a>
        )}

        {providers.devLogin && (
          <div className="flex flex-col gap-2">
            {providers.google && <div className="my-1 text-center text-[11px] text-slate-600">または</div>}
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="メールアドレス"
              className="rounded-lg border border-edge bg-panel px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="表示名（任意）"
              className="rounded-lg border border-edge bg-panel px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
            <button
              onClick={submit}
              disabled={busy || !email.trim()}
              className="rounded-lg bg-accent px-3 py-2 text-sm font-bold text-black disabled:opacity-40"
            >
              ログイン
            </button>
            <p className="text-[11px] text-slate-600">
              ※ dev ログイン（ローカル/検証用）。本番運用では SSO/SAML を有効化してください。
            </p>
          </div>
        )}

        {err && <div className="mt-3 text-xs text-rose-300">{err}</div>}
      </div>
    </div>
  );
}
