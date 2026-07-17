import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ContentSnapshot,
	buildGeneration,
	canonicalJson,
	decodePathSegment,
	encodePathSegment,
	evaluateQuery,
	QueryBuilder,
	type ContentChange,
	type PlannedRoute,
} from "./index.js";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});
function content(
	id: string,
	data: Record<string, unknown>,
	type = "post",
): ContentChange {
	return {
		type: "content",
		content_type: type,
		id,
		seq: 1,
		schema_version: 1,
		data,
	};
}
async function sandbox(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "moltcms-static-"));
	directories.push(directory);
	return directory;
}

test("canonical JSON and path segments are deterministic and safe", () => {
	expect(canonicalJson({ z: ["x"], a: { b: 1 } })).toBe(
		'{\n\t"a": {\n\t\t"b": 1\n\t},\n\t"z": [\n\t\t"x"\n\t]\n}\n',
	);
	for (const value of ["../x", "a/b", "a\\b", "\u0000", "日本語", "a:b"])
		expect(decodePathSegment(encodePathSegment(value))).toBe(value);
});

test("query fingerprints ignore hidden fields but detect selected sort and membership changes", () => {
	const descriptor = new QueryBuilder("post")
		.select(["title"])
		.orderBy("title")
		.build();
	const initial = evaluateQuery(
		[content("1", { title: "A", body: "old" })],
		descriptor,
	);
	const hidden = evaluateQuery(
		[content("1", { title: "A", body: "new" })],
		descriptor,
	);
	const selected = evaluateQuery(
		[content("1", { title: "B", body: "new" })],
		descriptor,
	);
	const added = evaluateQuery(
		[content("1", { title: "A" }), content("2", { title: "B" })],
		descriptor,
	);
	expect(hidden.fingerprint).toBe(initial.fingerprint);
	expect(selected.fingerprint).not.toBe(initial.fingerprint);
	expect(added.fingerprint).not.toBe(initial.fingerprint);
});

test("reuses clean routes, invalidates relation dependencies, and deletes stale paths", async () => {
	const directory = await sandbox();
	const post = content("p1", { slug: "first", author: "a1" });
	const author = content("a1", { name: "Ada" }, "author");
	let renders = 0;
	const page = async () => ({
		render(context: { content: ContentSnapshot }) {
			renders += 1;
			const related = context.content.get("author", "a1");
			return new Response(`<h1>${related?.data.name}</h1>`, {
				headers: { "content-type": "text/html" },
			});
		},
	});
	const route = (
		snapshot: ContentSnapshot,
		pathname = "/posts/first/",
	): PlannedRoute => ({
		routeId: "main:published:ja:post:p1",
		pathname,
		kind: "item",
		data: { item: snapshot.get("post", "p1") },
		page,
		redirectFromPreviousPath: true,
	});
	const initial = new ContentSnapshot([post, author]);
	await buildGeneration({
		outDir: join(directory, "dist"),
		stateDir: join(directory, "state"),
		configFingerprint: "config",
		snapshot: initial,
		routes: [route(initial)],
	});
	await buildGeneration({
		outDir: join(directory, "dist"),
		stateDir: join(directory, "state"),
		configFingerprint: "config",
		snapshot: initial,
		routes: [route(initial)],
	});
	expect(renders).toBe(1);
	const changedAuthor = new ContentSnapshot([
		post,
		content("a1", { name: "Grace" }, "author"),
	]);
	await buildGeneration({
		outDir: join(directory, "dist"),
		stateDir: join(directory, "state"),
		configFingerprint: "config",
		snapshot: changedAuthor,
		routes: [route(changedAuthor, "/posts/renamed/")],
	});
	expect(renders).toBe(2);
	expect(
		await readFile(
			join(directory, "dist", "posts", "renamed", "index.html"),
			"utf8",
		),
	).toContain("Grace");
	expect(
		await readFile(
			join(directory, "dist", "posts", "first", "index.html"),
			"utf8",
		),
	).toContain("/posts/renamed/");
});
