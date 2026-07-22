# moltcms static

`@moltcms/static` は、`@moltcms/client` の認証付きSSE同期を、Gitで管理できるJSON投影と再現可能な増分静的ビルドへ接続する **Bun 1.3+** 向けフレームワークです。CLIとfacadeはBun APIを使用するため、Node.jsだけでは実行できません。

- `.moltcms/<site>/<kind>` はレビュー・コミット可能な正本です。コンテンツはエンティティごとに1 JSONファイル、削除はtombstoneとして記録します。
- `.cache/moltcms-static` はroute stateとartifactの再生成可能なキャッシュです。Git管理しません。
- buildは`complete`状態の投影だけを読み込み、依存関係とquery fingerprintを比較し、隔離したgenerationを検証してからpromoteします。

## インストール

利用者が通常必要とするのはfacadeだけです。

```sh
bun add @moltcms/static @moltcms/client
```

adapterは必要なものだけ追加します。

```sh
bun add @moltcms/static-hono @moltcms/static-esbuild
bun add --dev @moltcms/static-vite
# S3 または Cloudflare R2 を使う場合
bun add @moltcms/static-cache-s3 @moltcms/static-deploy-s3
```

## はじめ方

まだ `@moltcms/static` を導入していない場合は、Honoと同様にワンライナーでアプリを作成できます。

```sh
bun create moltcms-static my-site
cd my-site
bun install
cp .env.example .env
# Set the sync URL and a read-only API key in .env.
bun run sync
bun run codegen
bun run build
```

これは npm の `create-moltcms-static` を一時実行するため、グローバルインストールは不要です。`bunx create-moltcms-static my-site` も同じです。スターターは `post` コンテンツタイプ（`title`、`slug`、任意の `body` フィールド）を使います。

すでに `@moltcms/static` を導入済みのアプリでは、次でも作成できます。

```sh
moltcms-static create-app my-site
# 短縮形: moltcms-static create my-site
```

既存アプリの同期・ビルドには次のCLIを使います。

```sh
bunx moltcms-static sync --site main
bunx moltcms-static codegen --site main --output src/moltcms.generated.ts
bunx moltcms-static build --site main
bunx moltcms-static dev --site main
```

`examples/blog` は実APIを必要としないfixture projectionのサンプルです。

```sh
cd examples/blog
bun install
bun run codegen
bun run build
bun run test
```

## 設定

`moltcms.config.ts` で `defineConfig`、`moltcmsSource`、`itemRoute`、`queryRoute`、`feedRoute`、`sitemapRoute` を使用します。ページモジュールはroute単位で遅延ロードされます。生成モジュールは正確なschema versionとfingerprintを保持し、不一致時は安全側に倒してbuildを停止します。

## npm公開

公開対象は `create-moltcms-static`、`@moltcms/static`、各 `static-*` adapterです。`@moltcms/client` はcanonical client packageで、server-sideの認証済みSSE APIとschema取得APIを提供します。

`static-v<version>` tagをpushするとGitHub Actionsが依存順にpack・検証・npm provenance付きで公開します。初回だけはnpm ownerのtokenでbootstrap publishを行い、各packageにGitHub Actions Trusted Publisherを登録してください。登録後のreleaseはOIDCを使用するため長期NPM tokenを保存しません。

## Package migration

`@moltcms/static*` is the canonical package family. After every replacement package is publicly installable, each corresponding `@moltcms-sdk/static*` package is deprecated with an explicit replacement name; it receives no further releases. Existing installations remain resolvable, but consumers should replace the package scope and move to `@moltcms/client`.

`.moltcms` はコミットし、`.cache` はコミットしません。`@moltcms/static-cache-s3` と `@moltcms/static-deploy-s3` はS3/R2互換adapterを提供します。objectはcontent hashで管理し、deploy pointerは最後に更新します。

設定、JSONエンコード、query DSL、キャッシュとデプロイ、Vite開発、セキュリティ、トラブルシューティングは `docs/` を参照してください。
