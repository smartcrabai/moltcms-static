import {
	fetchSyncSchemaVersion,
	type SyncSchemaRequestOptions,
} from "./schema-client.js";
import {
	openSyncStream,
	type SyncStream,
	type SyncStreamOptions,
} from "./sync-stream.js";
import type {
	ContentChange,
	ContentDeleted,
	ContentSchema,
	DeliveryItem,
	FieldDef,
	SchemaChanged,
} from "./types.js";

/** A generated mapping from content-type literals to exact schema-version data shapes. */
export type SchemaTypeMap = object;
/** Runtime counterpart of generated schema versions, coupled to S. */
export type SchemaVersionIndex<S extends SchemaTypeMap> = {
	readonly [C in keyof S & string]: readonly (keyof S[C] & number)[];
};
type TypedContentChange<S extends SchemaTypeMap> = {
	[C in keyof S & string]: {
		[V in keyof S[C] & number]: Omit<
			ContentChange,
			"content_type" | "schema_version" | "data"
		> & { content_type: C; schema_version: V; data: S[C][V] };
	}[keyof S[C] & number];
}[keyof S & string];
type TypedContentDeleted<S extends SchemaTypeMap> = Omit<
	ContentDeleted,
	"content_type"
> & { content_type: keyof S & string };
/** A sync item narrowed to generated content types and schema versions. */
export type TypedDeliveryItem<S extends SchemaTypeMap> =
	| TypedContentChange<S>
	| TypedContentDeleted<S>
	| SchemaChanged;
export interface TypedSyncStreamHandlers<S extends SchemaTypeMap> {
	onChange: (item: TypedDeliveryItem<S>, seq: string) => void | Promise<void>;
	onComplete?: (cursor: string) => void | Promise<void>;
	onError?: (message: string) => void | Promise<void>;
	onTransportError?: (error: unknown) => void | Promise<void>;
}
export interface TypedSyncStreamOptions<S extends SchemaTypeMap>
	extends SyncStreamOptions {
	schemaVersions: SchemaVersionIndex<S>;
}
/** A schema version was not present in the generated type module. */
export class UnknownGeneratedSchemaVersionError extends Error {
	constructor(contentType: string, version: number) {
		super(
			`No generated schema exists for content type ${contentType} version ${version}`,
		);
		this.name = "UnknownGeneratedSchemaVersionError";
	}
}
/** A received content item did not conform to its exact moltcms schema version. */
export class SyncItemValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SyncItemValidationError";
	}
}
/** Opens a schema-validated sync stream that fails closed for unknown versions. */
export function openTypedSyncStream<S extends SchemaTypeMap>(
	syncUrl: string,
	handlers: TypedSyncStreamHandlers<S>,
	options: TypedSyncStreamOptions<S>,
): SyncStream {
	const schemas = new Map<string, Promise<ContentSchema>>();
	const versions = options.schemaVersions as Record<string, readonly number[]>;
	return openSyncStream<DeliveryItem>(
		syncUrl,
		{
			onChange: async (item, seq) => {
				if (item.type === "content") {
					if (!versions[item.content_type]?.includes(item.schema_version))
						throw new UnknownGeneratedSchemaVersionError(
							item.content_type,
							item.schema_version,
						);
					const key = `${item.content_type}\0${item.schema_version}`;
					let schema = schemas.get(key);
					if (schema === undefined) {
						schema = fetchSyncSchemaVersion(
							syncUrl,
							item.content_type,
							item.schema_version,
							{
								apiKey: options.apiKey,
								fetch: options.fetch,
								signal: options.signal,
							} satisfies SyncSchemaRequestOptions,
						);
						schemas.set(key, schema);
					}
					validateContentItem(item, await schema);
				}
				await handlers.onChange(item as TypedDeliveryItem<S>, seq);
			},
			onComplete: handlers.onComplete,
			onError: handlers.onError,
			onTransportError: handlers.onTransportError,
		},
		options,
	);
}
function validateContentItem(item: ContentChange, schema: ContentSchema): void {
	if (
		schema.content_type !== item.content_type ||
		schema.version !== item.schema_version
	)
		throw new SyncItemValidationError(
			`Schema response does not match ${item.content_type} version ${item.schema_version}`,
		);
	const fields = new Map(schema.fields.map((field) => [field.name, field]));
	for (const name of Object.keys(item.data))
		if (!fields.has(name))
			throw new SyncItemValidationError(
				`Unknown field ${name} in ${item.content_type}`,
			);
	for (const field of schema.fields)
		validateField(item.data[field.name], field);
}
function validateField(value: unknown, field: FieldDef): void {
	if (value === undefined || value === null) {
		if (field.required)
			throw new SyncItemValidationError(
				`Required field ${field.name} is missing`,
			);
		return;
	}
	const invalid = (): never => {
		throw new SyncItemValidationError(
			`Field ${field.name} has an invalid value`,
		);
	};
	switch (field.kind) {
		case "string":
			if (
				typeof value !== "string" ||
				(field.max_len !== undefined &&
					field.max_len !== null &&
					value.length > field.max_len)
			)
				invalid();
			break;
		case "text":
		case "datetime":
			if (typeof value !== "string") invalid();
			break;
		case "number":
			if (
				typeof value !== "number" ||
				!Number.isFinite(value) ||
				(field.min !== undefined && field.min !== null && value < field.min) ||
				(field.max !== undefined && field.max !== null && value > field.max) ||
				(field.integer === true && !Number.isInteger(value))
			)
				invalid();
			break;
		case "boolean":
			if (typeof value !== "boolean") invalid();
			break;
		case "image":
		case "relation":
			if (
				field.multiple === true
					? !Array.isArray(value) ||
						value.some((entry) => typeof entry !== "string")
					: typeof value !== "string"
			)
				invalid();
			break;
		case "select": {
			const values = field.multiple === true ? value : [value];
			if (
				!Array.isArray(values) ||
				values.some(
					(entry) =>
						typeof entry !== "string" || !field.options.includes(entry),
				)
			)
				invalid();
			break;
		}
		case "richtext":
		case "json":
			break;
	}
}
