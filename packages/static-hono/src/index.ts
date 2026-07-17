import { Hono } from "hono";
import { raw } from "hono/html";
import type { BuildContext, PlannedRoute } from "@moltcms/static-core";

export interface HonoPage {
	(
		context: BuildContext,
		route: PlannedRoute,
	):
		| { toString(): string | Promise<string> }
		| Promise<{ toString(): string | Promise<string> }>
		| Response
		| Promise<Response>;
}
export interface HonoJsxRendererOptions {
	document?: (body: string, route: PlannedRoute) => string;
}
/** Creates a Hono JSX renderer. JSX escapes text by default; use rawHtml only for explicitly trusted output. */
export function honoJsxRenderer(options: HonoJsxRendererOptions = {}) {
	return {
		async render(
			page: HonoPage,
			context: BuildContext,
			route: PlannedRoute,
		): Promise<Response> {
			const value = await page(context, route);
			if (value instanceof Response) return validateResponse(value, route);
			const body = await value.toString();
			const document =
				options.document?.(body, route) ?? `<!doctype html>${body}`;
			return new Response(document, {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		},
	};
}
/** Adapts a Hono app to the static page renderer boundary. */
export function honoAppRenderer(app: Hono) {
	return {
		async render(
			_page: HonoPage,
			_context: BuildContext,
			route: PlannedRoute,
		): Promise<Response> {
			return validateResponse(
				await app.fetch(new Request(`http://static.local${route.pathname}`)),
				route,
			);
		},
	};
}
/** Marks intentionally sanitized HTML as raw. Never pass untrusted richtext here. */
export function rawHtml(sanitizedHtml: string) {
	return raw(sanitizedHtml);
}
function validateResponse(response: Response, route: PlannedRoute): Response {
	if (response.status >= 500)
		throw new Error(
			`Hono renderer returned ${response.status} for ${route.routeId}`,
		);
	if (
		response.status >= 300 &&
		response.status < 400 &&
		response.headers.get("location") === null
	)
		throw new Error(`Redirect route ${route.routeId} did not include Location`);
	if (response.status !== 204 && response.headers.get("content-type") === null)
		throw new Error(
			`Response for ${route.routeId} did not include content-type`,
		);
	return response;
}
