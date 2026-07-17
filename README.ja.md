# moltcms static

`@moltcms/static` は `@moltcms/client` の認証付きSSE同期を、Git管理可能なJSON projectionと決定的な増分静的generationへ接続する Bun 1.3+ フレームワークです。

- `.moltcms/<site>/<kind>` はレビュー・commit可能な正本です。entityごとに1 JSON、削除はtombstoneです。
- `.cache/moltcms-static` はroute stateとartifactの再生成可能cacheです。
- buildはcomplete projectionだけを読み、dependency/query fingerprintを比較し、孤立generationを検証してからpromoteします。

## Quick start

```sh
bun install
moltcms-static sync --site main
moltcms-static codegen --site main --output src/moltcms.generated.ts
moltcms-static build --site main
moltcms-static dev --site main
```

`examples/blog` はAPI不要のfixture projectionです。

```sh
cd examples/blog
bun install
bun run codegen
bun run build
bun run test
```

## Config

`moltcms.config.ts` uses `defineConfig`, `moltcmsSource`, `itemRoute`, `queryRoute`, `feedRoute`, and `sitemapRoute`. Page modules lazily load per route. The generated module pins exact schema versions and fingerprint; a mismatch fails closed.

## CI and deployment

Commit `.moltcms`, never commit `.cache`. CI can run `sync --git-commit`, `codegen`, then `build --since <ref>`. `@moltcms/static-cache-s3` and `@moltcms/static-deploy-s3` provide S3/R2-compatible adapters; object keys are content hashes and the deploy pointer is written last.

See `docs/` for configuration, JSON encoding, query DSL, cache/deploy, Vite development, security, and troubleshooting. `@moltcms/client` provides both browser EventSource and authenticated server-side SSE APIs.
