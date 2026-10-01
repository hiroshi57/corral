# Corral エンタープライズ導入ガイド（P3）

> 対象: 情シス / SRE / セキュリティ担当。社内ネットワーク内での自己ホスト、
> データ主権、隔離実行、アクセス制御を満たす構成。

## この文書がカバーする P3 機能

| # | 機能 | 実装状況 |
|---|------|---------|
| #4 | マルチリポ（案件が複数リポを持つ） | ✅ アプリ実装済（案件ごとにリポ登録 → タスクで対象を選択） |
| #20 | ポリシーガードレール | ✅ アプリ実装済（禁止コマンド/保護パス/機密漏洩/大量変更を検知しブロック） |
| #5 | クラウド/リモート実行（SSH） | ⚙️ 実行モード抽象＋SSHランナー実装済（到達可能な SSH ホストが必要） |
| #18 | サンドボックス実行（Docker） | ⚙️ Dockerランナー実装済（Docker と agent イメージが必要） |
| #19 | オンプレ/VPC・データ主権 | ✅ Dockerfile + docker-compose + 本ガイド |

> ⚙️ = コード・設定は本番同等だが、実走にはインフラ（Docker/SSH）が必要。

---

## 1. 自己ホスト（#19 オンプレ/VPC）

外部 SaaS に一切依存せず、社内ネットワーク内で完結します。

```bash
# .env を用意（API トークンとセッション署名鍵は必ず別の値にする）
echo "CORRAL_TOKEN=$(openssl rand -hex 24)" > .env
echo "CORRAL_SESSION_SECRET=$(openssl rand -hex 32)" >> .env

# 対象リポジトリを ./repos/ 配下に配置（例: ./repos/main）
git clone <社内リポ> repos/main

docker compose up -d --build
# ダッシュボード: http://127.0.0.1:4319
```

- **データ主権**: worktree・ログ・セッションはすべてコンテナ/ボリューム内。外部送信は通知(Chatwork/Slack)と SSO を明示設定した場合のみ。
- **エアギャップ**: 通知・SSO を未設定にすれば完全オフライン動作（アプリ内通知のみ）。
- **国内リージョン**: 任意の国内 IaaS / オンプレ VM に compose をそのまま配置。

## 2. アクセス制御（既出 ④⑤ の再掲）

- **ネットワーク**: 既定はループバック公開。社内公開時のみ `CORRAL_HOST=0.0.0.0` とし、リバースプロキシ(TLS)を前段に置く。
- **Host 検証**: DNS リバインディング対策で loopback/指定ホストのみ許可。
- **認証**: `x-corral-token`（マシン/管理）＋ SSO(Google OIDC)／dev ログイン。
- **RBAC**: owner/admin/member/viewer。案件（ワークスペース）単位でメンバーとロールを管理。

## 3. 隔離実行（#5 / #18）

`CORRAL_EXEC_MODE` で実行基盤を切り替えます。

### local（既定）
デーモンと同一ホストで子プロセス実行。プロンプトは argv/シェルに載せず stdin/ファイル経由（インジェクション不可）。

### docker（#18 サンドボックス）
```bash
CORRAL_EXEC_MODE=docker
CORRAL_DOCKER_IMAGE=corral/agent:latest   # claude/codex 等を含む実行イメージ
CORRAL_DOCKER_NETWORK=none                 # ネットワーク遮断で情報持ち出し防止
CORRAL_DOCKER_MEMORY=2g
CORRAL_DOCKER_CPUS=2
```
- 各エージェントを **`--network none` / 非root / リソース制限 / worktree のみマウント** のコンテナで隔離実行。
- `corral/agent` イメージは各エージェント CLI（`claude`/`codex` 等）を含めて自作。

### ssh（#5 リモート/クラウド実行）
```bash
CORRAL_EXEC_MODE=ssh
CORRAL_SSH_HOST=user@build-runner.internal
CORRAL_SSH_REMOTE_ROOT=~/corral-work
```
- 実行をビルドサーバ/クラウドへ委譲。**手元PCを閉じても継続**（herdr 的）。
- 鍵は SSH エージェント/既存の鍵管理に委譲（Corral はトークン/鍵を保持しない）。

## 4. ポリシーガードレール（#20）

```bash
CORRAL_GUARDRAILS=1
CORRAL_DENY_COMMANDS='rm\s+-rf\s+/,git\s+push\s+--force,DROP\s+TABLE,curl\s+[^|]*\|\s*(ba)?sh'
CORRAL_PROTECTED_PATHS='.env,.git/,secrets/,id_rsa,*.pem'
CORRAL_MAX_CHANGED_FILES=200
```
- **起動前**: プロンプトに禁止コマンドが含まれれば起動を拒否。
- **実行中**: 出力の機密（APIキー/トークン/秘密鍵）を検出し、ログを自動マスキング。
- **承認前**: 保護パスへの変更や大量変更を検出したら commit をブロック（手動確認へ）。

## 5. 監査・FinOps

- 監査ログ（誰がいつ何を指示/承認したか）＝アプリ内ログ＋通知履歴。SIEM 連携は Webhook で拡張可能（ロードマップ）。
- FinOps: 案件ごとのトークン/コストを計測、予算アラート／ハードキャップで暴走コストを抑止。

## 6. 本番前チェックリスト

- [ ] `CORRAL_TOKEN` を強固な値に設定
- [ ] `CORRAL_SESSION_SECRET` を `CORRAL_TOKEN` とは別の強固な値に設定（必須）
- [ ] TLS リバースプロキシを前段に配置（社内公開時）
- [ ] SSO(SAML/OIDC) を有効化（dev ログインは本番では既定で無効）
- [ ] `CORRAL_EXEC_MODE=docker` でサンドボックス化（機密リポの場合）
- [ ] ガードレールの保護パス/禁止コマンドを自社ポリシーに合わせて調整
- [ ] 予算（`CORRAL_BUDGET_USD`）とハードキャップを設定

---

## 7. 認証まわりの既定値（セキュリティ上の前提）

本番(`CORRAL_DEMO=0`)では、安全側の既定値を採用しています。

| 項目 | 既定 | 理由 |
|------|------|------|
| dev ログイン（メール入力のみ） | **無効** | 到達できる誰もがログインできる状態を避ける。使う場合は `CORRAL_DEV_LOGIN=1` を明示 |
| 新規ユーザーの既定案件への自動参加 | **無効** | ログインしただけで `member`（セッション作成権限あり）になる状態を避ける。`member:manage` 権限を持つ者が招待する |
| ダッシュボード HTML へのトークン注入 | **ループバックのみ** | リモート公開時に未認証の閲覧者がオーナー権限を取得することを防ぐ |
| セッション署名鍵 | `CORRAL_SESSION_SECRET`（API トークンと分離） | 共用するとトークン保持者が任意ユーザーのセッションを偽造でき RBAC が無効化される |
| WebSocket | **認証必須・案件スコープ配信** | 未認証接続に全案件のセッションとログが流れるのを防ぐ |

### リモート公開時の初期セットアップ

HTML へのトークン注入がループバック限定になったため、リモートからの初回ログインは
次のいずれかで行います。

1. **SSO を設定する**（推奨）: `CORRAL_SAML_*` または `CORRAL_GOOGLE_*` を設定
2. **API でユーザーを招待する**: サーバ上（ループバック）から `x-corral-token` を付けて
   `POST /api/workspaces/members` を呼び、ロール付きでユーザーを登録する
3. 評価用に限り `CORRAL_DEV_LOGIN=1` を明示的に有効化する（本番非推奨）
