import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("fixture build contains SSR page and island asset", async () => {
	const output = new URL("../dist/ja/posts/hello/index.html", import.meta.url);
	if (!(await Bun.file(output).exists())) {
		const process = Bun.spawn(
			[
				"bun",
				"../../packages/static/dist/cli.js",
				"build",
				"--config",
				"moltcms.config.ts",
			],
			{ cwd: fileURLToPath(new URL("../", import.meta.url)) },
		);
		expect(await process.exited).toBe(0);
	}
	const html = await Bun.file(output).text();
	expect(html).toContain("Hello moltcms");
	expect(html).toContain('id="island-props"');
	expect(html).toMatch(/\/assets\/app-[A-Z0-9]+\.js/);
});
