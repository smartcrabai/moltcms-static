import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./index.js";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

test("creates a self-contained starter without overwriting files", async () => {
	const parent = await mkdtemp(join(tmpdir(), "moltcms-static-create-"));
	directories.push(parent);
	const directory = join(parent, "starter");

	await createApp(directory);
	expect(
		JSON.parse(await readFile(join(directory, "package.json"), "utf8")),
	).toMatchObject({
		name: "starter",
		private: true,
		dependencies: {
			"@moltcms/client": "^0.4.0",
			"@moltcms/static": "^0.1.1",
		},
		scripts: {
			sync: "moltcms-static sync --site main",
			codegen:
				"moltcms-static codegen --site main --output src/moltcms.generated.ts",
			build: "moltcms-static build --site main",
		},
	});
	expect(await Bun.file(join(directory, "moltcms.config.ts")).text()).toContain(
		"MOLTCMS_SYNC_URL",
	);
	expect(await Bun.file(join(directory, "src/pages/post.ts")).text()).toContain(
		"escapeHtml",
	);
	await expect(createApp(directory)).rejects.toThrow("already exists");
});

test("generated starter syncs, generates types, and builds from MoltCMS", async () => {
	const parent = await mkdtemp(join(tmpdir(), "moltcms-static-create-build-"));
	directories.push(parent);
	const directory = join(parent, "starter");
	await createApp(directory);
	const server = Bun.serve({
		port: 0,
		fetch() {
			return new Response(
				'event: change\nid: 1\ndata: {"type":"schema_changed","content_type":"post","version":1,"seq":1,"fields":[{"name":"title","kind":"string","required":true},{"name":"slug","kind":"string","required":true},{"name":"body","kind":"text","required":false}]}\n\nevent: change\nid: 2\ndata: {"type":"content","content_type":"post","id":"p1","seq":2,"schema_version":1,"data":{"title":"Hello MoltCMS","slug":"hello","body":"Starter content"}}\n\nevent: sync-complete\ndata: "fixture-c1"\n\n',
				{ headers: { "content-type": "text/event-stream" } },
			);
		},
	});
	try {
		const run = async (...arguments_: string[]) => {
			const subprocess = Bun.spawn(
				[
					"bun",
					fileURLToPath(new URL("../../static/dist/cli.js", import.meta.url)),
					...arguments_,
				],
				{
					cwd: directory,
					env: {
						...process.env,
						MOLTCMS_SYNC_URL: `http://127.0.0.1:${server.port}/sync`,
						MOLTCMS_API_KEY: "test-key",
					},
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(subprocess.stdout).text(),
				new Response(subprocess.stderr).text(),
				subprocess.exited,
			]);
			expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
		};
		await run("sync", "--site", "main");
		await run(
			"codegen",
			"--site",
			"main",
			"--output",
			"src/moltcms.generated.ts",
		);
		await run("build", "--site", "main");
		expect(
			await Bun.file(join(directory, "dist/ja/posts/hello/index.html")).text(),
		).toContain("Hello MoltCMS");
	} finally {
		server.stop(true);
	}
});
