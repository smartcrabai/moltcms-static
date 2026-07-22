import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
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

async function run(...arguments_: string[]): Promise<{
	exitCode: number;
	stdout: string;
	stderr: string;
}> {
	const process = Bun.spawn(["bun", "../dist/cli.js", ...arguments_], {
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

test("CLI creates an app with the bun create command contract", async () => {
	expect(
		await Bun.file(new URL("../package.json", import.meta.url)).json(),
	).toMatchObject({
		bin: { "create-moltcms-static": "./dist/cli.js" },
	});
	const parent = await mkdtemp(join(tmpdir(), "moltcms-static-create-cli-"));
	directories.push(parent);
	const result = await run(join(parent, "starter"));
	expect(result.exitCode).toBe(0);
	expect(result.stdout).toContain("Created MoltCMS static app");

	const help = await run("--help");
	expect(help.exitCode).toBe(0);
	expect(help.stdout).toContain("bun create moltcms-static <directory>");
});
