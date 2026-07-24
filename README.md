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
| 📣 broadcast | 全ワーカーへ一斉指示 | uzi |
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
| `CORRAL_CUSTOM_CMD` | `echo` | `custom` エージェントのコマンド |

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
3. 追加の共通指示は **📣 broadcast** で全員へ一斉送信
4. カードをクリックして **端末出力** と **差分** を確認
5. 問題なければ **✓ 承認して commit**、直したければ追加指示で差し戻し

---

## ロードマップ（将来）

- diff へのインラインコメント（Vibe Kanban）
- カンバンでの計画ボード（Vibe Kanban）
- PR 自動作成・マージ（Vibe Kanban / uzi）
- 埋め込みブラウザでのプレビュー（Orca / Vibe Kanban）
- リモート SSH・どこからでも接続（herdr / Orca）
- プラグイン機構・公開 API（herdr）

## ライセンス

MIT
