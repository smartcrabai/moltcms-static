import {
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import {
	canonicalJson,
	sha256,
	type DeployAdapter,
} from "@moltcms/static-core";

export interface S3DeployOptions {
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
}
interface GenerationManifest {
	id: string;
	files: Array<{ path: string; sha256: string; mediaType: string }>;
}
/** Publishes immutable objects first and updates the current pointer only after every upload succeeds. */
export function s3Deploy(options: S3DeployOptions): DeployAdapter {
	const client =
		options.client ??
		new S3Client({
			endpoint: options.endpoint,
			region: options.region ?? "auto",
			forcePathStyle: options.forcePathStyle ?? options.endpoint !== undefined,
			credentials: options.credentials,
		});
	const key = (suffix: string): string =>
		`${options.prefix?.replace(/\/+$/, "") ?? "moltcms-static"}/${suffix}`;
	return {
		async publish(generation, signal) {
			const files = await listFiles(generation.directory);
			const manifest: GenerationManifest = { id: generation.id, files: [] };
			for (const file of files) {
				const bytes = await readFile(file.absolute);
				const hash = sha256(bytes);
				const object = key(`objects/${hash}`);
				try {
					await client.send(
						new HeadObjectCommand({ Bucket: options.bucket, Key: object }),
						{ abortSignal: signal },
					);
				} catch (error) {
					if (!isNotFound(error)) throw error;
					await client.send(
						new PutObjectCommand({
							Bucket: options.bucket,
							Key: object,
							Body: bytes,
							ContentType: contentType(file.relative),
							CacheControl: "public, max-age=31536000, immutable",
							Metadata: { sha256: hash },
						}),
						{ abortSignal: signal },
					);
				}
				manifest.files.push({
					path: file.relative,
					sha256: hash,
					mediaType: contentType(file.relative),
				});
			}
			manifest.files.sort((left, right) => left.path.localeCompare(right.path));
			await client.send(
				new PutObjectCommand({
					Bucket: options.bucket,
					Key: key(`generations/${generation.id}/manifest.json`),
					Body: canonicalJson(manifest),
					ContentType: "application/json",
					CacheControl: "no-store",
				}),
				{ abortSignal: signal },
			);
			await client.send(
				new PutObjectCommand({
					Bucket: options.bucket,
					Key: key("current.json"),
					Body: canonicalJson({
						id: generation.id,
						manifest: `generations/${generation.id}/manifest.json`,
					}),
					ContentType: "application/json",
					CacheControl: "no-store",
				}),
				{ abortSignal: signal },
			);
			return { id: generation.id };
		},
	};
}
async function listFiles(
	root: string,
): Promise<Array<{ absolute: string; relative: string }>> {
	const result: Array<{ absolute: string; relative: string }> = [];
	const visit = async (directory: string): Promise<void> => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const absolute = join(directory, entry.name);
			if (entry.isDirectory()) await visit(absolute);
			else if (entry.isFile())
				result.push({
					absolute,
					relative: relative(root, absolute).replaceAll("\\", "/"),
				});
		}
	};
	await visit(root);
	return result;
}
function contentType(path: string): string {
	if (path.endsWith(".html")) return "text/html; charset=utf-8";
	if (path.endsWith(".xml")) return "application/xml";
	if (path.endsWith(".js")) return "text/javascript";
	if (path.endsWith(".css")) return "text/css";
	if (path.endsWith(".json")) return "application/json";
	return "application/octet-stream";
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
