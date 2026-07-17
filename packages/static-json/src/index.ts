import { mkdir, open, readFile, readdir, rm, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import {
	openServerSyncStream,
	type ContentSchema,
	type DeliveryItem,
	type ServerSyncFetch,
	type ServerSyncStream,
} from "@moltcms/client";
import {
	atomicWrite,
	canonicalJson,
	ContentSnapshot,
	decodePathSegment,
	encodePathSegment,
	readJson,
	sha256,
	type ContentRecord,
	type Logger,
	type ProjectionState,
	silentLogger,
} from "@moltcms/static-core";

export type ProjectionKind = "published" | "draft";
export interface JsonProjectionOptions {
	root: string;
	siteId: string;
	kind: ProjectionKind;
}
export interface SyncProjectionOptions extends JsonProjectionOptions {
	syncUrl: string;
	apiKey: string;
	fetch?: ServerSyncFetch;
	signal?: AbortSignal;
	autoClose?: boolean;
	staleLockMilliseconds?: number;
	logger?: Logger;
}
export interface ProjectionSync {
	close(): void;
	readonly closed: boolean;
	readonly done: Promise<void>;
}
export function projectionDirectory(options: JsonProjectionOptions): string {
	return join(options.root, options.siteId, options.kind);
}
export function contentPath(
	options: JsonProjectionOptions,
	contentType: string,
	id: string,
): string {
	return join(
		projectionDirectory(options),
		"content",
		encodePathSegment(contentType),
		`${encodePathSegment(id)}.json`,
	);
}
export function schemaPath(
	options: JsonProjectionOptions,
	contentType: string,
	version: number,
): string {
	if (!Number.isSafeInteger(version) || version < 1)
		throw new RangeError("Schema version must be positive");
	return join(
		projectionDirectory(options),
		"schemas",
		encodePathSegment(contentType),
		`${version}.json`,
	);
}
export function statePath(options: JsonProjectionOptions): string {
	return join(projectionDirectory(options), "state.json");
}
/** Loads only a complete projection into a read-only indexed snapshot. */
export async function loadProjection(options: JsonProjectionOptions): Promise<{
	state: ProjectionState;
	snapshot: ContentSnapshot;
	schemas: ContentSchema[];
}> {
	const state = await readJson<ProjectionState>(statePath(options));
	if (state === undefined)
		throw new Error(`Projection state is missing: ${statePath(options)}`);
	if (state.status !== "complete")
		throw new Error(`Projection is not complete: ${statePath(options)}`);
	const [records, schemas] = await Promise.all([
		loadRecords(join(projectionDirectory(options), "content")),
		loadSchemas(join(projectionDirectory(options), "schemas")),
	]);
	return { state, snapshot: new ContentSnapshot(records, schemas), schemas };
}
async function loadRecords(root: string): Promise<ContentRecord[]> {
	const values: ContentRecord[] = [];
	for (const file of await files(root)) {
		const value = await readJson<ContentRecord>(file);
		if (value !== undefined) values.push(value);
	}
	return values.sort((left, right) =>
		`${left.content_type}\0${left.id}`.localeCompare(
			`${right.content_type}\0${right.id}`,
		),
	);
}
async function loadSchemas(root: string): Promise<ContentSchema[]> {
	const values: ContentSchema[] = [];
	for (const file of await files(root)) {
		const value = await readJson<ContentSchema>(file);
		if (value !== undefined) values.push(value);
	}
	return values.sort(
		(left, right) =>
			left.content_type.localeCompare(right.content_type) ||
			left.version - right.version,
	);
}
async function files(root: string): Promise<string[]> {
	try {
		const entries = await readdir(root, { withFileTypes: true });
		const nested = await Promise.all(
			entries.map(async (entry) =>
				entry.isDirectory()
					? files(join(root, entry.name))
					: entry.isFile() && entry.name.endsWith(".json")
						? [join(root, entry.name)]
						: [],
			),
		);
		return nested.flat();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}
/** Starts a transactional projection sync. Completion advances the opaque cursor only after all writes succeed. */
export async function syncProjection(
	options: SyncProjectionOptions,
): Promise<ProjectionSync> {
	if (options.apiKey.length === 0)
		throw new TypeError("apiKey must not be empty");
	const logger = options.logger ?? silentLogger;
	const directory = projectionDirectory(options);
	await mkdir(directory, { recursive: true });
	const lock = await acquireLock(
		directory,
		options.staleLockMilliseconds ?? 300_000,
	);
	const previous = await readJson<ProjectionState>(statePath(options));
	let lastCompleteCursor =
		previous?.status === "complete"
			? previous.cursor
			: previous?.previous_cursor;
	let cycleComplete = false;
	let released = false;
	const {
		promise: done,
		resolve: resolveDone,
		reject: rejectDone,
	} = Promise.withResolvers<void>();
	const release = async (): Promise<void> => {
		if (released) return;
		released = true;
		await lock.release();
	};
	const settle = async (error?: unknown): Promise<void> => {
		try {
			await release();
			if (error === undefined) resolveDone();
			else rejectDone(error);
		} catch (releaseError) {
			rejectDone(releaseError);
		}
	};
	const startCycle = async (): Promise<void> => {
		await atomicWrite(
			statePath(options),
			canonicalJson({
				format_version: 1,
				status: "syncing",
				...(lastCompleteCursor === undefined
					? {}
					: { previous_cursor: lastCompleteCursor }),
				run_id: crypto.randomUUID(),
			}),
		);
		cycleComplete = false;
	};
	await startCycle();
	let stream: ServerSyncStream | undefined;
	stream = openServerSyncStream<DeliveryItem>(
		options.syncUrl,
		{
			onChange: async (item) => {
				if (cycleComplete) await startCycle();
				await applyChange(options, item);
			},
			onComplete: async (cursor) => {
				const projection = await projectionFingerprint(options);
				await atomicWrite(
					statePath(options),
					canonicalJson({
						format_version: 1,
						status: "complete",
						cursor,
						projection_revision: projection.revision,
						schema_fingerprint: projection.schemaFingerprint,
					}),
				);
				lastCompleteCursor = cursor;
				cycleComplete = true;
				if (options.autoClose ?? true) await settle();
			},
			onError: async (message) => {
				if (options.autoClose ?? true)
					await settle(new Error(`Sync server error: ${message}`));
			},
			onTransportError: async (error) => {
				logger.error("Projection synchronization failed", {
					error: safeError(error),
				});
				if (stream?.closed) await settle(error);
			},
		},
		{
			apiKey: options.apiKey,
			kind: options.kind,
			cursor: lastCompleteCursor,
			fetch: options.fetch,
			signal: options.signal,
			autoClose: options.autoClose,
		},
	);
	if (options.signal !== undefined) {
		const abort = (): void => {
			stream?.close();
			void settle(
				options.signal?.reason ?? new DOMException("Aborted", "AbortError"),
			);
		};
		if (options.signal.aborted) abort();
		else options.signal.addEventListener("abort", abort, { once: true });
	}
	return {
		close() {
			stream?.close();
			void settle();
		},
		get closed() {
			return stream?.closed ?? true;
		},
		done,
	};
}
async function applyChange(
	options: SyncProjectionOptions,
	item: DeliveryItem,
): Promise<void> {
	if (item.type === "schema_changed") {
		await atomicWrite(
			schemaPath(options, item.content_type, item.version),
			canonicalJson({
				content_type: item.content_type,
				version: item.version,
				fields: item.fields,
			}),
		);
		return;
	}
	const path = contentPath(options, item.content_type, item.id);
	const current = await readJson<ContentRecord>(path);
	if (current !== undefined && current.seq >= item.seq) return;
	if (item.type === "content") {
		const expectedSchema = schemaPath(
			options,
			item.content_type,
			item.schema_version,
		);
		try {
			await stat(expectedSchema);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			throw new Error(
				`Schema ${item.content_type}@${item.schema_version} was not delivered before content ${item.id}`,
			);
		}
	}
	await atomicWrite(path, canonicalJson(item));
}
async function projectionFingerprint(
	options: JsonProjectionOptions,
): Promise<{ revision: string; schemaFingerprint: string }> {
	const [content, schemas] = await Promise.all([
		files(join(projectionDirectory(options), "content")),
		files(join(projectionDirectory(options), "schemas")),
	]);
	const root = projectionDirectory(options);
	const digest = async (paths: readonly string[]): Promise<string> =>
		sha256(
			(
				await Promise.all(
					[...paths]
						.sort()
						.map(
							async (path) =>
								`${relative(root, path).replaceAll("\\", "/")}:${sha256(await readFile(path))}`,
						),
				)
			).join("\n"),
		);
	return {
		revision: await digest(content),
		schemaFingerprint: await digest(schemas),
	};
}
interface Lock {
	release(): Promise<void>;
}
async function acquireLock(
	directory: string,
	staleMilliseconds: number,
): Promise<Lock> {
	const path = join(directory, ".sync.lock");
	const payload = JSON.stringify({ pid: process.pid, createdAt: Date.now() });
	try {
		const file = await open(path, "wx");
		await file.writeFile(payload);
		await file.sync();
		await file.close();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		const existing = await readJson<{ pid?: number; createdAt?: number }>(path);
		const stale =
			existing?.createdAt !== undefined &&
			Date.now() - existing.createdAt > staleMilliseconds;
		let alive = true;
		if (stale && existing?.pid !== undefined) {
			try {
				process.kill(existing.pid, 0);
			} catch (probe) {
				alive = (probe as NodeJS.ErrnoException).code !== "ESRCH";
			}
		}
		if (!stale || alive) throw new Error(`Sync lock is held at ${path}`);
		await rm(path);
		return acquireLock(directory, staleMilliseconds);
	}
	return {
		async release() {
			await rm(path, { force: true });
		},
	};
}
function safeError(error: unknown): string {
	return error instanceof Error
		? error.message.replace(
				/Bearer\s+[^\s]+|api[_-]?key[=:]\s*[^\s]+/gi,
				"[REDACTED]",
			)
		: "Unknown error";
}
/** Validates codec behavior while keeping decode reachable for consumers that inspect projections. */
export const pathSegmentCodec = {
	encode: encodePathSegment,
	decode: decodePathSegment,
};
