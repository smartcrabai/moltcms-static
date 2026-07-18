/**
 * Live E2E driver. The moltcms test harness is private and owned by the
 * moltcms repository; this public side only knows its generic wrapper
 * (up | seed | logs | down) and the published sync contract. It packs the
 * workspace packages like the release workflow, starts the harness, reads
 * the seed JSON descriptor (sync URL + read-only API key + expectations),
 * then builds and verifies the sample app against it.
 *
 * Skipped automatically when Docker or the private harness is unavailable.
 * Run with: bun run test:e2e
 */
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const appComposeFile = join(repoRoot, "e2e", "compose.yml");
const artifactsDir = join(repoRoot, "e2e", ".artifacts");
const moltcmsDir = resolve(repoRoot, process.env.MOLTCMS_DIR ?? "../moltcms");
const harnessWrapper = join(moltcmsDir, "e2e", "static-sync-harness.sh");

const publishOrder = [
	"static-core",
	"static-json",
	"static-hono",
	"static-esbuild",
	"static-rollup",
	"static-vite",
	"static-cache-s3",
	"static-deploy-s3",
	"static",
] as const;

interface CommandResult {
	code: number;
	stdout: string;
	stderr: string;
}

async function exec(
	command: readonly string[],
	options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<CommandResult> {
	const subprocess = Bun.spawn([...command], {
		cwd: options.cwd ?? repoRoot,
		env: { ...process.env, ...options.env },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(subprocess.stdout).text(),
		new Response(subprocess.stderr).text(),
		subprocess.exited,
	]);
	return { code, stdout, stderr };
}

async function must(
	command: readonly string[],
	options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<CommandResult> {
	const result = await exec(command, options);
	if (result.code !== 0)
		throw new Error(
			`${command.join(" ")} failed (${result.code})\n${result.stdout}\n${result.stderr}`,
		);
	return result;
}

function probe(command: readonly string[]): boolean {
	const result = Bun.spawnSync({
		cmd: [...command],
		stdout: "ignore",
		stderr: "ignore",
	});
	return result.exitCode === 0;
}

const prerequisites: string[] = [];
if (!existsSync(harnessWrapper))
	prerequisites.push(
		`private test harness not found at ${harnessWrapper} (set MOLTCMS_DIR)`,
	);
if (!probe(["docker", "info", "--format", "{{.ServerVersion}}"]))
	prerequisites.push("docker daemon is not available");
if (!probe(["docker", "compose", "version"]))
	prerequisites.push("docker compose is not available");

if (prerequisites.length > 0)
	console.warn(`e2e skipped: ${prerequisites.join("; ")}`);

interface SeedResult {
	syncUrl: string;
	apiKey: string;
	posts: Array<{ slug: string; title: string; body: string }>;
}

test.skipIf(prerequisites.length > 0)(
	"sample app syncs, builds, and serves content from a live moltcms",
	async () => {
		// Pack the workspace exactly like the release workflow, so the app
		// container installs the same artifacts users would get from npm.
		await must(["bun", "run", "build"]);
		await must(["bun", "run", "prepare:publish"]);
		await Bun.$`rm -rf ${artifactsDir}`;
		await Bun.$`mkdir -p ${artifactsDir}`;
		for (const name of publishOrder)
			await must(
				["bun", "pm", "pack", "--destination", artifactsDir, "--quiet"],
				{ cwd: join(repoRoot, "packages", name) },
			);

		const harness = (args: readonly string[]) =>
			exec(["sh", harnessWrapper, ...args]);
		const harnessMust = async (args: readonly string[]) => {
			const result = await harness(args);
			if (result.code !== 0)
				throw new Error(
					`harness ${args.join(" ")} failed (${result.code})\n${result.stdout}\n${result.stderr}`,
				);
			return result;
		};
		const app = (args: readonly string[], env: Record<string, string>) =>
			exec(
				["docker", "compose", "-f", appComposeFile, "--ansi", "never", ...args],
				{ env },
			);

		await harness(["down"]);
		let appEnv: Record<string, string> | undefined;
		try {
			await harnessMust(["up"]);
			const seeded = await harnessMust(["seed"]);
			const seedLine = seeded.stdout
				.trim()
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line.startsWith("{"))
				.pop();
			if (seedLine === undefined)
				throw new Error(
					`seed harness printed no JSON descriptor\n${seeded.stdout}`,
				);
			const seed = JSON.parse(seedLine) as SeedResult;
			if (
				typeof seed.syncUrl !== "string" ||
				typeof seed.apiKey !== "string" ||
				!Array.isArray(seed.posts) ||
				seed.posts.length === 0
			)
				throw new Error(`seed descriptor is malformed: ${seedLine}`);
			appEnv = {
				MOLT_SYNC_URL: seed.syncUrl,
				MOLT_API_KEY: seed.apiKey,
				MOLT_EXPECT: JSON.stringify({ posts: seed.posts }),
			};

			// Public side: build and run only the sample app.
			const appMust = async (args: readonly string[]) => {
				const result = await app(args, appEnv ?? {});
				if (result.code !== 0)
					throw new Error(
						`app compose ${args.join(" ")} failed (${result.code})\n${result.stdout}\n${result.stderr}`,
					);
				return result;
			};
			await app(["down", "-v", "--remove-orphans"], appEnv);
			try {
				await appMust(["up", "-d", "--build"]);
				// --all: the app container may have already exited by the time
				// we look it up; without it ps returns nothing and an empty id
				// would silently parse into a passing exit code below.
				const appId = (
					await appMust(["ps", "--all", "-q", "app"])
				).stdout.trim();
				if (appId.length === 0)
					throw new Error("app container was not created");
				const waited = await exec(["docker", "wait", appId]);
				if (waited.code !== 0)
					throw new Error(
						`docker wait ${appId} failed (${waited.code})\n${waited.stderr}`,
					);
				const appLogs = (await app(["logs", "--no-color", "app"], appEnv))
					.stdout;
				console.log(appLogs);
				const exitCode = Number.parseInt(waited.stdout.trim(), 10);
				if (!Number.isFinite(exitCode))
					throw new Error(
						`docker wait ${appId} returned no exit code: ${waited.stdout}`,
					);
				if (exitCode !== 0) console.error((await harness(["logs"])).stdout);
				expect(exitCode).toBe(0);
			} finally {
				await app(["down", "-v", "--remove-orphans"], appEnv ?? {});
			}
		} finally {
			await harness(["down"]);
		}
	},
	30 * 60 * 1000,
);
