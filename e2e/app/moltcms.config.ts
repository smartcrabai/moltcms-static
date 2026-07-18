import {
	defineConfig,
	feedRoute,
	itemRoute,
	moltcmsSource,
	queryRoute,
	sitemapRoute,
} from "@moltcms/static";
import {
	schemaFingerprint,
	schemaVersions,
	type MoltcmsSchemas,
} from "./src/moltcms.generated.js";

export default defineConfig<MoltcmsSchemas>({
	sites: [
		{
			id: "main",
			source: moltcmsSource({
				kind: "published",
				projectionDir: ".moltcms/main",
				syncUrl: process.env.MOLT_SYNC_URL,
				apiKey: process.env.MOLT_API_KEY,
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
						`/${locale}/posts/${String(item.data.slug)}/`,
					page: () => import("./src/pages/post.js"),
					sourceFiles: ["src/pages/post.ts"],
				}),
				queryRoute({
					id: "post-index",
					path: ({ page, locale }) =>
						page === 1 ? `/${locale}/posts/` : `/${locale}/posts/page/${page}/`,
					query: ({ query }) =>
						query("post")
							.orderBy("title")
							.paginate({ size: 10 })
							.select(["title", "slug"]),
					page: () => import("./src/pages/index.js"),
					sourceFiles: ["src/pages/index.ts"],
				}),
				feedRoute({
					id: "feed",
					path: ({ locale }) => `/${locale}/feed.xml`,
					contentType: "post",
				}),
				sitemapRoute({ id: "sitemap", path: "/sitemap.xml" }),
			],
		},
	],
});
