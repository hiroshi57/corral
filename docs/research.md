# 調査資料：AIコーディング・エージェント オーケストレーションツール

> Corral の設計にあたり、海外の同種ツールを調査し、機能を日本語で要約・統合したもの。
> 調査日：2026-07-24 / 出典は各ツールの公式 README・LP。

## 背景・共通コンセプト

Claude Code / Codex / Gemini CLI などの「CLIエージェント」を **複数同時に動かす** 需要が急増している。
これらのツールに共通するのは次のパターン：

1. **git worktree による隔離** — 各エージェントが専用のブランチ・作業ツリーで動くので衝突しない
2. **セッション多重化** — tmux / PTY で複数エージェントのターミナルを1画面に集約
3. **司令塔からの指示 → 待つだけ** — 人間はタブを行き来せず、指示出しとレビューに集中
4. **差分レビュー & 承認** — 適用前に diff を確認、まとめてマージ/PR

Corral はこれら7ツールの機能を統合し、**Webダッシュボード型**で日本語化したもの。

---

## 調査した7ツール

### 1. Orca（onorca.dev） / Stably, Inc.
- **形態**：デスクトップアプリ（ADE = Agent Development Environment）、MIT、macOS/Windows/Linux
- **特徴**：
  - **worktree-first** — 各エージェントが独立した git worktree で並列実行（例：Claude Code が認証、Codex が API、OpenCode がフロントを同時進行）
  - Ghostty級の高速ターミナル内蔵
  - アプリ内 diff レビュー
  - 埋め込みブラウザ（プレビュー）
  - リモート SSH 開発
- **Corral が取り込む点**：worktree-first の並列思想、アプリ内 diff レビュー、プレビュー

### 2. herdr（herdr.dev）
- **形態**：単一バイナリ（アプリではない）、"tmux for coding agents"
- **特徴**：
  - **エージェント・マルチプレクサ** — 1つのターミナルで群れ全体を操作
  - **agent state at a glance** — 各エージェントの状態を一目で把握
  - エージェントが動いている場所で動く（ノートを閉じても死なない、どこからでも SSH）
  - プラグイン機構、API 提供
- **Corral が取り込む点**：状態の一覧可視化（ダッシュボードのカードUI）、常駐デーモン化、API

### 3. Claude Squad（github.com/smtg-ai/claude-squad）
- **形態**：ターミナルアプリ（TUI）、AGPL-3.0、`cs` コマンド
- **特徴**：
  - Claude Code / Codex / Gemini / Aider を別ワークスペースで管理
  - **バックグラウンド完了**（yolo / auto-accept モード）
  - **適用前レビュー** — 変更を確認してから apply、push 前に checkout
  - 各タスクが独立 git worktree で衝突なし
  - `tmux` + `git worktrees` + シンプル TUI
  - プロファイル機能（claude / codex / aider を切替）
- **Corral が取り込む点**：auto-accept モード、適用前レビュー、プロファイル（エージェント切替）

### 4. uzi（github.com/devflowinc/uzi）
- **形態**：CLI（Go 製）
- **特徴**：
  - **一括起動**：`uzi prompt --agents claude:3,codex:2 "タスク"` で複数エージェントを台数指定で起動
  - **broadcast**：`uzi broadcast "追加指示"` で全エージェントへ一斉指示
  - **auto**：`uzi auto` が確認プロンプトを自動 Enter
  - **watch**：`uzi ls -w` でリアルタイム監視
  - **checkpoint**：`uzi checkpoint <name> "commit msg"` で完了物をマージ
  - worktree + tmux + 開発サーバのポート自動割当
- **Corral が取り込む点**：★中核。台数指定の一括起動、broadcast、auto-confirm、watch、checkpoint

### 5. Vibe Kanban（github.com/BloopAI/vibe-kanban）※サンセット予定
- **形態**：Web（`npx vibe-kanban`）、Rust + Node
- **特徴**：
  - **カンバンで計画** — issue を作成・優先度付け・アサイン
  - **ワークスペース実行** — 各ワークスペースにブランチ・ターミナル・開発サーバ
  - **diff レビュー + インラインコメント** — UIを離れずエージェントへフィードバック
  - 埋め込みブラウザ（devtools・inspect・デバイスエミュレーション）
  - **10種以上のエージェント切替**（Claude Code, Codex, Gemini, Copilot, Amp, Cursor, OpenCode, Droid, CCR, Qwen）
  - PR 作成（AI生成の説明文）とマージ
- **Corral が取り込む点**：計画（カンバン/タスクボード）、diff へのインラインコメント、PR 作成、幅広いエージェント対応

### 6. Crystal → Nimbalyst（github.com/stravu/crystal）※Crystal は2026-02に非推奨化
- **形態**：デスクトップ（Electron）
- **特徴（後継 Nimbalyst）**：
  - 人間 + AI 協働のワークスペース
  - エージェントの編集を **エディタへリアルタイムにストリーミング**
  - コード / Markdown / 表 / 図の複数エディタ環境
  - git worktree 隔離で安全な並列 AI コーディング
  - プロジェクト単位のワークスペース管理・AIセッション追跡
- **Corral が取り込む点**：編集のリアルタイム反映、セッション追跡

### 7. Conductor（conductor.build）
- **形態**：Mac アプリ
- **特徴**：複数の Claude Code エージェントを並列実行、タスクごとにワークスペース隔離
- **Corral が取り込む点**：タスク単位のワークスペース分離という UX

---

## 統合機能マップ（Corral の機能一覧）

| 機能 | 由来 | Corral MVP | 将来 |
|------|------|:---:|:---:|
| worktree による隔離実行 | 全ツール | ✅ | |
| 司令塔ペイン（指示入力） | onorca/herdr のコンセプト | ✅ | |
| ワーカー状態の一覧カード | herdr | ✅ | |
| 台数指定の一括起動（claude:N, codex:M） | uzi | ✅ | |
| broadcast（全員/選択へ一斉指示） | uzi | ✅ | |
| リアルタイム出力ストリーミング | 全ツール | ✅ | |
| auto-accept / yolo モード | squad, uzi | ✅ | |
| 適用前の diff レビュー | squad, orca, vibe | ✅ | |
| 承認 / 差し戻し（checkpoint） | squad, uzi, vibe | ✅ | |
| Claude Code / Codex 両対応 | 全ツール | ✅ | |
| プロファイルでエージェント切替 | squad, vibe | ✅ | |
| diff へのインラインコメント | vibe | | ✅ |
| カンバンでの計画 | vibe | | ✅ |
| PR 作成（AI説明文） | vibe, uzi | | ✅ |
| 埋め込みブラウザ・プレビュー | orca, vibe | | ✅ |
| リモート SSH / どこからでも接続 | herdr, orca | | ✅ |
| プラグイン機構・公開API | herdr | | ✅ |

---

## 設計上の学び

- **tmux 依存を避ける**：squad/uzi/herdr は tmux 前提だが、Windows では動きにくい。Corral は Node の子プロセス/PTY 抽象で**クロスプラットフォーム**にする。
- **worktree が事実上の標準**：隔離は git worktree で行うのが業界共通解。Corral も踏襲。
- **人間の仕事は「計画」と「レビュー」に集約される**（Vibe Kanban の主張）：Corral の UI もこの2点を主役に据える。
- **broadcast と watch が「タブ往復をなくす」核**（uzi）：Corral の司令塔ペインの中心機能とする。
