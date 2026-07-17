import { honoJsxRenderer, rawHtml } from "@moltcms/static-hono";
import { islandProps } from "@moltcms/static-esbuild";
import type { BuildContext, PlannedRoute } from "@moltcms/static";

export async function render(
	context: BuildContext,
	route: PlannedRoute,
): Promise<Response> {
	const item = route.data.item as {
		id: string;
		data: { title?: unknown; body?: unknown };
	};
	const renderer = honoJsxRenderer();
	return renderer.render(
		() => (
			<html>
				<head>
					<title>{String(item.data.title ?? item.id)}</title>
				</head>
				<body>
					<article>
						<h1>{String(item.data.title ?? item.id)}</h1>
						<p>{String(item.data.body ?? "")}</p>
						<script type="application/json" id="island-props">
							{rawHtml(islandProps({ id: item.id }))}
						</script>
						<script type="module" src={context.assets.entry("app")} />
					</article>
				</body>
			</html>
		),
		context,
		route,
	);
}
