import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type {
	ContentChange,
	ContentDeleted,
	ContentSchema,
} from "@moltcms/client";
export type {
	ContentChange,
	ContentDeleted,
	ContentSchema,
} from "@moltcms/client";

export const formatVersion = 1;
export type ContentRecord = ContentChange | ContentDeleted;
export type DependencyKey =
	| `content:${string}`
	| `content-type:${string}`
	| `query:${string}`
	| `schema:${string}`
	| `page-module:${string}`
	| `source-module:${string}`
	| `asset-entry:${string}`
	| `public-file:${string}`
	| `layout:${string}`
	| `config:${string}`
	| `global:${string}`;
export interface ProjectionState {
	format_version: number;
	status: "complete" | "syncing";
	cursor?: string;
	previous_cursor?: string;
	run_id?: string;
	projection_revision?: string;
	schema_fingerprint?: string;
}
export interface RouteState {
	formatVersion: number;
	routeId: string;
	pathname: string;
	previousPathnames: string[];
	outputFiles: Array<{ path: string; sha256: string; mediaType: string }>;
	dependencies: DependencyKey[];
	queryKeys: string[];
	sourceModuleHashes: Record<string, string>;
	assetKeys: string[];
	inputHash: string;
	renderedAtBuildId: string;
	routeDataHash?: string;
	queryDescriptors?: Record<string, QueryDescriptor>;
}
export interface Logger {
	debug(message: string, fields?: Record<string, unknown>): void;
	info(message: string, fields?: Record<string, unknown>): void;
	warn(message: string, fields?: Record<string, unknown>): void;
	error(message: string, fields?: Record<string, unknown>): void;
}
export const silentLogger: Logger = {
	debug() {},
	info() {},
	warn() {},
	error() {},
};

/** Canonical UTF-8 JSON with sorted object keys and one trailing newline. */
export function canonicalJson(value: unknown): string {
	return `${JSON.stringify(canonicalValue(value), null, "\t")}\n`;
}
function canonicalValue(value: unknown): unknown {
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value))
			throw new TypeError("Canonical JSON does not support non-finite numbers");
		return value;
	}
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (typeof value === "object") {
		const output: Record<string, unknown> = {};
		for (const key of Object.keys(value).sort())
			output[key] = canonicalValue((value as Record<string, unknown>)[key]);
		return output;
	}
	throw new TypeError(`Canonical JSON does not support ${typeof value}`);
}
export function sha256(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}
/** Reversible UTF-8 segment codec. No encoded segment contains a path separator. */
export function encodePathSegment(value: string): string {
	return `u_${Buffer.from(value, "utf8").toString("base64url")}`;
}
export function decodePathSegment(value: string): string {
	if (!value.startsWith("u_") || !/^[A-Za-z0-9_-]*$/.test(value.slice(2)))
		throw new TypeError("Invalid moltcms path segment");
	return Buffer.from(value.slice(2), "base64url").toString("utf8");
}
export function assertSafeRelativePath(value: string): void {
	if (
		value.includes("\0") ||
		value
			.split(/[\\/]+/)
			.some((part) => part === "" || part === "." || part === "..")
	)
		throw new TypeError(`Unsafe output path: ${JSON.stringify(value)}`);
}
export function outputPath(outDir: string, pathname: string): string {
	const normal = pathname.replace(/^\/+/, "");
	const output =
		pathname.endsWith("/") || pathname === ""
			? join(normal, "index.html")
			: normal;
	const root = resolve(outDir);
	const file = resolve(root, output);
	if (file !== root && !file.startsWith(`${root}${sep}`))
		throw new TypeError(`Output escaped outDir: ${pathname}`);
	return file;
}
/** Writes only changed canonical bytes through a same-directory temporary file. */
export async function atomicWrite(
	path: string,
	value: string | Uint8Array,
): Promise<boolean> {
	const bytes = typeof value === "string" ? Buffer.from(value) : value;
	try {
		if (Buffer.compare(await readFile(path), bytes) === 0) return false;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	await mkdir(dirname(path), { recursive: true });
	const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
	try {
		await writeFile(temporary, bytes, { flush: true });
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
	return true;
}
export async function readJson<T>(path: string): Promise<T | undefined> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw new Error(`Invalid JSON at ${path}`, { cause: error });
	}
}

export type Predicate =
	| {
			readonly field: string;
			readonly op:
				| "eq"
				| "ne"
				| "lt"
				| "lte"
				| "gt"
				| "gte"
				| "in"
				| "notIn"
				| "contains"
				| "containsAny"
				| "containsAll"
				| "exists";
			readonly value?: unknown;
	  }
	| { readonly op: "and" | "or"; readonly predicates: readonly Predicate[] }
	| { readonly op: "not"; readonly predicate: Predicate };
export interface QueryDescriptor {
	version: 1;
	contentType: string;
	predicate?: Predicate;
	order: readonly { field: string; direction: "asc" | "desc" }[];
	limit?: number;
	offset?: number;
	select?: readonly string[];
	locale?: string;
	opaque?: boolean;
}
export interface QueryResult {
	items: ContentChange[];
	total: number;
	fingerprint: string;
	key: string;
}
export class QueryBuilder {
	private descriptor: QueryDescriptor;
	constructor(contentType: string) {
		this.descriptor = { version: 1, contentType, order: [] };
	}
	where(
		predicate: Predicate | Record<string, { eq?: unknown; ne?: unknown }>,
	): this {
		this.descriptor.predicate = isPredicate(predicate)
			? predicate
			: {
					op: "and",
					predicates: Object.entries(predicate).flatMap(([field, operators]) =>
						Object.entries(operators).map(([op, value]) => ({
							field,
							op: op as "eq" | "ne",
							value,
						})),
					),
				};
		return this;
	}
	orderBy(field: string, direction: "asc" | "desc" = "asc"): this {
		this.descriptor.order = [...this.descriptor.order, { field, direction }];
		return this;
	}
	limit(limit: number): this {
		this.descriptor.limit = assertCount(limit, "limit");
		return this;
	}
	offset(offset: number): this {
		this.descriptor.offset = assertCount(offset, "offset");
		return this;
	}
	paginate(options: { size: number; page?: number }): this {
		const page = options.page ?? 1;
		this.descriptor.limit = assertCount(options.size, "size");
		this.descriptor.offset = assertCount(page - 1, "page") * options.size;
		return this;
	}
	locale(locale: string): this {
		this.descriptor.locale = locale;
		return this;
	}
	select(fields: readonly string[]): this {
		this.descriptor.select = [...fields].sort();
		return this;
	}
	opaque(): this {
		this.descriptor.opaque = true;
		return this;
	}
	build(): QueryDescriptor {
		return JSON.parse(canonicalJson(this.descriptor)) as QueryDescriptor;
	}
}
function assertCount(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 0)
		throw new RangeError(`${name} must be a non-negative safe integer`);
	return value;
}
function isPredicate(
	value: Predicate | Record<string, { eq?: unknown; ne?: unknown }>,
): value is Predicate {
	return "op" in value;
}
export function queryKey(descriptor: QueryDescriptor): string {
	return sha256(canonicalJson(descriptor));
}
export function evaluateQuery(
	records: readonly ContentRecord[],
	descriptor: QueryDescriptor,
): QueryResult {
	const matching = records.filter(
		(record): record is ContentChange =>
			record.type === "content" &&
			record.content_type === descriptor.contentType &&
			(descriptor.locale === undefined ||
				record.data.locale === descriptor.locale) &&
			(descriptor.predicate === undefined ||
				matches(record.data, descriptor.predicate)),
	);
	matching.sort((left, right) => {
		for (const sort of descriptor.order) {
			const a = comparable(left.data[sort.field]);
			const b = comparable(right.data[sort.field]);
			if (a < b) return sort.direction === "asc" ? -1 : 1;
			if (a > b) return sort.direction === "asc" ? 1 : -1;
		}
		return left.id.localeCompare(right.id);
	});
	const selected = matching.slice(
		descriptor.offset ?? 0,
		descriptor.limit === undefined
			? undefined
			: (descriptor.offset ?? 0) + descriptor.limit,
	);
	const result = {
		ids: selected.map((item) => item.id),
		selected: selected.map((item) => {
			const value =
				descriptor.select === undefined
					? item.data
					: Object.fromEntries(
							descriptor.select.map((field) => [field, item.data[field]]),
						);
			return sha256(canonicalJson(value));
		}),
		total: matching.length,
		boundaries: [selected[0]?.id ?? null, selected.at(-1)?.id ?? null],
		sort: descriptor.order,
		descriptorVersion: descriptor.version,
	};
	return {
		items: selected,
		total: matching.length,
		fingerprint: sha256(canonicalJson(result)),
		key: queryKey(descriptor),
	};
}
function comparable(value: unknown): string | number {
	return typeof value === "number"
		? value
		: typeof value === "string"
			? value
			: canonicalJson(value);
}
function matches(data: Record<string, unknown>, predicate: Predicate): boolean {
	if (predicate.op === "and")
		return predicate.predicates.every((entry) => matches(data, entry));
	if (predicate.op === "or")
		return predicate.predicates.some((entry) => matches(data, entry));
	if (predicate.op === "not") return !matches(data, predicate.predicate);
	if (!("field" in predicate)) return false;
	const value = data[predicate.field];
	const target = predicate.value;
	switch (predicate.op) {
		case "exists":
			return value !== undefined && value !== null;
		case "eq":
			return same(value, target);
		case "ne":
			return !same(value, target);
		case "lt":
			return comparable(value) < comparable(target);
		case "lte":
			return comparable(value) <= comparable(target);
		case "gt":
			return comparable(value) > comparable(target);
		case "gte":
			return comparable(value) >= comparable(target);
		case "in":
			return (
				Array.isArray(target) && target.some((entry) => same(value, entry))
			);
		case "notIn":
			return (
				Array.isArray(target) && !target.some((entry) => same(value, entry))
			);
		case "contains":
			return Array.isArray(value)
				? value.some((entry) => same(entry, target))
				: typeof value === "string" &&
						typeof target === "string" &&
						value.includes(target);
		case "containsAny":
			return (
				Array.isArray(value) &&
				Array.isArray(target) &&
				target.some((entry) => value.some((current) => same(current, entry)))
			);
		case "containsAll":
			return (
				Array.isArray(value) &&
				Array.isArray(target) &&
				target.every((entry) => value.some((current) => same(current, entry)))
			);
	}
}
function same(left: unknown, right: unknown): boolean {
	return canonicalJson(left) === canonicalJson(right);
}

export class ContentSnapshot {
	readonly records: readonly ContentRecord[];
	private readonly byKey = new Map<string, ContentRecord>();
	constructor(
		records: readonly ContentRecord[],
		readonly schemas: readonly ContentSchema[] = [],
	) {
		this.records = [...records];
		for (const record of records)
			this.byKey.set(`${record.content_type}\0${record.id}`, record);
	}
	get(contentType: string, id: string): ContentChange | undefined {
		recordDependency(
			`content:${encodePathSegment(contentType)}:${encodePathSegment(id)}`,
		);
		const record = this.byKey.get(`${contentType}\0${id}`);
		return record?.type === "content" ? record : undefined;
	}
	query(contentType: string): TrackingQuery {
		return new TrackingQuery(this, contentType);
	}
	run(descriptor: QueryDescriptor): QueryResult {
		if (descriptor.opaque)
			recordDependency(
				`content-type:${encodePathSegment(descriptor.contentType)}`,
			);
		const result = evaluateQuery(this.records, descriptor);
		recordDependency(`query:${result.key}`);
		dependencyStore.getStore()?.queries.set(result.key, descriptor);
		return result;
	}
}
export class TrackingQuery extends QueryBuilder {
	constructor(
		private readonly snapshot: ContentSnapshot,
		contentType: string,
	) {
		super(contentType);
	}
	run(): QueryResult {
		return this.snapshot.run(this.build());
	}
}
export interface BuildContext {
	content: ContentSnapshot;
	assets: { entry(name: string): string };
	signal?: AbortSignal;
}
interface DependencyStore {
	keys: Set<DependencyKey>;
	queries: Map<string, QueryDescriptor>;
}
const dependencyStore = new AsyncLocalStorage<DependencyStore>();
export async function trackDependencies<T>(
	callback: () => Promise<T> | T,
): Promise<{
	value: T;
	dependencies: DependencyKey[];
	queryDescriptors: Record<string, QueryDescriptor>;
}> {
	const store: DependencyStore = {
		keys: new Set<DependencyKey>(),
		queries: new Map<string, QueryDescriptor>(),
	};
	const value = await dependencyStore.run(store, callback);
	return {
		value,
		dependencies: [...store.keys].sort(),
		queryDescriptors: Object.fromEntries(
			[...store.queries.entries()].sort(([left], [right]) =>
				left.localeCompare(right),
			),
		),
	};
}
export function recordDependency(key: DependencyKey): void {
	dependencyStore.getStore()?.keys.add(key);
}

export interface PlannedRoute {
	routeId: string;
	pathname: string;
	kind: "item" | "query" | "singleton" | "feed" | "sitemap";
	data: Record<string, unknown>;
	page?: PageLoader;
	redirectFromPreviousPath?: boolean;
	sourceFiles?: readonly string[];
}
export type PageLoader = () => Promise<PageModule>;
export interface PageModule {
	render(
		context: BuildContext,
		route: PlannedRoute,
	): Promise<Response> | Response;
}
export interface ItemRoute {
	kind: "item";
	id: string;
	contentType: string;
	path(input: { item: ContentChange; locale: string }): string;
	page: PageLoader;
	redirectFromPreviousPath?: boolean;
	sourceFiles?: readonly string[];
}
export interface QueryRoute {
	kind: "query";
	id: string;
	path(input: { page: number; locale: string }): string;
	query(input: {
		query: (contentType: string) => TrackingQuery;
		locale: string;
	}): QueryBuilder;
	page: PageLoader;
	sourceFiles?: readonly string[];
}
export interface SingletonRoute {
	kind: "singleton";
	id: string;
	path(input: { locale: string }): string;
	page: PageLoader;
	sourceFiles?: readonly string[];
}
export interface FeedRoute {
	kind: "feed";
	id: string;
	path(input: { locale: string }): string;
	contentType: string;
	sourceFiles?: readonly string[];
}
export interface SitemapRoute {
	kind: "sitemap";
	id: string;
	path: string;
}
export type RouteDefinition =
	| ItemRoute
	| QueryRoute
	| SingletonRoute
	| FeedRoute
	| SitemapRoute;
export const itemRoute = (options: Omit<ItemRoute, "kind">): ItemRoute => ({
	kind: "item",
	...options,
});
export const queryRoute = (options: Omit<QueryRoute, "kind">): QueryRoute => ({
	kind: "query",
	...options,
});
export const singletonRoute = (
	options: Omit<SingletonRoute, "kind">,
): SingletonRoute => ({ kind: "singleton", ...options });
export const feedRoute = (options: Omit<FeedRoute, "kind">): FeedRoute => ({
	kind: "feed",
	...options,
});
export const sitemapRoute = (
	options: Omit<SitemapRoute, "kind">,
): SitemapRoute => ({ kind: "sitemap", ...options });
export function planRoutes(
	site: string,
	kind: string,
	locales: readonly string[],
	routes: readonly RouteDefinition[],
	snapshot: ContentSnapshot,
): PlannedRoute[] {
	const planned: PlannedRoute[] = [];
	for (const locale of locales) {
		for (const route of routes) {
			switch (route.kind) {
				case "item":
					for (const item of snapshot.records) {
						if (
							item.type === "content" &&
							item.content_type === route.contentType &&
							(item.data.locale === undefined || item.data.locale === locale)
						) {
							planned.push({
								routeId: `${site}:${kind}:${locale}:${route.id}:${item.id}`,
								pathname: route.path({ item, locale }),
								kind: "item",
								data: { item, locale },
								page: route.page,
								redirectFromPreviousPath: route.redirectFromPreviousPath,
								sourceFiles: route.sourceFiles,
							});
						}
					}
					break;
				case "query": {
					const descriptor = route
						.query({
							query: (contentType: string) => snapshot.query(contentType),
							locale,
						})
						.build();
					const result = snapshot.run(descriptor);
					const size =
						descriptor.limit === undefined
							? 1
							: Math.max(1, Math.ceil(result.total / descriptor.limit));
					for (let page = 1; page <= size; page += 1)
						planned.push({
							routeId: `${site}:${kind}:${locale}:${route.id}:${page}`,
							pathname: route.path({ page, locale }),
							kind: "query",
							data: { locale, page },
							page: route.page,
							sourceFiles: route.sourceFiles,
						});
					break;
				}
				case "singleton":
					planned.push({
						routeId: `${site}:${kind}:${locale}:${route.id}`,
						pathname: route.path({ locale }),
						kind: "singleton",
						data: { locale },
						page: route.page,
						sourceFiles: route.sourceFiles,
					});
					break;
				case "feed":
					planned.push({
						routeId: `${site}:${kind}:${locale}:${route.id}`,
						pathname: route.path({ locale }),
						kind: "feed",
						data: { locale, contentType: route.contentType },
					});
					break;
				case "sitemap":
					if (locale === locales[0])
						planned.push({
							routeId: `${site}:${kind}:${route.id}`,
							pathname: route.path,
							kind: "sitemap",
							data: {},
						});
					break;
			}
		}
	}
	const paths = new Map<string, string>();
	for (const route of planned) {
		if (!route.pathname.startsWith("/"))
			throw new TypeError(
				`Route ${route.routeId} did not return an absolute pathname`,
			);
		const previous = paths.get(route.pathname);
		if (previous !== undefined)
			throw new Error(
				`Pathname collision ${route.pathname}: ${previous}, ${route.routeId}`,
			);
		paths.set(route.pathname, route.routeId);
	}
	return planned.sort((left, right) =>
		left.routeId.localeCompare(right.routeId),
	);
}

export interface RenderedFile {
	path: string;
	bytes: Uint8Array;
	mediaType: string;
}
export interface BuildReport {
	buildId: string;
	rendered: string[];
	reused: string[];
	removed: string[];
	reasons: Record<string, string[]>;
}
export interface BuildOptions {
	outDir: string;
	stateDir: string;
	configFingerprint: string;
	snapshot: ContentSnapshot;
	routes: PlannedRoute[];
	assets?: Record<string, string>;
	assetDirectory?: string;
	signal?: AbortSignal;
	logger?: Logger;
}
export async function buildGeneration(
	options: BuildOptions,
): Promise<BuildReport> {
	const logger = options.logger ?? silentLogger;
	let buildId = sha256(
		`${options.configFingerprint}:${options.routes.map((route) => route.routeId).join("\0")}`,
	).slice(0, 16);
	const previous =
		(await readJson<Record<string, RouteState>>(
			join(options.stateDir, "routes.json"),
		)) ?? {};
	const next: Record<string, RouteState> = {};
	const temporary = `${options.outDir}.next-${randomUUID()}`;
	const previousOut = options.outDir;
	await rm(temporary, { recursive: true, force: true });
	await mkdir(temporary, { recursive: true });
	if (options.assetDirectory !== undefined)
		await cp(options.assetDirectory, temporary, { recursive: true });
	const report: BuildReport = {
		buildId,
		rendered: [],
		reused: [],
		removed: [],
		reasons: {},
	};
	for (const route of options.routes) {
		if (options.signal?.aborted)
			throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
		const before = previous[route.routeId];
		const routeDataHash = sha256(
			canonicalJson({ route: route.data, pathname: route.pathname }),
		);
		const destination = outputPath(temporary, route.pathname);
		const sourceModuleHashes = await hashSourceFiles(route.sourceFiles);
		if (
			before?.routeDataHash === routeDataHash &&
			before.queryDescriptors !== undefined &&
			canonicalJson(before.sourceModuleHashes) ===
				canonicalJson(sourceModuleHashes)
		) {
			const inputHash = routeInputHash(
				route,
				before.dependencies,
				before.queryDescriptors,
				options.snapshot,
				options.configFingerprint,
				sourceModuleHashes,
				options.assets ?? {},
			);
			if (before.inputHash === inputHash) {
				try {
					for (const outputFile of before.outputFiles) {
						const source = outputPath(previousOut, outputFile.path);
						const bytes = await readFile(source);
						if (sha256(bytes) !== outputFile.sha256)
							throw new Error(
								`Previous artifact checksum mismatch: ${outputFile.path}`,
							);
						await atomicWrite(outputPath(temporary, outputFile.path), bytes);
					}
					next[route.routeId] = before;
					report.reused.push(route.routeId);
					continue;
				} catch {
					report.reasons[route.routeId] = ["previous artifact missing"];
				}
			} else {
				report.reasons[route.routeId] = ["tracked input changed"];
			}
		} else {
			report.reasons[route.routeId] = [
				before === undefined
					? "new route"
					: "route data or state format changed",
			];
		}
		const tracked = await trackDependencies(async () =>
			route.page === undefined
				? defaultRender(route, options.snapshot)
				: (await route.page()).render(
						{
							content: options.snapshot,
							assets: {
								entry: (name) => {
									recordDependency(`asset-entry:${name}`);
									const value = options.assets?.[name];
									if (value === undefined)
										throw new Error(`Unknown asset entry ${name}`);
									return value;
								},
							},
							signal: options.signal,
						},
						route,
					),
		);
		const response = tracked.value;
		if (response.status >= 500)
			throw new Error(
				`Route ${route.routeId} rendered HTTP ${response.status}`,
			);
		const bytes = new Uint8Array(await response.arrayBuffer());
		const inputHash = routeInputHash(
			route,
			tracked.dependencies,
			tracked.queryDescriptors,
			options.snapshot,
			options.configFingerprint,
			sourceModuleHashes,
			options.assets ?? {},
		);
		await atomicWrite(destination, bytes);
		const file = relative(temporary, destination);
		next[route.routeId] = {
			formatVersion,
			routeId: route.routeId,
			pathname: route.pathname,
			previousPathnames:
				before?.pathname !== undefined && before.pathname !== route.pathname
					? [...before.previousPathnames, before.pathname]
					: (before?.previousPathnames ?? []),
			outputFiles: [
				{
					path: file,
					sha256: sha256(bytes),
					mediaType:
						response.headers.get("content-type") ?? "text/html; charset=utf-8",
				},
			],
			dependencies: tracked.dependencies,
			queryKeys: tracked.dependencies
				.filter((key) => key.startsWith("query:"))
				.map((key) => key.slice(6)),
			sourceModuleHashes,
			assetKeys: tracked.dependencies
				.filter((key) => key.startsWith("asset-entry:"))
				.map((key) => key.slice(12)),
			inputHash,
			routeDataHash,
			queryDescriptors: tracked.queryDescriptors,
			renderedAtBuildId: buildId,
		};
		if (route.redirectFromPreviousPath) {
			const redirectPathnames = next[route.routeId]?.previousPathnames ?? [];
			for (const previousPathname of redirectPathnames) {
				if (
					options.routes.some(
						(candidate) =>
							candidate.routeId !== route.routeId &&
							candidate.pathname === previousPathname,
					)
				) {
					throw new Error(
						`Redirect pathname collision ${previousPathname} for ${route.routeId}`,
					);
				}
				const redirect = `<!doctype html><meta http-equiv="refresh" content="0; url=${escapeHtmlAttribute(route.pathname)}"><link rel="canonical" href="${escapeHtmlAttribute(route.pathname)}">`;
				const redirectDestination = outputPath(temporary, previousPathname);
				await atomicWrite(redirectDestination, redirect);
				next[route.routeId]?.outputFiles.push({
					path: relative(temporary, redirectDestination),
					sha256: sha256(redirect),
					mediaType: "text/html; charset=utf-8",
				});
			}
		}
		report.rendered.push(route.routeId);
	}
	for (const state of Object.values(previous))
		if (next[state.routeId] === undefined) report.removed.push(state.routeId);
	buildId = sha256(
		canonicalJson({
			config: options.configFingerprint,
			assets: options.assets ?? {},
			routes: Object.values(next)
				.sort((left, right) => left.routeId.localeCompare(right.routeId))
				.map((state) => ({
					id: state.routeId,
					input: state.inputHash,
					files: state.outputFiles.map((file) => [file.path, file.sha256]),
				})),
		}),
	).slice(0, 32);
	report.buildId = buildId;
	for (const state of Object.values(next)) state.renderedAtBuildId = buildId;
	await atomicWrite(
		join(temporary, "manifest.json"),
		canonicalJson({
			formatVersion,
			buildId,
			routes: Object.values(next).sort((left, right) =>
				left.routeId.localeCompare(right.routeId),
			),
		}),
	);
	await mkdir(options.stateDir, { recursive: true });
	const stateTemporary = `${options.stateDir}.next-${randomUUID()}`;
	await rm(stateTemporary, { recursive: true, force: true });
	await mkdir(stateTemporary, { recursive: true });
	await atomicWrite(join(stateTemporary, "routes.json"), canonicalJson(next));
	const outBackup = `${options.outDir}.previous`;
	const stateBackup = `${options.stateDir}.previous`;
	await rm(outBackup, { recursive: true, force: true });
	await rm(stateBackup, { recursive: true, force: true });
	let hadOut = false;
	let hadState = false;
	let promotedOut = false;
	let promotedState = false;
	try {
		try {
			await rename(options.outDir, outBackup);
			hadOut = true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		try {
			await rename(options.stateDir, stateBackup);
			hadState = true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		await rename(temporary, options.outDir);
		promotedOut = true;
		await rename(stateTemporary, options.stateDir);
		promotedState = true;
	} catch (error) {
		if (promotedOut) await rm(options.outDir, { recursive: true, force: true });
		if (promotedState)
			await rm(options.stateDir, { recursive: true, force: true });
		if (hadOut) await rename(outBackup, options.outDir);
		if (hadState) await rename(stateBackup, options.stateDir);
		throw error;
	}
	await rm(outBackup, { recursive: true, force: true });
	await rm(stateBackup, { recursive: true, force: true });
	logger.info("Promoted generation", {
		buildId,
		rendered: report.rendered.length,
		reused: report.reused.length,
	});
	return report;
}
function routeInputHash(
	route: PlannedRoute,
	dependencyKeys: readonly DependencyKey[],
	descriptors: Record<string, QueryDescriptor>,
	snapshot: ContentSnapshot,
	configFingerprint: string,
	sourceModuleHashes: Record<string, string>,
	assets: Record<string, string>,
): string {
	const values = dependencyKeys.map((key) => {
		if (key.startsWith("content:")) {
			const segments = key.split(":");
			const contentType =
				segments[1] === undefined ? undefined : decodePathSegment(segments[1]);
			const id =
				segments[2] === undefined ? undefined : decodePathSegment(segments[2]);
			const record =
				contentType === undefined || id === undefined
					? undefined
					: snapshot.records.find(
							(entry) => entry.content_type === contentType && entry.id === id,
						);
			return [key, record === undefined ? null : sha256(canonicalJson(record))];
		}
		if (key.startsWith("content-type:")) {
			const encoded = key.slice("content-type:".length);
			const contentType = decodePathSegment(encoded);
			return [
				key,
				sha256(
					canonicalJson(
						snapshot.records.filter(
							(entry) => entry.content_type === contentType,
						),
					),
				),
			];
		}
		if (key.startsWith("query:")) {
			const descriptor = descriptors[key.slice("query:".length)];
			return [
				key,
				descriptor === undefined
					? null
					: evaluateQuery(snapshot.records, descriptor).fingerprint,
			];
		}
		if (key.startsWith("asset-entry:"))
			return [key, assets[key.slice("asset-entry:".length)] ?? null];
		return [key, configFingerprint];
	});
	return sha256(
		canonicalJson({
			route: route.data,
			pathname: route.pathname,
			config: configFingerprint,
			sourceModuleHashes,
			values,
		}),
	);
}
async function hashSourceFiles(
	files: readonly string[] | undefined,
): Promise<Record<string, string>> {
	const hashes: Record<string, string> = {};
	for (const file of [...(files ?? [])].sort())
		hashes[file] = sha256(await readFile(file));
	return hashes;
}
function defaultRender(
	route: PlannedRoute,
	snapshot: ContentSnapshot,
): Response {
	if (route.kind === "feed") {
		const contentType = String(route.data.contentType);
		recordDependency(`content-type:${encodePathSegment(contentType)}`);
		const entries = snapshot.records
			.filter(
				(record): record is ContentChange =>
					record.type === "content" && record.content_type === contentType,
			)
			.map(
				(record) =>
					`<entry><id>${escapeXml(record.id)}</id><title>${escapeXml(String(record.data.title ?? record.id))}</title></entry>`,
			)
			.join("");
		return new Response(
			`<?xml version="1.0" encoding="UTF-8"?><feed>${entries}</feed>`,
			{ headers: { "content-type": "application/atom+xml" } },
		);
	}
	if (route.kind === "sitemap") {
		for (const contentType of new Set(
			snapshot.records.map((record) => record.content_type),
		))
			recordDependency(`content-type:${encodePathSegment(contentType)}`);
		return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset/>', {
			headers: { "content-type": "application/xml" },
		});
	}
	return new Response("<!doctype html><html><body></body></html>", {
		headers: { "content-type": "text/html; charset=utf-8" },
	});
}
function escapeXml(value: string): string {
	return value.replace(
		/[&<>"]/g,
		(character) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] ??
			character,
	);
}
function escapeHtmlAttribute(value: string): string {
	return value.replace(
		/[&<>"']/g,
		(character) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				character
			] ?? character,
	);
}

export interface ArtifactCache {
	get(
		key: string,
		signal?: AbortSignal,
	): Promise<
		| { files: Array<{ path: string; bytes: Uint8Array; sha256: string }> }
		| undefined
	>;
	put(
		key: string,
		artifact: {
			files: Array<{ path: string; bytes: Uint8Array; sha256: string }>;
		},
		signal?: AbortSignal,
	): Promise<void>;
}
export interface DeployAdapter {
	publish(
		generation: { id: string; directory: string; manifest: unknown },
		signal?: AbortSignal,
	): Promise<{ id: string; url?: string }>;
}
