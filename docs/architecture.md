# Architecture

`@moltcms/client` is the canonical client package. Its browser `openSyncStream` API remains available; `openServerSyncStream` and schema retrieval APIs provide authenticated Bun/Node synchronization for static builds. `@moltcms/static*` depends only on this canonical package.

The static builder is a Bun workspace with an acyclic dependency graph:

```text
client → static-core
       ↗      ↑
static-json, static-hono, static-esbuild, static-rollup
              ↑
static-vite, static-cache-s3, static-deploy-s3
              ↑
         static (facade and CLI)
```

`static-core` owns planning, query descriptors/evaluation, route state, dependency collection, cache keys, and atomic generation promotion. It has no Hono, Vite, or remote-cache state. `static-json` owns the Git-friendly projection and synchronization transaction. The other packages implement renderer, asset, module, development, cache, and deployment adapter boundaries.

Projection JSON (`.moltcms/<site>/<kind>`) is authoritative and Git-trackable. `.cache/moltcms-static` contains regenerable route state and artifacts. A build loads only a `complete` projection snapshot, plans deterministic route identities, invalidates dependencies conservatively, renders into an isolated generation, validates the manifest, then atomically promotes it. Failure leaves the previous generation and build state untouched.

The default facade composes filesystem projection, Hono rendering, esbuild assets, local artifact cache, and the CLI. Secrets are consumed only while configuration is evaluated or while a sync transport is opened; they are excluded from fingerprints, manifests, logs, output, and cache keys.
