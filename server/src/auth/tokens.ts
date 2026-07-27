// ⑤ 認証: HMAC 署名付きセッショントークン（外部JWTライブラリ不要）
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const SECRET = config.token; // デーモン起動ごとのシークレット（トークンと共用）

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

export interface SessionClaims {
  sub: string; // user id
  email: string;
  name: string;
  provider: string;
  exp: number; // 失効(ms)
}

/** クレームに署名してトークン文字列を返す */
export function signSession(claims: SessionClaims): string {
  const payload = b64url(JSON.stringify(claims));
  const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** トークンを検証し、正当ならクレームを返す */
export function verifySession(token: string): SessionClaims | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as SessionClaims;
    if (claims.exp && claims.exp < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}
