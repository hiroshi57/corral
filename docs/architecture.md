# Corral アーキテクチャ

```
┌─────────────────────────────────────────────┐
│  ブラウザ（Web ダッシュボード / Vite + React）  │
│  ┌───────────┐  ┌──────────────────────────┐ │
│  │ 司令塔ペイン │  │ ワーカーグリッド（状態カード）│ │
│  │ 指示 / 一括 │  │ 実行中 / 完了 / 要確認 / エラー│ │
│  │ broadcast  │  │ → クリックで端末 & diff 表示  │ │
│  └───────────┘  └──────────────────────────┘ │
└───────────────▲───────────────────┬───────────┘
        REST API │       WebSocket   │ (出力ストリーム/状態push)
┌───────────────┴───────────────────▼───────────┐
│  Corral デーモン（ローカル / Node + Express + ws）│
│  ┌────────────┐ ┌───────────┐ ┌─────────────┐ │
│  │ SessionMgr  │ │ WorktreeM │ │ AgentRegistry│ │
│  │ 生成/監視/停止│ │ git worktree│ │ claude/codex │ │
│  └─────┬──────┘ └─────┬─────┘ └─────────────┘ │
│        │  spawn        │ git worktree add/remove  │
│  ┌─────▼──────────────▼──────────────────────┐ │
│  │ Runner（ProcessRunner / DemoRunner 切替）    │ │
│  └────────────────────────────────────────────┘ │
└──────────────────┬────────────────────────────┘
                   │ child_process.spawn
        ┌──────────▼──────────┐
        │ claude / codex CLI  │ ← 各 worktree 内で実行
        └─────────────────────┘
```

## コンポーネント

### デーモン（`server/`）
- **Express** … REST API（セッション CRUD、broadcast、承認/差し戻し）
- **ws** … WebSocket ハブ。エージェント出力と状態変化をブラウザへ push
- **SessionManager** … セッションのライフサイクル管理（作成→実行→要確認→完了/エラー）
- **WorktreeManager** … `git worktree add/remove`、ブランチ命名、diff 取得
- **AgentRegistry** … `claude` / `codex` などの起動コマンド定義（プロファイル）
- **Runner** … 実行抽象
  - `ProcessRunner` … `child_process.spawn` で実エージェントを起動（クロスプラットフォーム）
  - `DemoRunner` … エージェント未インストールでも動くデモ（`CORRAL_DEMO=1`）

### Web（`web/`）
- Vite + React + TypeScript + Tailwind
- xterm.js … 端末出力表示
- WebSocket クライアント … リアルタイム反映
- 全 UI 日本語

## セッション状態遷移

```
queued → running → (needs_review | error) → done
                 ↑____ broadcast/追加指示 ____|
```

- `needs_review` … 変更あり、人間の承認待ち（auto モードなら自動で `done` へ）
- 承認 = worktree の変更を commit（checkpoint）
- 差し戻し = 追加指示を送って `running` に戻す

## セキュリティ / 前提
- **ローカル専用**（127.0.0.1 バインド）。リモート公開は将来課題（herdr/orca 参照）。
- 実行はユーザー権限の CLI エージェントに委譲。Corral 自体は鍵・トークンを保持しない。
