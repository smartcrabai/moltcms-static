# Sample app image: installs the workspace packages from the tarballs packed
# by e2e/e2e.test.ts (mirroring the release workflow), then runs the E2E
# orchestrator against the live moltcms API in the compose network.
FROM oven/bun:1-alpine

WORKDIR /app

COPY .artifacts/ /tarballs/
COPY app/package.json ./
# Install only the packages the app uses: the facade plus its runtime
# dependencies, taken from the freshly packed tarballs; the canonical
# client comes from npm just like for a real user.
RUN bun add /tarballs/create-moltcms-static-*.tgz \
	/tarballs/moltcms-static-[0-9]*.tgz \
	/tarballs/moltcms-static-core-*.tgz \
	/tarballs/moltcms-static-json-*.tgz \
	@moltcms/client@^0.4.0

COPY app/ ./

CMD ["bun", "run.ts"]
