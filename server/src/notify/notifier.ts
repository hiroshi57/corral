// ① 通知: セッションの節目を Chatwork / Slack / アプリ内へ送る
import { config } from '../config.js';
import type { NotifyEvent, SessionStatus } from '../types.js';

const STATUS_LABEL: Partial<Record<SessionStatus, string>> = {
  needs_review: '要確認（レビュー待ち）',
  done: '完了',
  error: 'エラー',
  stopped: '停止',
};

const STATUS_MARK: Partial<Record<SessionStatus, string>> = {
  needs_review: '👀',
  done: '✅',
  error: '❌',
  stopped: '⏹️',
};

/** Chatwork へ送信 */
async function sendChatwork(message: string): Promise<boolean> {
  const { chatworkToken, chatworkRoom } = config.notify;
  if (!chatworkToken || !chatworkRoom) return false;
  try {
    const res = await fetch(`https://api.chatwork.com/v2/rooms/${chatworkRoom}/messages`, {
      method: 'POST',
      headers: {
        'X-ChatWorkToken': chatworkToken,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ body: message }).toString(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Slack Incoming Webhook へ送信 */
async function sendSlack(message: string): Promise<boolean> {
  const url = config.notify.slackWebhook;
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface NotifyInput {
  sessionId: string;
  title: string;
  status: SessionStatus;
  branch: string | null;
  demo: boolean;
}

/**
 * 通知を送信し、結果イベントを返す（呼び出し側が WS で配信 & ログ化）。
 * DEMO や未設定チャネルでは外部送信せず、アプリ内通知のみになる。
 */
export async function notify(input: NotifyInput): Promise<NotifyEvent> {
  const label = STATUS_LABEL[input.status] ?? input.status;
  const mark = STATUS_MARK[input.status] ?? '🔔';
  const message =
    `[Corral] ${mark} ${label}\n` +
    `タスク: ${input.title}\n` +
    (input.branch ? `ブランチ: ${input.branch}\n` : '') +
    `司令塔で結果を確認してください。`;

  const channels: string[] = ['app']; // アプリ内は常に
  if (!input.demo) {
    if (await sendChatwork(message)) channels.push('chatwork');
    if (await sendSlack(message)) channels.push('slack');
  }

  return {
    ts: Date.now(),
    sessionId: input.sessionId,
    title: input.title,
    status: input.status,
    channels,
    message,
  };
}

/** 設定済みの外部チャネル一覧（UI 表示用） */
export function configuredChannels(): string[] {
  const out: string[] = [];
  if (config.notify.chatworkToken && config.notify.chatworkRoom) out.push('chatwork');
  if (config.notify.slackWebhook) out.push('slack');
  return out;
}
