# moltcms static

[Japanese README](README.ja.md)

`@moltcms/static` is a **Bun 1.3+** framework that connects the authenticated SSE sync of `@moltcms/client` to Git-manageable JSON projections and reproducible incremental static builds. The CLI and facade use Bun APIs, so they cannot run on Node.js alone.

- `.moltcms/<site>/<kind>` is the reviewable, committable source of truth. Content is stored as one JSON file per entity; deletions are recorded as tombstones.
- `.cache/moltcms-static` is a regenerable cache of route state and artifacts. It is not committed to Git.
- Builds read only `complete` projections, compare dependency and query fingerprints, verify the isolated generation, then promote it.

## Create an app

Scaffold a minimal blog starter with a single command, just like Hono. No global install is required.

```sh
bun create moltcms-static my-site
cd my-site
bun install
cp .env.example .env
# Set the sync URL and a read-only API key in .env.
```

The target directory must not exist yet. The starter expects a `post` content type with `title` and `slug` fields; `body` is optional.

## Daily workflow

Everything runs through the package scripts the starter ships:

```sh
bun run sync     # pull content into .moltcms over authenticated SSE
bun run codegen  # regenerate src/moltcms.generated.ts from the synced schemas
bun run build    # render the static site into dist/
```

## Example

`examples/blog` is a fixture projection that needs no live API:

```sh
cd examples/blog
bun install
bun run codegen
bun run build
bun run test
```

## Configuration

`moltcms.config.ts` uses `defineConfig`, `moltcmsSource`, `itemRoute`, `queryRoute`, `feedRoute`, and `sitemapRoute`. Page modules are lazily loaded per route. The generated module pins exact schema versions and a fingerprint; a mismatch fails the build closed.

## CI and deployment

Commit `.moltcms`; never commit `.cache`. CI can run `bun run sync --git-commit`, `bun run codegen`, then `bun run build`. `@moltcms/static-cache-s3` and `@moltcms/static-deploy-s3` provide S3/R2-compatible adapters; objects are keyed by content hash and the deploy pointer is written last.

See `docs/` for configuration, JSON encoding, the query DSL, cache/deploy, Vite development, security, and troubleshooting.
