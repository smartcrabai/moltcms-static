import type { BuildContext, PlannedRoute } from "@moltcms/static";

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
				`<li><a href="/ja/posts/${encodeURIComponent(String(post.data.slug))}/">${escapeHtml(String(post.data.title))}</a></li>`,
		)
		.join("");
	return new Response(
		`<!doctype html><html><body><ul>${items}</ul></body></html>`,
		{ headers: { "content-type": "text/html; charset=utf-8" } },
	);
}

function escapeHtml(value: string): string {
	return value.replace(
		/[&<>"]/g,
		(character) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] ??
			character,
	);
}
