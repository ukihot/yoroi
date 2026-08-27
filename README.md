# Yoroi

構成管理Bot "Yoroi" — GitHub App + Deno Deploy + PostgreSQL のイベント駆動コントロールプレーン。設計の背景は
[doc/requirements.md](doc/requirements.md)、実装詳細は [doc/design.md](doc/design.md) を参照。

このリポジトリは3つの実行単位で構成される。

| ディレクトリ                           | 役割                                                                            | 詳細                   |
| -------------------------------------- | ------------------------------------------------------------------------------- | ---------------------- |
| このディレクトリ(`src/`)               | `yoroi-console` — SvelteKit製の管理UI。マージ権限は持たない                     | このREADME             |
| [apps/control](apps/control/README.md) | `yoroi-control` — GitHub webhook受信、Policy Engine、状態機械、Serial Scheduler | apps/control/README.md |
| [apps/merger](apps/merger/README.md)   | `yoroi-merger` — 署名済みDecision Envelopeを検証し、実際にmergeする唯一のアプリ | apps/merger/README.md  |

3つは別々のDeno Deployアプリとしてデプロイし、`yoroi-merger`だけを別GitHub App・別権限にする(design.md §2.2)。

## 現在のデプロイ状態

| アプリ        | URL                                   | DBマイグレーション                                 |
| ------------- | ------------------------------------- | -------------------------------------------------- |
| yoroi-control | https://yoroi-control.vanjis.deno.net | 適用済み(`packages/postgres/src/migrations/`)      |
| yoroi-merger  | https://yoroi-merger.vanjis.deno.net  | (yoroi-controlと同じDBを参照するのみ、独自DDLなし) |
| yoroi-console | https://yoroi-console.vanjis.deno.net | 適用済み(`drizzle/`、Better Auth用)                |

webhook受信先: `https://yoroi-control.vanjis.deno.net/github/webhook`(GitHub Observer Appに設定済み)

各アプリの本番シークレットは `apps/control/.env.production` / `apps/merger/.env.production` /
`.env.production`(ルート、console用)にある。**すべて`.gitignore`の`.env.*`で除外済み**
(`.env.example`/`.env.test`だけ例外)— コミットされない。中身は各Deno Deployアプリの
Settings → Environment Variables(Production context)に貼り付け済みのものと同じ。

**まだやっていないこと**: `yoroi-merger`に実マージ権限を渡す前提のShadow mode運用・Go/No-Go判定
(下記「[安全に有効化する](#安全に有効化する)」参照)。現状は動作確認止まり。

## アーキテクチャ

```
GitHub (Observer App) --webhook--> yoroi-control  --署名付きenvelope--> yoroi-merger --merge--> GitHub (Merger App)
                                         ^
                                         | HTTP API
                                    yoroi-console (人間がログインして見る画面)
```

- `yoroi-control` と `yoroi-merger` は別のGitHub App・別のDeno Deployアプリ。同じにすると
  「controlを乗っ取られたらmergeもできてしまう」構成になり、design.mdが最重要視している分離が壊れる
  (design.md §2.2, §19.3)。
- 3アプリとも同じPostgreSQLに繋ぐが、`yoroi-console`だけは直接DBに繋がず、必ず`yoroi-control`のAPI経由
  (design.md §2.2)。console自身のBetter Auth(ログイン)用DBだけは別。

## ローカル開発

```sh
deno install                       # 依存関係のインストール(package.jsonのnpmスクリプトも動く)
cp .env.example .env               # ルート(console)用。DATABASE_URL / ORIGIN / BETTER_AUTH_SECRET / GITHUB_CLIENT_* を編集
cp apps/control/.env.example apps/control/.env   # DATABASE_URL等を編集(Docker不要、既存のPostgresがあればそれでよい)
cp apps/merger/.env.example apps/merger/.env     # 同上。YOROI_MERGER_DEV=1にしてYOROI_MERGER_SHARED_TOKENをconsole側と揃える
cd apps/control && deno task migrate && cd ../..  # packages/postgresのスキーマを一度だけ適用

npm run dev                        # apps/control(:8787)・apps/merger(:8788)・console(:5173)をまとめて起動
```

`npm run dev`は[script/dev.sh](script/dev.sh)を呼ぶだけの薄いラッパー。3つ同時に上げたいだけなので
1コマンドにまとめてある(Ctrl+Cで3つとも停止)。consoleだけを起動したい場合は`npm run dev:console`
(`vite dev`そのもの)。

consoleの`.env`に`YOROI_CONTROL_URL=http://localhost:8787`と`YOROI_CONTROL_API_TOKEN`
(`apps/control/.env`の同名の値と同じもの)を設定すると、ダッシュボードはモック(`mock-control-api.ts`)
ではなくローカルの実エンジンからデータを読む。**ただしログインには動くGitHub OAuth Appが要る**
(`(dashboard)/+layout.server.ts`がセッション無しだと`/login`へリダイレクトする) —
本番用OAuth Appのcallback URLは本番ドメイン固定なので、ローカルで実際にログインしたい場合は
`http://localhost:5173/api/auth/callback/github`向けの別のOAuth Appをもう1つ作るのが手軽。

```sh
npm run test                # vitest
npm run check                # svelte-check
npm run lint                 # prettier --check + eslint
```

`apps/control`・`apps/merger`はDenoアプリなので、それぞれのディレクトリで`deno task dev`/`deno task test`
(詳細は各READMEを参照)。`packages/*`も同様に各ディレクトリ内で`deno task test`。

## 本番リリース手順

GitHubとDeno Deployで「何をどこにいくつ作るか」がわかりにくいので、上から順にやれば終わるように書く。
**作るものは合計6つ**: GitHub App 2つ(Observer/Merger)、GitHub OAuth App 1つ(console ログイン用)、
Deno Deployアプリ3つ(control/merger/console)。

### 事前に用意するもの

- Yoroiを動かしたいGitHub Organization(またはユーザー)の管理者権限
- [Deno Deploy](https://deno.com/deploy) のアカウント(このリポジトリをGitHub連携でデプロイできる状態)
- 本番用PostgreSQL 1つ(Deno Deployダッシュボードから作れる組み込みPostgres、または外部のPostgres
  ホスティング。design.md §22は前者を正式採用としているが、外部でも動く)

### Step 1: GitHub Appを2つ作る

GitHubの **Settings → Developer settings → GitHub Apps → New GitHub App** から作成する(Organizationで
使うなら Organization の Settings から)。**2回**この作業をする。

#### 1-1. Observer App(`yoroi-control`用 — 読み取りと通知だけ)

- GitHub App name: 例 `yoroi-control`(グローバルで一意な名前が必要)
- Homepage URL: 何でもよい(リポジトリのURLなど)
- Webhook: **Active** にチェック
  - Webhook URL: `https://<yoroi-controlをデプロイしたURL>/github/webhook`
  - Webhook secret: ランダムな文字列を生成して控える(→ `GITHUB_WEBHOOK_SECRET`)。
    `openssl rand -hex 32` などで作れる。
- Permissions → Repository permissions:
  - **Contents**: Read-only
  - **Metadata**: Read-only(自動で付く)
  - **Pull requests**: Read and write(PRの読み取り、およびsummaryコメント投稿に必要)
  - **Checks**: Read and write(`yoroi/gate` Check Runの作成・更新に必要)
  - **Commit statuses**: Read-only
  - **Issues**: Read-only(これを付けないと「Issue comment」がSubscribe to eventsの一覧に
    出てこない — GitHubの仕様。`/yoroi`コマンドはPRコメント=issue commentとして届く)
- Subscribe to events(Issues権限を付けた後に一覧へ出てくる — `apps/control/src/routes/webhook.ts`の
  `EVENT_ALLOWLIST`と一致させる): Pull request / Pull request review / Issue comment / Check run /
  Check suite / Status / Push
- **Where can this GitHub App be installed?**: 自分のOrganizationのみでよければ "Only on this account"
- 作成後、**Generate a private key** で`.pem`をダウンロードして控える(→ `GITHUB_APP_PRIVATE_KEY`)。
  App ID(ページ上部)も控える(→ `GITHUB_APP_ID`)。対象リポジトリに **Install App** する。

#### 1-2. Merger App(`yoroi-merger`用 — mergeだけ、これ以外の権限を持たせない)

同じ画面で、名前を変えてもう一つ作る。

- GitHub App name: 例 `yoroi-merger`
- Webhook: **Active のチェックを外す**(yoroi-mergerはwebhookを受け取らない。呼び出されるのは
  yoroi-controlからのみ)
- Permissions → Repository permissions: **Contents**: Read and write / **Pull requests**: Read and
  write / **Metadata**: Read-only(自動)— これ以外は付けない
- Subscribe to events: 何もチェックしない
- Install App: Observer Appと同じリポジトリにインストール
- Generate a private key → 控える(→ `MERGER_GITHUB_APP_PRIVATE_KEY`)。App IDも控える
  (→ `MERGER_GITHUB_APP_ID`)。

**この2つのApp IDと秘密鍵を混同しないこと。** yoroi-control側にMerger Appの鍵を置いてしまうと、
分離した意味がなくなる。

### Step 2: console ログイン用のGitHub OAuth App(上の2つとは別物)

`yoroi-console`のログイン(Better Auth)はGitHub Appではなく、**GitHub OAuth App**を使う。
**Settings → Developer settings → OAuth Apps → New OAuth App** で作成する。

- Homepage URL: `https://<consoleをデプロイしたURL>`
- Authorization callback URL: `https://<consoleをデプロイしたURL>/api/auth/callback/github`
- 作成後、Client ID / Client secret を控える(→ `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`)

### Step 3: Deno Deployにアプリを3つ作る

[Deno Deploy](https://dash.deno.com)にログインし、このGitHubリポジトリと連携する。**New App**を3回
作成し、それぞれRoot directory(リポジトリ内のどのディレクトリを動かすか)を分ける。

| Deno Deployアプリ | Root directory         | エントリポイント |
| ----------------- | ---------------------- | ---------------- |
| yoroi-control     | `apps/control`         | `main.ts`        |
| yoroi-merger      | `apps/merger`          | `main.ts`        |
| yoroi-console     | `/`(リポジトリルート） | SvelteKit        |

3アプリとも、Deno Deployダッシュボードの **Database** タブから同じPostgresを1つ紐付ける
(design.md §22)。`yoroi-console`は直接DBを使わないが、Better Auth用に別の(または同じ)Postgresが必要。

各アプリの **Settings → Environment Variables** で、**Production** contextに以下を設定する。

**yoroi-control**(詳細は`apps/control/.env.example`):

```
DATABASE_URL=...
YOROI_CONTROL_API_TOKEN=...           # consoleと共有する長いランダム文字列
GITHUB_APP_ID=...                     # Step 1-1
GITHUB_APP_PRIVATE_KEY=...            # Step 1-1
GITHUB_WEBHOOK_SECRET=...             # Step 1-1
YOROI_MERGER_URL=https://<yoroi-mergerのURL>
YOROI_MERGER_SHARED_TOKEN=...         # yoroi-mergerと全く同じ値(下記)
```

**yoroi-merger**(詳細は`apps/merger/.env.example`):

```
DATABASE_URL=...                      # yoroi-controlと同じPostgres
MERGER_GITHUB_APP_ID=...              # Step 1-2
MERGER_GITHUB_APP_PRIVATE_KEY=...     # Step 1-2
YOROI_MERGER_SHARED_TOKEN=...         # 上のyoroi-controlと全く同じ値
YOROI_MERGER_PRODUCTION=1             # 必須。無いとmain.tsが起動を拒否する(下記トラブルシューティング参照)
```

**yoroi-console**(詳細はルートの`.env.example`):

```
DATABASE_URL=...                      # Better Auth用のPostgres(上記2つとは別のものでよい)
ORIGIN=https://<consoleのURL>
BETTER_AUTH_SECRET=...                # ランダムな32文字以上
GITHUB_CLIENT_ID=...                  # Step 2
GITHUB_CLIENT_SECRET=...              # Step 2
YOROI_CONTROL_URL=https://<yoroi-controlのURL>
YOROI_CONTROL_API_TOKEN=...           # yoroi-controlと全く同じ値
```

### Step 4: DBマイグレーション

各アプリをデプロイ後、ローカルから本番の`DATABASE_URL`を指定して実行する。**consoleは2段階ある**
(Better Authのスキーマは自動生成されないため、忘れるとログインが動かない)。

```sh
# yoroi-control / yoroi-merger が使う共通スキーマ(packages/postgres)
cd apps/control
DATABASE_URL="<本番のURL>" deno task migrate

# console(Better Auth)側 — 初回だけ auth:schema が必要
cd ../..
npm run auth:schema                              # src/lib/server/db/auth.schema.ts を生成(DB不要)
DATABASE_URL="<consoleのURL>" npm run db:generate # drizzle/ にSQLを生成
DATABASE_URL="<consoleのURL>" npm run db:migrate  # 本番DBに適用
```

`auth:schema`は`src/lib/server/auth.ts`(Better Authの設定)を変更したときに再実行が必要。生成された
`drizzle/*.sql`と`src/lib/server/db/auth.schema.ts`はコミット対象(secretは含まれない)。

### Step 5: webhookを有効化する

Step 1-1のGitHub App設定画面で、Webhook URLが実際にデプロイされたURLになっていることを確認する。

### Step 6: 動作確認

1. `https://<yoroi-control>/healthz` と `https://<yoroi-merger>/healthz` が`ok`を返すこと
2. consoleにログインできること(GitHub OAuth)
3. Observer Appをインストールしたリポジトリで適当にPRを開き、GitHub Appの**Advanced**タブの
   Recent Deliveriesでwebhookが200/202で届いていること
4. そのPRに`yoroi/gate` Check Runとsummaryコメントが付くこと

### 安全に有効化する

**動作確認が取れても、この時点でMergerに実マージ権限を渡すべきではない。**design.md自身が要求している
段取り:

1. しばらく**Observe/Shadow mode**で動かし、人間の判断とYoroiの判定のズレを観察する(design.md §1.3の
   6番目の原則、90日間が目安)。
2. requirements.md §20.2のGo/No-Go基準(重複webhook、順不同event、stale fencing tokenなど)を満たす
   まで、`yoroi-merger`を実トラフィックに晒さない。
3. 上記を満たしてから、対象リポジトリのRulesetで`yoroi/gate`を必須Checkにし、実運用へ切り替える。

焦って全部一度に有効化しないこと — 各Deno DeployアプリのSecretsを分けているのは、まさにこの
「段階的に権限を広げる」ためにある。

## 運用・保守メモ(トラブルシューティング)

デプロイ時に実際に踏んだ問題と対処。同じ症状が再発したら参照する。

**consoleのビルドが`DATABASE_URL is not set`で失敗する** — Deno DeployのBuildコンテキストには
Production用secretが渡らない(design.md §17.3)。`src/lib/server/db/index.ts`は`DATABASE_URL`未設定時
に例外を投げず、実際にクエリが飛ぶまで接続を先延ばしにするよう修正済み。再発する場合はこのファイルの
import chain(`hooks.server.ts → $lib/server/auth → $lib/server/db`)に新しい即時`throw`が入っていないか
確認する。

**yoroi-mergerが`refuses to start`で起動しない** — `YOROI_MERGER_PRODUCTION=1`をProduction context
secretsに設定していない。`main.ts`は本番/開発の判定にDeno Deployの内部環境変数を使わず、この明示的な
フラグだけを見る(`DENO_DEPLOY_CONTEXT`・`DENO_TIMELINE`はどちらも実機で試して当てにならなかった —
詳細は`apps/merger/main.ts`のコメント)。

**GitHub AppのSubscribe to eventsに「Issue comment」が出てこない** — Repository permissionsに
**Issues: Read-only**を付けていない。GitHubは対応する権限を持たないeventを一覧に出さない。

**consoleでログインできない/DBエラーが出る** — Better Authのテーブル(`user`/`session`/`account`/
`verification`)が無い可能性が高い。Step 4の`auth:schema`→`db:generate`→`db:migrate`を実行したか確認。

**Deno Deployの無料枠CPU Timeがすぐ90%に達する** — 稼働開始からわずか数時間で
「used 90% of the included allocation of the CPU Time metric」警告が来た実績あり。無料枠の
CPU Timeはネットワーク/DB待ち時間(I/O wait)を含まず、isolateのコールドスタートと実際の計算(モジュール
評価・JSON処理・JWT署名などのcrypto)にしか課金されない([Deno Deployの料金ページ](https://docs.deno.com/deploy/pricing_and_limits/)より)。
`Deno.cron`は登録1本ごとに別々のウェイクアップ機会になるため、`apps/control/main.ts`を以下のように
見直した。

- 毎分実行だった`outbox-sweep`と`ttl-expiry`を1本の`Deno.cron`にまとめ、毎分のコールドスタート回数を
  半減。
- `dashboard-rollup`(GitHub APIを叩いてJWT署名する、唯一CPU負荷の重いジョブ)を毎分→15分毎に変更。
  ダッシュボードの健全性ゲージは毎分の鮮度を必要としないため。
- 未実装のno-opである`approval-membership-scan`を15分毎→1時間毎に変更。

この5つのCronスケジュールと関連するbudgetMsは、`apps/control/main.ts`への決め打ちではなく
[apps/control/src/config.ts](apps/control/src/config.ts)に切り出し、環境変数で上書きできるように
した(`YOROI_CRON_*` — 一覧は`.env.example`参照)。**それでも枠が厳しい場合は、コードを触らず
Deno Deployダッシュボードでこれらの環境変数を設定するだけで頻度を下げられる**(再デプロイ不要)。
逆に、Decision Envelopeの有効期限やrecheckのクールダウンなど安全性に関わる値はあえて
環境変数化していない(`config.ts`のコメント参照) — 誤入力でセキュリティ境界が緩むのを防ぐため。
最終手段としては有料プランで無料枠を100倍にする(カード登録)。
