import {
	cp,
	lstat,
	mkdir,
	readFile,
	readdir,
	realpath,
	rm,
} from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import {
	build,
	context,
	type BuildContext,
	type BuildOptions,
	type BuildResult,
	type Plugin,
} from "esbuild";
import { atomicWrite, canonicalJson, sha256 } from "@moltcms/static-core";

export interface EsbuildAssetsOptions {
	entries: Record<string, string>;
	publicDir?: string;
	minify?: boolean;
	sourcemap?: boolean;
	define?: Record<string, string>;
	serverOnlyModules?: readonly string[];
}
export interface AssetBuild {
	manifest: Record<string, string>;
	sourceModules: Record<string, string>;
	dispose(): Promise<void>;
}
/** Creates a browser-only esbuild asset adapter with deterministic hashed filenames. */
export function esbuildAssets(options: EsbuildAssetsOptions) {
	let developmentContext: BuildContext | undefined;
	const buildOptions = (outDir: string): BuildOptions => ({
		entryPoints: options.entries,
		outdir: outDir,
		bundle: true,
		format: "esm",
		platform: "browser",
		target: "es2022",
		minify: options.minify ?? true,
		sourcemap: options.sourcemap ?? false,
		metafile: true,
		entryNames: "assets/[name]-[hash]",
		assetNames: "assets/[name]-[hash]",
		define: options.define,
		plugins: [rejectServerOnly(options.serverOnlyModules ?? [])],
		logLevel: "silent",
	});
	return {
		async build(outDir: string): Promise<AssetBuild> {
			await rm(outDir, { recursive: true, force: true });
			await mkdir(outDir, { recursive: true });
			const result = await build(buildOptions(outDir));
			await copyPublic(options.publicDir, outDir);
			return resultToAssetBuild(result, outDir, options.entries);
		},
		async rebuild(outDir: string): Promise<AssetBuild> {
			if (developmentContext === undefined)
				developmentContext = await context(buildOptions(outDir));
			const result = await developmentContext.rebuild();
			return resultToAssetBuild(result, outDir, options.entries);
		},
		async dispose(): Promise<void> {
			await developmentContext?.dispose();
			developmentContext = undefined;
		},
	};
}
/** Resolves a server page entry and every esbuild-reachable source module to content hashes. */
export async function serverModuleGraph(
	entries: readonly string[],
): Promise<Record<string, string>> {
	const result = await build({
		entryPoints: [...entries],
		bundle: true,
		platform: "node",
		format: "esm",
		write: false,
		metafile: true,
		logLevel: "silent",
	});
	const hashes: Record<string, string> = {};
	for (const input of Object.keys(result.metafile?.inputs ?? {}).sort())
		hashes[input] = sha256(await readFile(input));
	return hashes;
}
function rejectServerOnly(modules: readonly string[]): Plugin {
	return {
		name: "moltcms-server-only",
		setup(build) {
			build.onResolve({ filter: /.*/ }, (args) =>
				modules.some(
					(module) =>
						args.path === module || args.path.startsWith(`${module}/`),
				)
					? {
							errors: [
								{
									text: `Server-only module ${args.path} cannot be imported by browser assets`,
								},
							],
						}
					: undefined,
			);
		},
	};
}
async function resultToAssetBuild(
	result: BuildResult,
	outDir: string,
	entries: Record<string, string>,
): Promise<AssetBuild> {
	const outputs = result.metafile?.outputs ?? {};
	const manifest: Record<string, string> = {};
	const sourceModules: Record<string, string> = {};
	for (const [output, metadata] of Object.entries(outputs)) {
		const entryPoint = metadata.entryPoint;
		if (entryPoint === undefined) continue;
		const name = Object.entries(entries).find(
			([, entry]) => resolve(entry) === resolve(entryPoint),
		)?.[0];
		if (name !== undefined)
			manifest[name] = `/${relative(outDir, output).replaceAll("\\", "/")}`;
		for (const input of Object.keys(metadata.inputs))
			sourceModules[input] = sha256(await readFile(input));
	}
	await atomicWrite(
		join(outDir, "asset-manifest.json"),
		canonicalJson(manifest),
	);
	return { manifest, sourceModules, async dispose() {} };
}
async function copyPublic(
	publicDir: string | undefined,
	outDir: string,
): Promise<void> {
	if (publicDir === undefined) return;
	let root: string;
	try {
		root = await realpath(publicDir);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	const copy = async (source: string, destination: string): Promise<void> => {
		for (const entry of await readdir(source, { withFileTypes: true })) {
			const from = join(source, entry.name);
			const to = join(destination, entry.name);
			const metadata = await lstat(from);
			if (metadata.isSymbolicLink()) {
				const target = await realpath(from);
				if (!target.startsWith(`${root}/`) && target !== root)
					throw new Error(`Public symlink escapes root: ${from}`);
			}
			if (entry.isDirectory()) {
				await mkdir(to, { recursive: true });
				await copy(from, to);
			} else if (entry.isFile() || metadata.isSymbolicLink()) {
				await mkdir(dirname(to), { recursive: true });
				await cp(from, to);
			}
		}
	};
	await copy(root, outDir);
}
export function islandProps(value: unknown): string {
	return JSON.stringify(value)
		.replaceAll("<", "\\u003c")
		.replaceAll("\u2028", "\\u2028")
		.replaceAll("\u2029", "\\u2029");
}
export function mediaType(path: string): string {
	return extname(path) === ".css"
		? "text/css"
		: extname(path) === ".js"
			? "text/javascript"
			: "application/octet-stream";
}
