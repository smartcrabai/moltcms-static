import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function sandbox(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "moltcms-static-cli-"));
	directories.push(directory);
	return directory;
}

async function run(...arguments_: string[]): Promise<{
	exitCode: number;
	stdout: string;
	stderr: string;
}> {
	const process = Bun.spawn(["bun", "./cli.ts", ...arguments_], {
		cwd: import.meta.dir,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	return { exitCode, stdout, stderr };
}

test("create-app writes a self-contained starter without overwriting files", async () => {
	const directory = join(await sandbox(), "starter");
	const created = await run("create-app", directory);
	expect(created.exitCode).toBe(0);
	expect(created.stdout).toContain("Created MoltCMS static app");
	expect(
		JSON.parse(await readFile(join(directory, "package.json"), "utf8")),
	).toMatchObject({
		private: true,
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

	const repeated = await run("create", directory);
	expect(repeated.exitCode).not.toBe(0);
	expect(repeated.stderr).toContain("already exists");
});
