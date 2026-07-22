import { exists, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

/** Creates a minimal, ready-to-sync MoltCMS static site without overwriting files. */
export async function createApp(directory: string): Promise<string> {
	const target = resolve(directory);
	if (await exists(target))
		throw new Error(`Cannot create app: ${target} already exists`);
	const parent = dirname(target);
	const temporary = join(
		parent,
		`.${basename(target)}.moltcms-static-create-${crypto.randomUUID()}`,
	);
	await mkdir(parent, { recursive: true });
	await mkdir(temporary);
	try {
		for (const [relativePath, content] of Object.entries(
			appTemplate(basename(target)),
		)) {
			const path = join(temporary, relativePath);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, content);
		}
		await rename(temporary, target);
	} catch (error) {
		await rm(temporary, { recursive: true, force: true });
		throw error;
	}
	console.log(`Created MoltCMS static app in ${target}`);
	console.log(
		"Next: cd into the directory, install dependencies, then configure .env.",
	);
	return target;
}

function appTemplate(name: string): Record<string, string> {
	return {
		".gitignore": ".cache/\ndist/\n.moltcms/\n.env\nnode_modules/\n",
		".env.example":
			"MOLTCMS_SYNC_URL=https://your-moltcms.example/sync\nMOLTCMS_API_KEY=replace-with-a-read-only-api-key\n",
		"package.json": `${JSON.stringify(
			{
				name,
				private: true,
				type: "module",
				scripts: {
					sync: "moltcms-static sync --site main",
					codegen:
						"moltcms-static codegen --site main --output src/moltcms.generated.ts",
					build: "moltcms-static build --site main",
				},
				dependencies: {
					"@moltcms/client": "^0.4.0",
					"@moltcms/static": "^0.1.1",
				},
				devDependencies: {
					"@types/bun": "latest",
					typescript: "^5.9.3",
				},
			},
			null,
			2,
		)}\n`,
		"tsconfig.json": `${JSON.stringify(
			{
				compilerOptions: {
					lib: ["ESNext", "DOM", "DOM.Iterable"],
					target: "ES2022",
					module: "NodeNext",
					moduleResolution: "NodeNext",
					moduleDetection: "force",
					verbatimModuleSyntax: true,
					strict: true,
					skipLibCheck: true,
					types: ["bun"],
				},
				include: ["src/**/*.ts", "moltcms.config.ts"],
			},
			null,
			2,
		)}\n`,
		"moltcms.config.ts": `import {
	defineConfig,
	itemRoute,
	moltcmsSource,
	queryRoute,
	sitemapRoute,
} from "@moltcms/static";
import {
	schemaFingerprint,
	schemaVersions,
} from "./src/moltcms.generated.js";

export default defineConfig({
	sites: [
		{
			id: "main",
			source: moltcmsSource({
				syncUrl: process.env.MOLTCMS_SYNC_URL,
				apiKey: process.env.MOLTCMS_API_KEY,
				kind: "published",
				projectionDir: ".moltcms/main",
			}),
			generatedSchemas: { schemaVersions, schemaFingerprint },
			locales: ["ja"],
			outDir: "dist",
			cacheDir: ".cache/moltcms-static/main",
			routes: [
				itemRoute({
					id: "post",
					contentType: "post",
					path: ({ item, locale }) =>
						\`/\${locale}/posts/\${String(item.data.slug)}/\`,
					page: () => import("./src/pages/post.js"),
					sourceFiles: ["src/pages/post.ts"],
				}),
				queryRoute({
					id: "post-index",
					path: ({ page, locale }) =>
						page === 1
							? \`/\${locale}/posts/\`
							: \`/\${locale}/posts/page/\${page}/\`,
					query: ({ query }) =>
						query("post")
							.orderBy("title")
							.paginate({ size: 10 })
							.select(["title", "slug"]),
					page: () => import("./src/pages/index.js"),
					sourceFiles: ["src/pages/index.ts"],
				}),
				sitemapRoute({ id: "sitemap", path: "/sitemap.xml" }),
			],
		},
	],
});
`,
		"src/moltcms.generated.ts": `// This placeholder lets \`moltcms-static sync\` load the configuration.
// It is replaced by \`moltcms-static codegen\` after the first sync.
export const schemaVersions = {} as const;
export const schemaFingerprint = "";
`,
		"src/pages/index.ts": `import type { BuildContext, PlannedRoute } from "@moltcms/static";

export function render(context: BuildContext, route: PlannedRoute): Response {
	const posts = context.content
		.query("post")
		.orderBy("title")
		.paginate({ size: 10, page: Number(route.data.page) })
		.select(["title", "slug"])
		.run();
	const items = posts.items
		.map(
			(post) =>
				\`<li><a href="/ja/posts/\${encodeURIComponent(String(post.data.slug))}/">\${escapeHtml(String(post.data.title))}</a></li>\`,
		)
		.join("");
	return new Response(\`<!doctype html><html><body><main><h1>Posts</h1><ul>\${items}</ul></main></body></html>\`, {
		headers: { "content-type": "text/html; charset=utf-8" },
	});
}
function escapeHtml(value: string): string {
	return value.replace(/[&<>"]/g, (character) =>
		({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[
			character
		] ?? character,
	);
}
`,
		"src/pages/post.ts": `import type { BuildContext, PlannedRoute } from "@moltcms/static";

export function render(_context: BuildContext, route: PlannedRoute): Response {
	const item = route.data.item as {
		id: string;
		data: { title?: unknown; body?: unknown };
	};
	const title = String(item.data.title ?? item.id);
	const body = String(item.data.body ?? "");
	return new Response(\`<!doctype html><html><body><article><h1>\${escapeHtml(title)}</h1><p>\${escapeHtml(body)}</p></article></body></html>\`, {
		headers: { "content-type": "text/html; charset=utf-8" },
	});
}
function escapeHtml(value: string): string {
	return value.replace(/[&<>"]/g, (character) =>
		({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[
			character
		] ?? character,
	);
}
`,
		"README.md": `# MoltCMS static app

1. Install dependencies: \`bun install\`.
2. Copy \`.env.example\` to \`.env\` and set the sync URL and read-only API key.
3. Run \`bun run sync\`, \`bun run codegen\`, then \`bun run build\`.

This starter expects a \`post\` content type with \`title\` and \`slug\` fields; \`body\` is optional.
`,
	};
}
