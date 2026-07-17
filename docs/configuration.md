# Configuration

Use `defineConfig({ sites })`. A site has an id, `moltcmsSource`, generated schema fingerprint, locales, `outDir`, `cacheDir`, routes, and optional asset/renderer/cache/deploy adapters. `itemRoute`, `queryRoute`, `singletonRoute`, `feedRoute`, and `sitemapRoute` produce stable route identities. Give page routes `sourceFiles` so source-byte changes invalidate only their dependent routes.
