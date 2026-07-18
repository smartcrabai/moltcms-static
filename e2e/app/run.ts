/**
 * In-container E2E orchestrator (public side). Consumes only the published
 * sync contract — a sync URL and a read-only API key provisioned by the
 * private-side seed harness — and drives the packed `moltcms-static` CLI
 * through the exact user journey: sync, codegen, build. Verification is
 * expectation-driven: whatever content the seed harness reports must appear
 * in the built site, on disk and served over HTTP.
 */

interface SeededPost {
	slug: string;
	title: string;
	body: string;
}

interface SeedExpectation {
	posts: SeededPost[];
}

const syncUrl = process.env.MOLT_SYNC_URL;
const apiKey = process.env.MOLT_API_KEY;
const expectation = JSON.parse(
	process.env.MOLT_EXPECT ?? "null",
) as SeedExpectation | null;

if (syncUrl === undefined || syncUrl.length === 0)
	throw new Error("MOLT_SYNC_URL is required");
if (apiKey === undefined || apiKey.length === 0)
	throw new Error("MOLT_API_KEY is required");
if (expectation === null || expectation.posts.length === 0)
	throw new Error("MOLT_EXPECT must describe at least one seeded post");

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`assertion failed: ${message}`);
}

async function cli(args: string[]): Promise<void> {
	console.log(`\n$ moltcms-static ${args.join(" ")}`);
	const subprocess = Bun.spawn(["bunx", "moltcms-static", ...args], {
		env: process.env,
		stdout: "inherit",
		stderr: "inherit",
	});
	const code = await subprocess.exited;
	if (code !== 0)
		throw new Error(`moltcms-static ${args.join(" ")} exited with ${code}`);
}

async function readText(path: string): Promise<string> {
	const file = Bun.file(path);
	assert(await file.exists(), `${path} should exist`);
	return file.text();
}

async function verifyBuiltSite(posts: readonly SeededPost[]): Promise<void> {
	const state = JSON.parse(
		await readText(".moltcms/main/published/state.json"),
	) as { status?: string; cursor?: string };
	assert(state.status === "complete", "projection state is complete");
	assert(
		typeof state.cursor === "string" && state.cursor.length > 0,
		"projection recorded a sync cursor",
	);

	const generated = await readText("src/moltcms.generated.ts");
	assert(
		!generated.includes("e2e-bootstrap"),
		"codegen replaced the bootstrap fingerprint",
	);
	assert(generated.includes("post"), "codegen emitted the post schema");

	const index = await readText("dist/ja/posts/index.html");
	const feed = await readText("dist/ja/feed.xml");
	for (const post of posts) {
		const page = await readText(`dist/ja/posts/${post.slug}/index.html`);
		assert(
			page.includes(post.title),
			`post page ${post.slug} contains its title`,
		);
		assert(
			page.includes(post.body),
			`post page ${post.slug} contains its body`,
		);
		assert(index.includes(post.title), `index lists ${post.slug}`);
		assert(
			index.includes(`/ja/posts/${post.slug}/`),
			`index links to ${post.slug}`,
		);
		assert(feed.includes(post.title), `feed contains ${post.slug}`);
	}

	const sitemap = await readText("dist/sitemap.xml");
	assert(sitemap.includes("<urlset"), "sitemap rendered");
}

async function verifyServedSite(posts: readonly SeededPost[]): Promise<void> {
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const path = new URL(request.url).pathname;
			const file = path.endsWith("/") ? `${path}index.html` : path;
			const target = Bun.file(`dist${file}`);
			if (!(await target.exists()))
				return new Response("not found", { status: 404 });
			return new Response(target);
		},
	});
	try {
		for (const post of posts) {
			const response = await fetch(
				`http://127.0.0.1:${server.port}/ja/posts/${post.slug}/`,
			);
			assert(response.ok, `GET /ja/posts/${post.slug}/ -> ${response.status}`);
			const html = await response.text();
			assert(
				html.includes(post.title) && html.includes(post.body),
				`served page ${post.slug} contains the seeded content`,
			);
		}
		const feedResponse = await fetch(
			`http://127.0.0.1:${server.port}/ja/feed.xml`,
		);
		assert(feedResponse.ok, `GET /ja/feed.xml -> ${feedResponse.status}`);
		const feed = await feedResponse.text();
		for (const post of posts)
			assert(feed.includes(post.title), `served feed contains ${post.slug}`);
	} finally {
		server.stop(true);
	}
}

await cli(["sync", "--site", "main"]);
await cli([
	"codegen",
	"--site",
	"main",
	"--output",
	"src/moltcms.generated.ts",
]);
await cli(["build", "--site", "main"]);

await verifyBuiltSite(expectation.posts);
await verifyServedSite(expectation.posts);

console.log(
	`\nE2E OK: ${expectation.posts.length} seeded posts were synced, built, and served`,
);
