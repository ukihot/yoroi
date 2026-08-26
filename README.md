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
本番へ出す手順は一番下の「[本番リリース手順](#本番リリース手順)」を参照。

---

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

---

## 本番リリース手順

GitHubとDeno Deployで「何をどこにいくつ作るか」がわかりにくいので、上から順にやれば終わるように書く。
**作るものは合計6つ**: GitHub App 2つ(Observer/Merger)、GitHub OAuth App 1つ(console ログイン用)、
Deno Deployアプリ3つ(control/merger/console)。

### 全体像

```
GitHub (Observer App) --webhook--> yoroi-control  --署名付きenvelope--> yoroi-merger --merge--> GitHub (Merger App)
                                         ^
                                         | HTTP API
                                    yoroi-console (人間がログインして見る画面)
```

- `yoroi-control` と `yoroi-merger` は**別のGitHub App・別のDeno Deployアプリ**にする。同じにすると
  「controlを乗っ取られたらmergeもできてしまう」構成になり、design.md が最重要視している分離が壊れる
  (design.md §2.2, §19.3)。
- 3アプリとも同じPostgreSQLに繋ぐが、`yoroi-console` だけは直接DBに繋がず、必ず `yoroi-control` のAPI経由。

### 事前に用意するもの

- Yoroiを動かしたいGitHub Organization(またはユーザー)の管理者権限
- [Deno Deploy](https://deno.com/deploy) のアカウント(このリポジトリをGitHub連携でデプロイできる状態)
- 本番用PostgreSQL 1つ(Deno Deployダッシュボードから作れる組み込みPostgresでよい。design.md §22で
  正式に採用が決まっている)

### Step 1: GitHub Appを2つ作る

GitHubの **Settings → Developer settings → GitHub Apps → New GitHub App** から作成する(Organizationで
使うなら Organization の Settings から)。**2回**この作業をする。

#### 1-1. Observer App(`yoroi-control` 用 — 読み取りと通知だけ)

- GitHub App name: 例 `yoroi-control` (グローバルで一意な名前が必要)
- Homepage URL: 何でもよい(リポジトリのURLなど)
- Webhook: **Active** にチェック
  - Webhook URL: `https://<yoroi-controlをデプロイしたURL>/github/webhook`(Step 3でURLが決まってから
    後で編集してもよい)
  - Webhook secret: ランダムな文字列を生成して控える(→ `GITHUB_WEBHOOK_SECRET` に使う)。
    `openssl rand -hex 32` などで作れる。
- Permissions → Repository permissions:
  - **Contents**: Read-only
  - **Metadata**: Read-only(自動で付く)
  - **Pull requests**: Read and write(PRの読み取り、およびsummaryコメント投稿に必要)
  - **Checks**: Read and write(`yoroi/gate` Check Runの作成・更新に必要)
  - **Commit statuses**: Read-only
  - **Issues**: Read-only(これを付けないと「Issue comment」がSubscribe to eventsの一覧に
    出てこない — GitHubの仕様。`/yoroi`コマンドはPRコメント=issue commentとして届く)
- Subscribe to events(Issues権限を付けた後に一覧へ出てくる — `apps/control/src/routes/webhook.ts` の
  `EVENT_ALLOWLIST` と一致させる):
  - Pull request
  - Pull request review
  - Issue comment
  - Check run
  - Check suite
  - Status
  - Push
- **Where can this GitHub App be installed?**: 自分のOrganizationのみでよければ "Only on this account"
- 作成後、**Generate a private key** で `.pem` ファイルをダウンロードして控える(→
  `GITHUB_APP_PRIVATE_KEY`)。App ID(ページ上部に表示)も控える(→ `GITHUB_APP_ID`)。
- 作成後、対象リポジトリに **Install App** しておく。

#### 1-2. Merger App(`yoroi-merger` 用 — mergeだけ、これ以外の権限を持たせない)

同じ画面で、名前を変えてもう一つ作る。

- GitHub App name: 例 `yoroi-merger`
- Webhook: **Active のチェックを外す**(yoroi-mergerはwebhookを受け取らない。呼び出されるのは
  yoroi-controlからのみ)
- Permissions → Repository permissions:
  - **Contents**: Read and write(mergeの実行に必要)
  - **Pull requests**: Read and write
  - **Metadata**: Read-only(自動)
  - これ以外は付けない
- Subscribe to events: 何もチェックしない
- Install App: Observer Appと同じリポジトリにインストール
- Generate a private key → 控える(→ `MERGER_GITHUB_APP_PRIVATE_KEY`)。App IDも控える
  (→ `MERGER_GITHUB_APP_ID`)。

**この2つのApp IDと秘密鍵を混同しないこと。** yoroi-control側にMerger Appの鍵を置いてしまうと、
分離した意味がなくなる。

### Step 2: console ログイン用のGitHub OAuth App(上の2つとは別物)

`yoroi-console` のログイン(Better Auth)は GitHub App ではなく、**GitHub OAuth App** を使う。
**Settings → Developer settings → OAuth Apps → New OAuth App** で作成する。

- Homepage URL: `https://<console をデプロイしたURL>`
- Authorization callback URL: `https://<console をデプロイしたURL>/api/auth/callback/github`
- 作成後、Client ID / Client secret を控える(→ ルートの `.env` の `GITHUB_CLIENT_ID` /
  `GITHUB_CLIENT_SECRET`)

### Step 3: Deno Deployにアプリを3つ作る

[Deno Deploy](https://dash.deno.com) にログインし、このGitHubリポジトリと連携する。**New App** を3回
作成し、それぞれ Root directory(リポジトリ内のどのディレクトリを動かすか)を分ける。

| Deno Deployアプリ | Root directory        | エントリポイント                  |
| ----------------- | --------------------- | --------------------------------- |
| yoroi-control     | `apps/control`        | `main.ts`                         |
| yoroi-merger      | `apps/merger`         | `main.ts`                         |
| yoroi-console     | `/`(リポジトリルート) | SvelteKit(要ビルド設定、下記参照) |

3アプリとも、Deno Deployダッシュボードの **Database** タブから同じPostgresデータベースを1つ紐付ける
(design.md §22: Deno Deploy組み込みPostgresを採用)。`yoroi-console` は直接DBを使わないが、Better Auth用に
別の(または同じ)Postgresが必要 — ルートの `drizzle.config.ts` が対象にしているDBを用意する。

各アプリの **Settings → Environment Variables** で、**Production** contextに以下を設定する
(`.env.example` に一覧あり)。

**yoroi-control**(`apps/control/.env.example` 参照):

```
DATABASE_URL=...          # Postgres接続文字列
YOROI_CONTROL_API_TOKEN=... # consoleと共有する適当な長いランダム文字列
GITHUB_APP_ID=...           # Step 1-1で控えたもの
GITHUB_APP_PRIVATE_KEY=...  # Step 1-1で控えたpemの中身
GITHUB_WEBHOOK_SECRET=...   # Step 1-1で決めたwebhook secret
YOROI_MERGER_URL=https://<yoroi-mergerのURL>
YOROI_MERGER_SHARED_TOKEN=... # yoroi-mergerと全く同じ値にする(下記)
```

**yoroi-merger**(`apps/merger/.env.example` 参照):

```
DATABASE_URL=...                    # yoroi-controlと同じPostgres
MERGER_GITHUB_APP_ID=...            # Step 1-2で控えたもの
MERGER_GITHUB_APP_PRIVATE_KEY=...   # Step 1-2で控えたpemの中身
YOROI_MERGER_SHARED_TOKEN=...       # 上のyoroi-controlと全く同じ値
YOROI_MERGER_PRODUCTION=1           # これが無いとmain.tsが起動を拒否する(下記参照)
```

`YOROI_MERGER_PRODUCTION=1` は**本番のProduction context secretsにのみ**設定する
(`main.ts`の起動時ガード — design.md §17.3)。逆に `YOROI_MERGER_DEV` は**本番では絶対に設定しない**
(ローカルテスト専用で、設定すると本番contextチェックを迂回してしまう)。この2つを同時に設定しないこと。

**yoroi-console**(ルートの `.env.example` 参照):

```
DATABASE_URL=...              # Better Auth用のPostgres
ORIGIN=https://<console のURL>
BETTER_AUTH_SECRET=...        # ランダムな32文字以上
GITHUB_CLIENT_ID=...          # Step 2
GITHUB_CLIENT_SECRET=...      # Step 2
YOROI_CONTROL_URL=https://<yoroi-controlのURL>
YOROI_CONTROL_API_TOKEN=...   # yoroi-controlと全く同じ値
```

> **consoleのビルドで `DATABASE_URL is not set` エラーが出る場合**: `vite.config.ts` は
> `@sveltejs/adapter-auto` を使っており、ビルド時に「対応環境を検出できません」という**警告**を出すが、
> これ自体はビルドを失敗させない(ローカルでも同じ警告が出た上でビルドは成功する)。実際にビルドを
> 落としていたのは `src/lib/server/db/index.ts` が `DATABASE_URL` 未設定時に即座に`throw`していたこと ——
> Deno DeployのBuildコンテキストにはProduction用のsecretが渡らない(design.md §17.3)ため、
> `hooks.server.ts → $lib/server/auth → $lib/server/db` のimportチェーンがビルド中に評価された瞬間に
> クラッシュしていた。この問題は修正済み(`DATABASE_URL`未設定時は例外を投げず、実際にクエリが飛ぶまで
> 接続を先延ばしにする)。もしこの修正後もconsoleが実際に**起動・応答しない**(ビルドは通るがリクエストに
> 応答しない)場合は、[SvelteKitのadapter一覧](https://svelte.dev/docs/kit/adapters)からDeno Deploy向け
> (または `@sveltejs/adapter-node`)に明示的に切り替えることを検討する。

### Step 4: DBマイグレーション

各アプリをデプロイ後、ローカルから本番の `DATABASE_URL` を指定して1回だけ実行する。

```sh
# yoroi-control / yoroi-merger が使う共通スキーマ(packages/postgres)
cd apps/control
DATABASE_URL="<本番のURL>" deno task migrate

# console(Better Auth)側のスキーマ
cd ../..
DATABASE_URL="<本番のURL>" npx drizzle-kit migrate
```

### Step 5: webhookを有効化する

Step 1-1のGitHub App設定画面に戻り、Webhook URLを実際にデプロイされた
`https://<yoroi-control>/github/webhook` に更新する(仮のURLで作った場合はここで確定させる)。

### Step 6: 動作確認

1. `https://<yoroi-control>/healthz` が `ok` を返すこと
2. `https://<yoroi-merger>/healthz` が `ok` を返すこと
3. console にログインできること(GitHub OAuth)
4. Observer Appをインストールしたリポジトリで適当にPRを開き、GitHub App の **Advanced** タブの
   Recent Deliveries でwebhookが200/202で届いていること
5. そのPRに `yoroi/gate` Check Runとsummaryコメントが付くこと

### Step 7: 安全に有効化する(ここが一番大事)

**この時点でMergerに実マージ権限を渡すべきではない。** design.md自身が要求している段取り:

1. しばらく **Observe/Shadow mode** で動かし、人間の判断とYoroiの判定のズレを観察する(design.md §1.3
   の6番目の原則、90日間が目安)。
2. requirements.md §20.2 の Go/No-Go 基準(重複webhook、順不同event、stale fencing tokenなど)を
   満たすまで、`yoroi-merger` を実トラフィックに晒さない。
3. 上記を満たしてから、対象リポジトリのRulesetで `yoroi/gate` を必須Checkにし、実運用へ切り替える。

焦って全部一度に有効化しないこと — 各Deno DeployアプリのSecretsを分けているのは、まさにこの「段階的に
権限を広げる」ためにある。
