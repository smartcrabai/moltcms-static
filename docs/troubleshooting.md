# Troubleshooting

- `Projection is not complete`: rerun sync; build intentionally refuses partial snapshots.
- `Schema fingerprint mismatch`: run `moltcms-static codegen` from the local projection.
- `Sync lock is held`: wait for the writer, or only recover a stale lock after its recorded PID is confirmed absent.
- Missing output after build: inspect `dist/manifest.json` and cache route state, then rerun a full build.
