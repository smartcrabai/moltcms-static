# Cache and deploy

Artifact cache keys must include framework, renderer, Node major, lock/config/source/schema/query/asset fingerprints and must exclude credentials, cursor, and absolute paths. S3/R2 adapters verify every artifact checksum, store immutable objects by SHA-256, upload the generation manifest, and update `current.json` last. A failed publish leaves the previous pointer unchanged.
