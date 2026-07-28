// #20 ポリシーガードレール: 危険コマンド/保護パス/機密漏洩/大量変更 を検査
import { config } from '../config.js';
import type { GuardrailViolation } from '../types.js';

// 機密情報の典型パターン（APIキー/トークン/秘密鍵）
const SECRET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /sk-[A-Za-z0-9]{20,}/, label: 'OpenAI風APIキー' },
  { re: /AKIA[0-9A-Z]{16}/, label: 'AWSアクセスキー' },
  { re: /ghp_[A-Za-z0-9]{30,}/, label: 'GitHubトークン' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: '秘密鍵' },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/, label: 'Slackトークン' },
];

function v(kind: GuardrailViolation['kind'], detail: string, blocked: boolean): GuardrailViolation {
  return { ts: Date.now(), kind, detail, blocked };
}

/** プロンプトに禁止コマンドが含まれないか（実行前ブロック用） */
export function checkPrompt(text: string): GuardrailViolation[] {
  if (!config.guardrails.enabled) return [];
  const out: GuardrailViolation[] = [];
  for (const pat of config.guardrails.denyCommands) {
    try {
      if (new RegExp(pat, 'i').test(text)) {
        out.push(v('deny-command', `禁止コマンド検出: /${pat}/`, true));
      }
    } catch {
      /* 不正な正規表現は無視 */
    }
  }
  return out;
}

/** 出力に機密が漏れていないか（検出→記録。ログはマスキング） */
export function scanSecrets(text: string): { violations: GuardrailViolation[]; redacted: string } {
  if (!config.guardrails.enabled) return { violations: [], redacted: text };
  const violations: GuardrailViolation[] = [];
  let redacted = text;
  for (const { re, label } of SECRET_PATTERNS) {
    const g = new RegExp(re.source, 'g');
    if (g.test(text)) {
      violations.push(v('secret-leak', `機密の可能性: ${label}`, false));
      redacted = redacted.replace(new RegExp(re.source, 'g'), '«REDACTED»');
    }
  }
  return { violations, redacted };
}

/** 承認前チェック: 保護パスへの変更 / 大量変更 */
export function checkChanges(
  changedFiles: string[],
  count: number
): GuardrailViolation[] {
  if (!config.guardrails.enabled) return [];
  const out: GuardrailViolation[] = [];
  for (const f of changedFiles) {
    for (const p of config.guardrails.protectedPaths) {
      const frag = p.replace(/\*/g, '');
      if (f.includes(frag)) {
        out.push(v('protected-path', `保護パスへの変更: ${f}（規則: ${p}）`, true));
      }
    }
  }
  if (count > config.guardrails.maxChangedFiles) {
    out.push(
      v('too-many-changes', `変更 ${count} 件 > 上限 ${config.guardrails.maxChangedFiles} 件`, true)
    );
  }
  return out;
}
