# Git workflow

Commit `.moltcms`; ignore `.cache`. `moltcms-static sync --git-commit` stages only the projection directory and refuses unrelated dirty files unless `--allow-dirty` is explicit. Use `build --since <ref>` in CI when the Git adapter is enabled; unavailable baseline state safely triggers a full build.
