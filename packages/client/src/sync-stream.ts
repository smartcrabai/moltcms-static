import type { DeliveryItem } from "./types.js";

/** A fetch implementation used to open the sync stream. */
export type SyncFetch = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;
export interface SyncStreamHandlers<Item> {
	onChange: (item: Item, seq: string) => void | Promise<void>;
	onComplete?: (cursor: string) => void | Promise<void>;
	onError?: (message: string) => void | Promise<void>;
	onTransportError?: (error: unknown) => void | Promise<void>;
}
export interface SyncStreamOptions {
	apiKey: string;
	cursor?: string;
	kind?: "published" | "draft";
	autoClose?: boolean;
	signal?: AbortSignal;
	fetch?: SyncFetch;
}
export interface SyncStream {
	close: () => void;
	readonly closed: boolean;
}
/** An unsuccessful HTTP response while opening the sync feed. */
export class SyncHttpError extends Error {
	readonly status: number;
	readonly statusText: string;
	constructor(response: Response) {
		super(
			`Sync request failed with HTTP ${response.status} ${response.statusText}`,
		);
		this.name = "SyncHttpError";
		this.status = response.status;
		this.statusText = response.statusText;
	}
}
interface SseMessage {
	event: string;
	data: string;
	id: string | undefined;
}
const defaultRetryMilliseconds = 3_000;

/** Opens an authenticated, reconnecting client for a moltcms sync SSE feed. */
export function openSyncStream<Item = DeliveryItem>(
	syncUrl: string,
	handlers: SyncStreamHandlers<Item>,
	options: SyncStreamOptions,
): SyncStream {
	if (options.apiKey.length === 0)
		throw new TypeError("SyncStreamOptions.apiKey must not be empty");
	const url = new URL(
		syncUrl,
		typeof location === "undefined" ? undefined : location.href,
	);
	if (options.cursor !== undefined)
		url.searchParams.set("cursor", options.cursor);
	if (options.kind !== undefined) url.searchParams.set("kind", options.kind);
	const shutdown = new AbortController();
	const request = options.fetch ?? globalThis.fetch;
	const autoClose = options.autoClose ?? true;
	let activeRequest: AbortController | undefined;
	let closed = false;
	let lastEventId: string | undefined;
	let retryMilliseconds = defaultRetryMilliseconds;
	const close = (): void => {
		if (closed) return;
		closed = true;
		activeRequest?.abort();
		shutdown.abort();
	};
	if (options.signal !== undefined) {
		if (options.signal.aborted) close();
		else options.signal.addEventListener("abort", close, { once: true });
	}
	void consume();
	return {
		close,
		get closed(): boolean {
			return closed;
		},
	};
	async function consume(): Promise<void> {
		while (!closed) {
			const controller = new AbortController();
			activeRequest = controller;
			const abortRequest = (): void => controller.abort();
			shutdown.signal.addEventListener("abort", abortRequest, { once: true });
			try {
				const response = await request(url, {
					headers: syncHeaders(options.apiKey, lastEventId),
					signal: controller.signal,
				});
				if (!response.ok) {
					close();
					await handlers.onTransportError?.(new SyncHttpError(response));
					return;
				}
				if (response.body === null)
					throw new TypeError("Sync response did not include a body");
				await parseSse(
					response.body,
					async (message) => {
						if (closed) return;
						if (message.event === "change") {
							try {
								const item = JSON.parse(message.data) as Item;
								await handlers.onChange(item, message.id ?? "");
								if (message.id !== undefined) lastEventId = message.id;
							} catch (error) {
								close();
								await handlers.onTransportError?.(error);
							}
						} else if (message.event === "sync-complete") {
							try {
								const cursor: unknown = JSON.parse(message.data);
								if (typeof cursor !== "string")
									throw new TypeError(
										"sync-complete data must be a JSON string",
									);
								if (autoClose) close();
								await handlers.onComplete?.(cursor);
							} catch (error) {
								close();
								await handlers.onTransportError?.(error);
							}
						} else if (message.event === "error") {
							if (autoClose) close();
							await handlers.onError?.(message.data);
						}
					},
					(milliseconds) => {
						retryMilliseconds = milliseconds;
					},
				);
			} catch (error) {
				if (!closed) await handlers.onTransportError?.(error);
			} finally {
				shutdown.signal.removeEventListener("abort", abortRequest);
				if (activeRequest === controller) activeRequest = undefined;
			}
			if (!closed) await delay(retryMilliseconds, shutdown.signal);
		}
	}
}
function syncHeaders(apiKey: string, lastEventId: string | undefined): Headers {
	const headers = new Headers({
		accept: "text/event-stream",
		authorization: `Bearer ${apiKey}`,
	});
	if (lastEventId !== undefined && lastEventId.length > 0)
		headers.set("last-event-id", lastEventId);
	return headers;
}
async function parseSse(
	body: ReadableStream<Uint8Array>,
	onMessage: (message: SseMessage) => Promise<void>,
	onRetry: (milliseconds: number) => void,
): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let event = "message";
	let data: string[] = [];
	let id: string | undefined;
	const dispatch = async (): Promise<void> => {
		if (data.length > 0) await onMessage({ event, data: data.join("\n"), id });
		event = "message";
		data = [];
		id = undefined;
	};
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) return;
			buffer += decoder.decode(chunk.value, { stream: true });
			let newline = buffer.indexOf("\n");
			while (newline !== -1) {
				const line = buffer.slice(0, newline).replace(/\r$/, "");
				buffer = buffer.slice(newline + 1);
				if (line.length === 0) await dispatch();
				else if (!line.startsWith(":")) {
					const separator = line.indexOf(":");
					const field = separator === -1 ? line : line.slice(0, separator);
					const value = line
						.slice(separator === -1 ? line.length : separator + 1)
						.replace(/^ /, "");
					if (field === "event") event = value;
					else if (field === "data") data.push(value);
					else if (field === "id" && !value.includes("\0")) id = value;
					else if (field === "retry" && /^\d+$/.test(value))
						onRetry(Number(value));
				}
				newline = buffer.indexOf("\n");
			}
		}
	} finally {
		reader.releaseLock();
	}
}
function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	const timer = setTimeout(resolve, milliseconds);
	const abort = (): void => {
		clearTimeout(timer);
		resolve();
	};
	signal.addEventListener("abort", abort, { once: true });
	return promise.finally(() => signal.removeEventListener("abort", abort));
}
