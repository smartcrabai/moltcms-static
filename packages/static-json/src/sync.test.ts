import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjection, syncProjection } from "./index.js";

const servers: Array<ReturnType<typeof Bun.serve>> = [];
const directories: string[] = [];

afterEach(async () => {
	for (const server of servers.splice(0)) server.stop(true);
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

test("sync atomically writes a complete projection only after schema and content persistence", async () => {
	const root = await mkdtemp(join(tmpdir(), "moltcms-json-"));
	directories.push(root);
	const server = Bun.serve({
		port: 0,
		fetch() {
			return new Response(
				'event: change\nid: 1\ndata: {"type":"schema_changed","content_type":"post","version":1,"seq":1,"fields":[{"name":"title","kind":"string","required":true}]}\n\nevent: change\nid: 2\ndata: {"type":"content","content_type":"post","id":"p/1","seq":2,"schema_version":1,"data":{"title":"First"}}\n\nevent: sync-complete\ndata: "c1"\n\n',
				{ headers: { "content-type": "text/event-stream" } },
			);
		},
	});
	servers.push(server);
	const options = {
		root,
		siteId: "main",
		kind: "published" as const,
		syncUrl: `http://127.0.0.1:${server.port}/sync`,
		apiKey: "secret",
	};
	const stream = await syncProjection(options);
	await stream.done;
	const projection = await loadProjection(options);
	expect(projection.state.status).toBe("complete");
	expect(projection.state.cursor).toBe("c1");
	expect(projection.snapshot.get("post", "p/1")?.data.title).toBe("First");
});

test("missing schema fails closed without persisting content or a cursor", async () => {
	const root = await mkdtemp(join(tmpdir(), "moltcms-json-"));
	directories.push(root);
	const server = Bun.serve({
		port: 0,
		fetch() {
			return new Response(
				'event: change\nid: 1\ndata: {"type":"content","content_type":"post","id":"p1","seq":1,"schema_version":1,"data":{"title":"First"}}\n\n',
				{ headers: { "content-type": "text/event-stream" } },
			);
		},
	});
	servers.push(server);
	const options = {
		root,
		siteId: "main",
		kind: "published" as const,
		syncUrl: `http://127.0.0.1:${server.port}/sync`,
		apiKey: "secret",
	};
	const stream = await syncProjection(options);
	await expect(stream.done).rejects.toThrow("Schema post@1 was not delivered");
	const projectionDirectory = join(root, "main", "published");
	const state = (await Bun.file(
		join(projectionDirectory, "state.json"),
	).json()) as {
		status: string;
		cursor?: string;
	};
	expect(state.status).toBe("syncing");
	expect(state.cursor).toBeUndefined();
	await expect(
		readdir(join(projectionDirectory, "content")),
	).rejects.toMatchObject({
		code: "ENOENT",
	});
});
