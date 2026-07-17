import { dirname, basename } from "node:path";
import type { ContentSchema, FieldDef, SchemaTypeMap } from "@moltcms/client";
import {
	buildGeneration,
	canonicalJson,
	feedRoute,
	itemRoute,
	planRoutes,
	queryRoute,
	sha256,
	singletonRoute,
	sitemapRoute,
	type ArtifactCache,
	type BuildContext,
	type BuildReport,
	type DeployAdapter,
	type FeedRoute,
	type ItemRoute,
	type PlannedRoute,
	type QueryRoute,
	type RouteDefinition,
	type SingletonRoute,
	type SitemapRoute,
} from "@moltcms/static-core";
import {
	loadProjection,
	syncProjection,
	type ProjectionKind,
} from "@moltcms/static-json";

export { feedRoute, itemRoute, queryRoute, singletonRoute, sitemapRoute };
export type {
	BuildContext,
	FeedRoute,
	ItemRoute,
	PlannedRoute,
	QueryRoute,
	SingletonRoute,
	SitemapRoute,
};
export interface MoltcmsSource {
	syncUrl?: string;
	apiKey?: string;
	kind: ProjectionKind;
	projectionDir: string;
}
export interface GeneratedSchemas {
	schemaVersions: unknown;
	schemaFingerprint: string;
}
export interface DevelopmentAdapter {
	start(signal?: AbortSignal): Promise<{ close(): Promise<void> }>;
}
export interface SiteConfig<_S extends SchemaTypeMap = SchemaTypeMap> {
	id: string;
	source: MoltcmsSource;
	generatedSchemas: GeneratedSchemas;
	locales: readonly string[];
	outDir: string;
	cacheDir?: string;
	routes: readonly RouteDefinition[];
	assets?: {
		build(outDir: string): Promise<{ manifest: Record<string, string> }>;
	};
	renderer?: unknown;
	development?: DevelopmentAdapter;
	deploy?: DeployAdapter;
	cache?: ArtifactCache;
}
export interface StaticConfig<S extends SchemaTypeMap = SchemaTypeMap> {
	sites: readonly SiteConfig<S>[];
}
/** Declares a type-safe, ESM static site configuration. */
export function defineConfig<S extends SchemaTypeMap>(
	config: StaticConfig<S>,
): StaticConfig<S> {
	validateConfig(config);
	return config;
}
/** Declares a moltcms projection source. Secrets remain in this server-only object. */
export function moltcmsSource(source: MoltcmsSource): MoltcmsSource {
	return source;
}
function validateConfig(config: StaticConfig): void {
	const ids = new Set<string>();
	for (const site of config.sites) {
		if (site.id.length === 0 || ids.has(site.id))
			throw new TypeError(`Site id must be unique: ${site.id}`);
		ids.add(site.id);
		if (site.locales.length === 0)
			throw new TypeError(`Site ${site.id} must define at least one locale`);
	}
}
export async function synchronizeSite(
	site: SiteConfig,
	signal?: AbortSignal,
): Promise<void> {
	if (site.source.syncUrl === undefined || site.source.apiKey === undefined)
		throw new Error(`Site ${site.id} requires syncUrl and apiKey for sync`);
	const stream = await syncProjection({
		root: dirname(site.source.projectionDir),
		siteId: basename(site.source.projectionDir),
		kind: site.source.kind,
		syncUrl: site.source.syncUrl,
		apiKey: site.source.apiKey,
		signal,
	});
	await stream.done;
}
export async function codegenSite(
	site: SiteConfig,
	output: string,
): Promise<string> {
	const projection = await loadProjection({
		root: dirname(site.source.projectionDir),
		siteId: basename(site.source.projectionDir),
		kind: site.source.kind,
	});
	const schemaFingerprint =
		projection.state.schema_fingerprint ??
		sha256(canonicalJson(projection.schemas));
	const content = `${renderSchemaTypes(projection.schemas)}\nexport const schemaFingerprint = ${JSON.stringify(schemaFingerprint)};\n`;
	await Bun.write(output, content);
	return content;
}
/** Builds one immutable site generation from a complete local projection. */
export async function buildSite(
	site: SiteConfig,
	signal?: AbortSignal,
): Promise<BuildReport> {
	const projection = await loadProjection({
		root: dirname(site.source.projectionDir),
		siteId: basename(site.source.projectionDir),
		kind: site.source.kind,
	});
	if (
		projection.state.schema_fingerprint !==
		site.generatedSchemas.schemaFingerprint
	)
		throw new Error(
			`Schema fingerprint mismatch for ${site.id}; run moltcms-static codegen`,
		);
	const cacheDirectory = site.cacheDir ?? ".cache/moltcms-static";
	const assetDirectory = `${cacheDirectory}/assets`;
	const assets =
		site.assets === undefined
			? {}
			: (await site.assets.build(assetDirectory)).manifest;
	const routes = planRoutes(
		site.id,
		site.source.kind,
		site.locales,
		site.routes,
		projection.snapshot,
	);
	const report = await buildGeneration({
		outDir: site.outDir,
		stateDir: `${cacheDirectory}/route-state`,
		configFingerprint: fingerprintSite(site),
		snapshot: projection.snapshot,
		routes,
		assets,
		assetDirectory: site.assets === undefined ? undefined : assetDirectory,
		signal,
	});
	if (site.deploy !== undefined) {
		await site.deploy.publish(
			{ id: report.buildId, directory: site.outDir, manifest: report },
			signal,
		);
	}
	return report;
}
export function fingerprintSite(site: SiteConfig): string {
	return sha256(
		canonicalJson({
			id: site.id,
			kind: site.source.kind,
			projectionDir: site.source.projectionDir,
			locales: site.locales,
			outDir: site.outDir,
			routes: site.routes.map((route) => ({ id: route.id, kind: route.kind })),
			schemaFingerprint: site.generatedSchemas.schemaFingerprint,
		}),
	);
}
export async function planSite(site: SiteConfig): Promise<unknown> {
	const projection = await loadProjection({
		root: dirname(site.source.projectionDir),
		siteId: basename(site.source.projectionDir),
		kind: site.source.kind,
	});
	return planRoutes(
		site.id,
		site.source.kind,
		site.locales,
		site.routes,
		projection.snapshot,
	);
}

function renderSchemaTypes(schemas: readonly ContentSchema[]): string {
	const groups = Map.groupBy(
		[...schemas].sort(
			(left, right) =>
				left.content_type.localeCompare(right.content_type) ||
				left.version - right.version,
		),
		(schema) => schema.content_type,
	);
	const blocks = [...groups]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(
			([contentType, versions]) =>
				`\t${JSON.stringify(contentType)}: {\n${versions
					.map(
						(schema) =>
							`\t\t${schema.version}: {\n${schema.fields
								.map(renderField)
								.join("\n")}\n\t\t};`,
					)
					.join("\n")}\n\t};`,
		)
		.join("\n");
	const versions = Object.fromEntries(
		[...groups].map(([contentType, values]) => [
			contentType,
			values.map((schema) => schema.version),
		]),
	);
	return `// Generated by @moltcms/static. Do not edit.\nimport type { SchemaVersionIndex } from "@moltcms/client";\n\nexport interface MoltcmsSchemas {\n${blocks}\n}\n\nexport const schemaVersions = ${JSON.stringify(versions, null, "\t")} as const satisfies SchemaVersionIndex<MoltcmsSchemas>;\n`;
}

function renderField(field: FieldDef): string {
	const optional = field.required ? "" : "?";
	return `\t\t\t${JSON.stringify(field.name)}${optional}: ${renderFieldType(field)}${field.required ? "" : " | null"};`;
}

function renderFieldType(field: FieldDef): string {
	switch (field.kind) {
		case "string":
		case "text":
		case "datetime":
			return "string";
		case "number":
			return "number";
		case "boolean":
			return "boolean";
		case "image":
		case "relation":
			return field.multiple ? "string[]" : "string";
		case "select": {
			const values =
				field.options.map((option) => JSON.stringify(option)).join(" | ") ||
				"never";
			return field.multiple ? `(${values})[]` : values;
		}
		case "richtext":
		case "json":
			return "unknown";
	}
}
