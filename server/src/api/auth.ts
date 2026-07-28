// ⑤ 認証ルート: dev ログイン / me / logout / Google OIDC / SAML 2.0
import { Router } from 'express';
import { SAML } from '@node-saml/node-saml';
import { config } from '../config.js';
import { signSession, verifySession } from '../auth/tokens.js';
import { tenancy, MACHINE_USER } from '../tenancy/store.js';
import { audit } from '../audit/log.js';
import type { User } from '../types.js';

// SAML 2.0（設定時のみ）。Okta/Azure AD/OneLogin 等の IdP と連携
let samlInstance: SAML | null = null;
function getSaml(): SAML | null {
  const s = config.auth.saml;
  if (!s.entryPoint || !s.idpCert || !s.callbackUrl) return null;
  if (!samlInstance) {
    samlInstance = new SAML({
      entryPoint: s.entryPoint,
      issuer: s.issuer,
      callbackUrl: s.callbackUrl,
      idpCert: s.idpCert,
      wantAssertionsSigned: true,
    });
  }
  return samlInstance;
}

/** リクエストから現在ユーザーを解決（token/セッション） */
function currentUser(req: import('express').Request): User | null {
  if (req.header('x-corral-token') === config.token) return MACHINE_USER;
  const sess = req.header('x-corral-session');
  if (sess) {
    const claims = verifySession(sess);
    if (claims)
      return (
        tenancy.getUser(claims.sub) ?? {
          id: claims.sub,
          email: claims.email,
          name: claims.name,
          provider: claims.provider,
        }
      );
  }
  return null;
}

function issue(user: User): string {
  return signSession({
    sub: user.id,
    email: user.email,
    name: user.name,
    provider: user.provider,
    exp: Date.now() + config.auth.sessionTtlMs,
  });
}

export function createAuthRouter(): Router {
  const r = Router();

  // 利用可能な認証手段
  r.get('/providers', (_req, res) => {
    res.json({
      devLogin: config.auth.devLogin,
      google: !!config.auth.google.clientId,
      saml: !!getSaml(),
    });
  });

  // dev ログイン（メール＋名前でログイン。ローカル/デモ用）
  r.post('/login/dev', (req, res) => {
    if (!config.auth.devLogin) return res.status(403).json({ error: 'dev ログインは無効です' });
    const { email, name } = req.body as { email?: string; name?: string };
    if (!email) return res.status(400).json({ error: 'email は必須です' });
    const user = tenancy.upsertUser({
      email,
      name: name || email.split('@')[0],
      provider: 'dev',
    });
    audit.record({ actorId: user.id, actorEmail: user.email, action: 'auth.login', workspaceId: null, target: 'dev', outcome: 'success', ip: req.ip });
    res.json({ token: issue(user), user });
  });

  // 現在ユーザー＋所属ワークスペース(案件)一覧
  r.get('/me', (req, res) => {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ error: '未認証' });
    res.json({
      user,
      workspaces: tenancy.listWorkspacesForUser(user.id),
    });
  });

  r.post('/logout', (_req, res) => res.json({ ok: true })); // ステートレス（クライアント破棄）

  // --- Google OIDC（設定時のみ・スキャフォールド） ---
  r.get('/sso/google', (_req, res) => {
    const g = config.auth.google;
    if (!g.clientId || !g.redirectUri) {
      return res.status(501).json({ error: 'Google SSO は未設定です（CORRAL_GOOGLE_* を設定）' });
    }
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', g.clientId);
    url.searchParams.set('redirect_uri', g.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    res.redirect(url.toString());
  });

  r.get('/sso/google/callback', async (req, res) => {
    const g = config.auth.google;
    if (!g.clientId) return res.status(501).json({ error: 'Google SSO 未設定' });
    const code = req.query.code?.toString();
    if (!code) return res.status(400).json({ error: 'code がありません' });
    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: g.clientId,
          client_secret: g.clientSecret,
          redirect_uri: g.redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
      });
      const tok = (await tokenRes.json()) as { access_token?: string };
      if (!tok.access_token) return res.status(401).json({ error: 'トークン交換に失敗' });
      const uiRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      });
      const ui = (await uiRes.json()) as { email?: string; name?: string };
      if (!ui.email) return res.status(401).json({ error: 'ユーザー情報の取得に失敗' });
      const user = tenancy.upsertUser({ email: ui.email, name: ui.name || ui.email, provider: 'google' });
      // トークンを付けてダッシュボードへ戻す
      res.redirect(`/?session=${encodeURIComponent(issue(user))}`);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // --- SAML 2.0（Okta/Azure AD 等・設定時のみ） ---
  r.get('/sso/saml/metadata', (_req, res) => {
    const s = getSaml();
    if (!s) return res.status(501).json({ error: 'SAML 未設定' });
    res.type('application/xml').send(s.generateServiceProviderMetadata(null, null));
  });

  r.get('/sso/saml/login', async (_req, res) => {
    const s = getSaml();
    if (!s) return res.status(501).json({ error: 'SAML 未設定（CORRAL_SAML_* を設定）' });
    try {
      const url = await s.getAuthorizeUrlAsync('', undefined, {});
      res.redirect(url);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  r.post('/sso/saml/acs', async (req, res) => {
    const s = getSaml();
    if (!s) return res.status(501).json({ error: 'SAML 未設定' });
    try {
      const { profile } = await s.validatePostResponseAsync(req.body as Record<string, string>);
      const p = (profile ?? {}) as Record<string, unknown>;
      const email = (p.email ?? p.nameID) as string | undefined;
      if (!email) return res.status(401).json({ error: 'アサーションに email がありません' });
      const name = (p.displayName ?? p.cn ?? email) as string;
      const user = tenancy.upsertUser({ email, name, provider: 'saml' });
      audit.record({ actorId: user.id, actorEmail: user.email, action: 'auth.login', workspaceId: null, target: 'saml', outcome: 'success', ip: req.ip });
      res.redirect(`/?session=${encodeURIComponent(issue(user))}`);
    } catch (e) {
      res.status(401).json({ error: `SAML 検証失敗: ${(e as Error).message}` });
    }
  });

  return r;
}
