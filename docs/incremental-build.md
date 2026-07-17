# Incremental build

The core rejects syncing projections, validates generated schema fingerprint, loads JSON into an in-memory index, plans deterministic route IDs, and compares route data, exact/relation dependencies, serializable query fingerprints, source file hashes, and referenced asset URLs. Clean route outputs are checksum-verified then copied into an isolated generation. Dirty routes render there. The manifest is validated before an out/state backup-and-rollback promotion. Missing/corrupt state falls back to a full render.
