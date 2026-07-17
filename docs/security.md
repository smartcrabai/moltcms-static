# Security

Credentials are used only for server-side sync/schema calls and are excluded from output, manifests, cache keys, and logs. Encoded projection segments and output path checks block traversal. Cache artifacts are checksum/path verified. Public symlinks escaping their root are rejected. Hono escapes JSX by default; raw HTML requires the explicit `rawHtml` API. Island JSON escapes `<`, U+2028, and U+2029.
