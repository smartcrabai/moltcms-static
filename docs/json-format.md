# JSON projection format

Paths use `u_` plus URL-safe base64 of UTF-8. The codec is reversible and never emits separators, dot segments, NUL, or control characters. Content files are `.moltcms/<site>/<kind>/content/<encoded-type>/<encoded-id>.json`; schemas are versioned separately. JSON is canonical: sorted keys, tabs, UTF-8, trailing newline, and SHA-256 over those bytes. Writes use a flushed same-directory temporary file followed by rename. A deletion overwrites the entity file with `content_deleted` and retains its highest `seq`.
