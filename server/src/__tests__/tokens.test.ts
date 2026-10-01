import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { config } from '../config.js';
import { signSession, verifySession } from '../auth/tokens.js';

const claims = {
  sub: 'u1',
  email: 'u1@example.com',
  name: 'U1',
  provider: 'dev',
  exp: Date.now() + 60_000,
};

describe('セッショントークン', () => {
  it('自分で署名したトークンは検証を通る', () => {
    expect(verifySession(signSession(claims))).toMatchObject({ sub: 'u1' });
  });

  it('API トークンを鍵として署名したトークンは拒否される（鍵分離の回帰テスト）', () => {
    const payload = Buffer.from(JSON.stringify({ ...claims, sub: 'machine' })).toString(
      'base64url'
    );
    const forged = `${payload}.${createHmac('sha256', config.token)
      .update(payload)
      .digest('base64url')}`;
    expect(verifySession(forged)).toBeNull();
  });

  it('セッション鍵と API トークンが同一値でない', () => {
    expect(config.sessionSecret).not.toBe(config.token);
  });

  it('期限切れトークンは拒否される', () => {
    expect(verifySession(signSession({ ...claims, exp: Date.now() - 1 }))).toBeNull();
  });

  it('署名を書き換えたトークンは拒否される', () => {
    const token = signSession(claims);
    const [payload] = token.split('.');
    expect(verifySession(`${payload}.AAAA`)).toBeNull();
  });
});
