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
- **Runner** … 実行抽象（1回のエージェント起動＝1 Runner）
  - `ProcessRunner` … `child_process.spawn` で実エージェントを起動（クロスプラットフォーム）
    - プロンプトは **stdin かファイル経由**でのみ渡し、argv/シェルに載せない（インジェクション対策）
    - POSIX は `shell:false`、Windows のみ `.cmd` 解決のため shell を使うが argv にユーザー文字列が無く安全
  - `DemoRunner` … エージェント未インストールでも動くデモ（`CORRAL_DEMO=1`）。worktree に実ファイルを書くため diff/変更数/commit が実体を持つ

### Web（`web/`）
- Vite + React + TypeScript + Tailwind
- xterm.js … 端末出力表示
- WebSocket クライアント … リアルタイム反映
- 全 UI 日本語

## セッション状態遷移

```
queued → running → (needs_review | error) → done
                 ↑__ 追加指示 = 継続run(--continue/resume) __|
```

- `needs_review` … 変更あり、人間の承認待ち（auto モードなら自動で `done` へ）
- 承認 = worktree の変更を commit（checkpoint）
- **追加指示 / broadcast / 差し戻し** … stdin 注入ではなく **継続run** で反映する。
  - 実行中に届いた指示は `pendingFollowups` に積み、現ラン終了後に順次 継続run として流す
  - `turns`（指示履歴）を保持し、継続非対応エージェントには文脈を結合して渡す

## セキュリティ / 前提
- **ローカル専用**（既定 127.0.0.1 バインド）だが、無防備にはしない：
  - **Host ヘッダ検証**（loopback のみ許可）→ DNS リバインディング攻撃を遮断
  - **トークンヘッダ `x-corral-token`**（health 以外の /api 必須）→ 他プロセス/CSRF を遮断
  - **CORS はダッシュボードのオリジンのみ許可**。カスタムヘッダ要求により許可外オリジンは
    プリフライトで遮断される
  - **WebSocket** も Origin / Host をハンドシェイクで検証
- **プロンプトはコマンドラインに載せない**（stdin/ファイル経由）→ シェルインジェクション不可
- 実行はユーザー権限の CLI エージェントに委譲。トークンは起動時に生成し `.corral/token` で
  ダッシュボード（Vite プロキシ）と共有、本番は HTML に注入。
- リモート公開は将来課題（herdr/orca 参照）。
