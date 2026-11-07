# moltcms static

[English README](README.md)

`@moltcms/static` は `@moltcms/client` の認証付きSSE同期を、Git管理可能なJSON projectionと再現可能な増分静的buildへ接続する **Bun 1.3+** 向けフレームワークです。CLIとfacadeはBun APIを使用するため、Node.jsだけでは実行できません。

- `.moltcms/<site>/<kind>` はレビュー・コミット可能な正本です。コンテンツはentityごとに1 JSONファイル、削除はtombstoneとして記録します。
- `.cache/moltcms-static` はroute stateとartifactの再生成可能なcacheです。Git管理しません。
- buildは `complete` 状態のprojectionだけを読み込み、依存関係とquery fingerprintを比較し、隔離したgenerationを検証してからpromoteします。

## アプリを作成する

Honoと同様に、1コマンドで最小のブログ用スターターを作成できます。グローバルインストールは不要です。

```sh
bun create moltcms-static my-site
cd my-site
bun install
cp .env.example .env
# .env に同期URLと読み取り専用APIキーを設定
```

作成先は存在しないディレクトリでなければなりません。スターターは `post` コンテンツタイプ（`title`、`slug` フィールド、任意の `body`）を使います。

## 日常のワークフロー

すべてスターター同梱のpackage scripts経由で実行できます。

```sh
bun run sync     # 認証付きSSEで .moltcms にコンテンツを同期
bun run codegen  # 同期したschemaから src/moltcms.generated.ts を再生成
bun run build    # dist/ に静的サイトを出力
```

## サンプル

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

## CIとデプロイ

`.moltcms` はコミットし、`.cache` はコミットしません。CIでは `bun run sync --git-commit`、`bun run codegen`、`bun run build` の順に実行できます。`@moltcms/static-cache-s3` と `@moltcms/static-deploy-s3` はS3/R2互換adapterを提供します。objectはcontent hashで管理し、deploy pointerは最後に更新します。

設定、JSONエンコード、query DSL、cacheとデプロイ、Vite開発、セキュリティ、トラブルシューティングは `docs/` を参照してください。
