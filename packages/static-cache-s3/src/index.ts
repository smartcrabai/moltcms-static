import {
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import {
	canonicalJson,
	sha256,
	type ArtifactCache,
} from "@moltcms/static-core";

export interface S3CacheOptions {
	bucket: string;
	prefix?: string;
	endpoint?: string;
	region?: string;
	forcePathStyle?: boolean;
	credentials?: {
		accessKeyId: string;
		secretAccessKey: string;
		sessionToken?: string;
	};
	client?: S3Client;
	failures?: "fatal" | "best-effort";
}
interface StoredArtifact {
	files: Array<{ path: string; base64: string; sha256: string }>;
}
/** S3-compatible content-addressed artifact cache. Corrupt records are cache misses. */
export function s3ArtifactCache(options: S3CacheOptions): ArtifactCache {
	const client =
		options.client ??
		new S3Client({
			endpoint: options.endpoint,
			region: options.region ?? "auto",
			forcePathStyle: options.forcePathStyle ?? options.endpoint !== undefined,
			credentials: options.credentials,
		});
	const objectKey = (key: string): string =>
		`${options.prefix?.replace(/\/+$/, "") ?? "moltcms-static-cache"}/${sha256(key)}.json`;
	return {
		async get(key, signal) {
			try {
				const response = await client.send(
					new GetObjectCommand({ Bucket: options.bucket, Key: objectKey(key) }),
					{ abortSignal: signal },
				);
				if (response.Body === undefined) return undefined;
				const stored = JSON.parse(
					new TextDecoder().decode(await response.Body.transformToByteArray()),
				) as StoredArtifact;
				const files = stored.files.map((file) => ({
					path: validatePath(file.path),
					bytes: Uint8Array.from(Buffer.from(file.base64, "base64")),
					sha256: file.sha256,
				}));
				if (files.some((file) => sha256(file.bytes) !== file.sha256))
					return undefined;
				return { files };
			} catch (error) {
				if (isNotFound(error) || options.failures === "best-effort")
					return undefined;
				throw error;
			}
		},
		async put(key, artifact, signal) {
			try {
				for (const file of artifact.files) {
					validatePath(file.path);
					if (sha256(file.bytes) !== file.sha256)
						throw new Error(`Artifact checksum mismatch: ${file.path}`);
				}
				const body: StoredArtifact = {
					files: artifact.files.map((file) => ({
						path: file.path,
						base64: Buffer.from(file.bytes).toString("base64"),
						sha256: file.sha256,
					})),
				};
				await client.send(
					new PutObjectCommand({
						Bucket: options.bucket,
						Key: objectKey(key),
						Body: canonicalJson(body),
						ContentType: "application/json",
					}),
					{ abortSignal: signal },
				);
			} catch (error) {
				if (options.failures === "best-effort") return;
				throw error;
			}
		},
	};
}
function validatePath(path: string): string {
	if (
		path.length === 0 ||
		path.includes("\0") ||
		path
			.split(/[\\/]+/)
			.some((part) => part === "." || part === ".." || part.length === 0)
	)
		throw new Error(`Unsafe cached artifact path: ${JSON.stringify(path)}`);
	return path;
}
function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"$metadata" in error &&
		(error as { $metadata?: { httpStatusCode?: number } }).$metadata
			?.httpStatusCode === 404
	);
}
