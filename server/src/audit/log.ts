// 監査ログ + SIEM 連携（大企業要件）
// - 全操作を構造化して記録（誰が/いつ/何を/結果）
// - JSONL ファイルへ追記（改ざん検知は将来: ハッシュチェーン化）
// - SIEM(Splunk HEC / Datadog / 汎用) へ HTTP Webhook 転送
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { AuditEvent } from '../types.js';

class AuditLog {
  private mem: AuditEvent[] = [];
  private ready = false;

  private ensure(): void {
    if (this.ready) return;
    try {
      fs.mkdirSync(path.dirname(config.audit.file), { recursive: true });
    } catch {
      /* ignore */
    }
    this.ready = true;
  }

  record(e: Omit<AuditEvent, 'ts'> & { ts?: number }): AuditEvent {
    const event: AuditEvent = { ts: e.ts ?? Date.now(), ...e } as AuditEvent;
    if (!config.audit.enabled) return event;
    this.ensure();

    // メモリ（API用リングバッファ）
    this.mem.push(event);
    if (this.mem.length > config.audit.maxInMemory) this.mem.shift();

    // 永続化（JSONL 追記）
    try {
      fs.appendFileSync(config.audit.file, JSON.stringify(event) + '\n');
    } catch {
      /* 失敗しても致命ではない */
    }

    // SIEM 転送（非同期・失敗は握りつぶす）
    void this.forward(event);
    return event;
  }

  private async forward(event: AuditEvent): Promise<void> {
    const url = config.audit.siemWebhook;
    if (!url) return;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const h = config.audit.siemAuthHeader;
      if (h.includes(':')) {
        const idx = h.indexOf(':');
        headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
      }
      await fetch(url, {
        method: 'POST',
        headers,
        // Splunk HEC は {event: ...}、多くの SIEM は素の JSON を受ける。両対応で event をラップ
        body: JSON.stringify({ source: 'corral', event }),
      });
    } catch {
      /* ネットワーク失敗は無視（ローカルJSONLには残る） */
    }
  }

  list(filter?: { workspaceId?: string; action?: string; limit?: number }): AuditEvent[] {
    let out = this.mem;
    if (filter?.workspaceId) out = out.filter((e) => e.workspaceId === filter.workspaceId);
    if (filter?.action) out = out.filter((e) => e.action.startsWith(filter.action!));
    const lim = filter?.limit ?? 500;
    return out.slice(-lim).reverse();
  }

  exportNdjson(workspaceId?: string): string {
    const rows = workspaceId ? this.mem.filter((e) => e.workspaceId === workspaceId) : this.mem;
    return rows.map((e) => JSON.stringify(e)).join('\n');
  }

  siemConnected(): boolean {
    return !!config.audit.siemWebhook;
  }
}

export const audit = new AuditLog();
