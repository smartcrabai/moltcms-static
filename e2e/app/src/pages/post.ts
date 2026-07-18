import type { BuildContext, PlannedRoute } from "@moltcms/static";

export function render(_context: BuildContext, route: PlannedRoute): Response {
	const item = route.data.item as {
		id: string;
		data: { title?: unknown; slug?: unknown; body?: unknown };
	};
	const title = String(item.data.title ?? item.id);
	const body = String(item.data.body ?? "");
	return new Response(
		`<!doctype html><html><head><title>${escapeHtml(title)}</title></head><body><article data-slug="${escapeHtml(String(item.data.slug ?? ""))}"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></article></body></html>`,
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
