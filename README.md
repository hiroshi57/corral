# 🐎 Corral（コラル）

> **Claude Code / Codex の複数エージェントを、一つの司令塔から統率するマルチペイン・オーケストレーター。**
> ターミナルのタブを行き来する必要はもうありません。メインの「司令塔ペイン」で指示を出し、あとは結果を待つだけ。

海外の同種ツール（[Orca](https://www.onorca.dev/) / [herdr](https://herdr.dev/) / Claude Squad / uzi / Vibe Kanban / Crystal / Conductor）の機能を統合し、**Web ダッシュボード型**として **日本語化** したものです。
各ツールの調査・比較は [docs/research.md](docs/research.md) を参照してください。

---

## 何ができるか

| 機能 | 説明 | 由来 |
|------|------|------|
| 🎯 司令塔ペイン | 1画面から指示出し。結果を待つだけ | onorca / herdr |
| 🌳 worktree 隔離 | 各エージェントが専用の git worktree・ブランチで並列実行。衝突なし | 全ツール共通 |
| 🔢 台数指定の一括起動 | `Claude ×3` のようにまとめて起動 | uzi |
| 📣 broadcast | 全ワーカーへ一斉指示（継続runとして反映。実行中の分は完了後に順次消化） | uzi |
| 👀 状態の一覧可視化 | 実行中 / 要確認 / 完了 / エラーを一目で | herdr |
| 📝 差分レビュー → 承認 | diff を確認して commit（checkpoint） | Claude Squad / Vibe Kanban |
| 🤖 自動承認(yolo) | 確認を自動で通しバックグラウンド完了 | Claude Squad / uzi |
| 🔀 複数エージェント対応 | Claude Code / Codex / Gemini / Aider | 全ツール共通 |

---

## クイックスタート

```bash
npm install
npm run dev
```

- デーモン: http://127.0.0.1:4319
- ダッシュボード: http://127.0.0.1:5319

初回は **DEMO モード**（エージェント未インストールでも疑似実行で UI を体験できる）で起動します。

### 実エージェントを動かす

`claude` / `codex` などの CLI がインストール済みなら、対象リポジトリを指定して本番モードで起動します。

```bash
# 例：あるリポジトリを対象にする
CORRAL_DEMO=0 CORRAL_REPO=/path/to/your/repo npm run server
# 別ターミナルで
npm run web
```

---

## 環境変数

| 変数 | 既定 | 説明 |
|------|------|------|
| `CORRAL_PORT` | `4319` | デーモンのポート |
| `CORRAL_HOST` | `127.0.0.1` | バインドホスト（ローカル専用） |
| `CORRAL_DEMO` | `1` | `0` で実エージェント起動モード |
| `CORRAL_REPO` | カレント | 対象リポジトリのルート |
| `CORRAL_WORKTREE_BASE` | `.corral/worktrees` | worktree 作成先 |
| `CORRAL_TOKEN` | 自動生成 | API トークン。未指定なら起動時に生成し `.corral/token` へ書き出す |
| `CORRAL_CUSTOM_CMD` | `cat` | `custom` エージェントのコマンド |

### セキュリティ

ローカル専用ツールですが、無防備にはしていません。

- **Host ヘッダ検証**（loopback のみ）で **DNS リバインディング**を遮断
- **トークンヘッダ**（`x-corral-token`）で health 以外の API を保護（CSRF/他プロセス対策）
- **CORS** はダッシュボードのオリジンのみ許可、**WebSocket** も Origin/Host を検証
- **プロンプトは argv/シェルに載せず** stdin・ファイル経由でのみ渡すため、`$(...)` 等の
  シェルインジェクションは構造的に起きない
- トークンは Vite プロキシ（開発）／HTML注入（本番）でダッシュボードへ安全に受け渡し

---

## 構成

```
corral/
├─ server/   … デーモン（Express + WebSocket + node child_process + git worktree）
├─ web/      … ダッシュボード（Vite + React + TypeScript + Tailwind）
└─ docs/     … 調査資料・アーキテクチャ
```

詳細は [docs/architecture.md](docs/architecture.md)。

---

## 使い方の流れ

1. **司令塔** にタスクを書いてエージェントと台数を選び「▶ 起動」
2. 各ワーカーが worktree で並列実行 → カードの状態が **実行中 → 要確認** に変化
3. 追加の共通指示は **📣 broadcast** で全員へ一斉送信（各ワーカーの会話を継続する形で反映。実行中なら完了後に順次適用）
4. カードをクリックして **端末出力** と **差分** を確認
5. 問題なければ **✓ 承認して commit**、直したければ追加指示で差し戻し（`--continue` / `exec resume` で文脈を保持したまま継続）

---

## 外販化プラン / エンタープライズ

- SaaS 化の追加機能30提案・ロードマップ・価格プラン: [docs/productization.md](docs/productization.md)
- **エンタープライズ導入（自己ホスト/VPC・隔離実行・ガードレール・SSO/RBAC）**: [docs/enterprise-deploy.md](docs/enterprise-deploy.md)
- 自己ホストは `docker compose up -d --build`（[Dockerfile](Dockerfile) / [docker-compose.yml](docker-compose.yml)）

## ロードマップ（将来）

- diff へのインラインコメント（Vibe Kanban）
- カンバンでの計画ボード（Vibe Kanban）
- PR 自動作成・マージ（Vibe Kanban / uzi）
- 埋め込みブラウザでのプレビュー（Orca / Vibe Kanban）
- リモート SSH・どこからでも接続（herdr / Orca）
- プラグイン機構・公開 API（herdr）

## ライセンス

MIT
