#!/usr/bin/env bun

import { exists, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createApp } from "create-moltcms-static";
import {
	buildSite,
	codegenSite,
	planSite,
	synchronizeSite,
	type StaticConfig,
} from "./index.js";

interface Arguments {
	command: string;
	directory?: string;
	config: string;
	site?: string;
	output?: string;
	json: boolean;
	dryRun: boolean;
	explain: boolean;
	gitCommit: boolean;
	allowDirty: boolean;
}
async function main(): Promise<void> {
	const args = parse(process.argv.slice(2));
	if (args.command === "init") {
		await initialize(args.config);
		return;
	}
	if (args.command === "create-app" || args.command === "create") {
		if (args.directory === undefined)
			throw new Error("Usage: moltcms-static create-app <directory>");
		await createApp(args.directory);
		return;
	}
	const config = await loadConfig(args.config);
	const sites =
		args.site === undefined
			? config.sites
			: config.sites.filter((site) => site.id === args.site);
	if (sites.length === 0)
		throw new Error(`No configured site matches ${args.site ?? "selection"}`);
	if (args.command === "sync") {
		for (const site of sites) {
			await synchronizeSite(site);
			if (args.gitCommit)
				await commitProjection(
					site.source.projectionDir,
					site.id,
					site.source.kind,
					args.allowDirty,
				);
			print(args, { site: site.id, status: "synced" });
		}
		return;
	}
	if (args.command === "codegen") {
		for (const site of sites) {
			const output = args.output ?? "src/moltcms.generated.ts";
			await codegenSite(site, output);
			print(args, { site: site.id, output });
		}
		return;
	}
	if (args.command === "plan") {
		for (const site of sites) print(args, await planSite(site));
		return;
	}
	if (args.command === "build") {
		for (const site of sites) {
			if (args.dryRun) {
				print(args, {
					site: site.id,
					plan: await planSite(site),
					dryRun: true,
				});
				continue;
			}
			const report = await buildSite(site);
			print(
				args,
				args.explain
					? report
					: {
							site: site.id,
							rendered: report.rendered.length,
							reused: report.reused.length,
							removed: report.removed.length,
						},
			);
		}
		return;
	}
	if (args.command === "inspect") {
		for (const site of sites)
			print(
				args,
				await Bun.file(
					`${site.cacheDir ?? ".cache/moltcms-static"}/route-state/routes.json`,
				).json(),
			);
		return;
	}
	if (args.command === "doctor") {
		for (const site of sites)
			print(args, {
				site: site.id,
				bun: Bun.version,
				config: true,
				projection: await exists(
					`${site.source.projectionDir}/${site.source.kind}/state.json`,
				),
				cache: await exists(site.cacheDir ?? ".cache/moltcms-static"),
				outDir: site.outDir,
			});
		return;
	}
	if (args.command === "clean") {
		for (const site of sites) {
			await rm(site.cacheDir ?? ".cache/moltcms-static", {
				recursive: true,
				force: true,
			});
			await rm(site.outDir, { recursive: true, force: true });
			print(args, { site: site.id, cleaned: true });
		}
		return;
	}
	if (args.command === "preview") {
		const site = sites[0];
		if (site === undefined) throw new Error("No site");
		const server = Bun.serve({
			port: 4173,
			fetch(request) {
				const path = new URL(request.url).pathname;
				const file =
					path === "/"
						? "index.html"
						: `${path.replace(/^\//, "")}${path.endsWith("/") ? "index.html" : ""}`;
				return new Response(Bun.file(resolve(site.outDir, file)));
			},
		});
		console.log(`Previewing ${site.id} on http://localhost:${server.port}`);
		const { promise } = Promise.withResolvers<void>();
		await promise;
	}
	if (args.command === "finalize") {
		for (const site of sites) {
			const report = await buildSite(site);
			print(args, { site: site.id, finalized: true, report });
		}
		return;
	}
	if (args.command === "dev") {
		const controller = new AbortController();
		const stop = (): void => controller.abort();
		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
		const servers = await Promise.all(
			sites.map(async (site) => {
				if (site.development === undefined)
					throw new Error(
						`Site ${site.id} does not configure a development adapter`,
					);
				return site.development.start(controller.signal);
			}),
		);
		const { promise, resolve } = Promise.withResolvers<void>();
		controller.signal.addEventListener("abort", () => resolve(), {
			once: true,
		});
		try {
			await promise;
		} finally {
			await Promise.all(servers.map((server) => server.close()));
		}
		return;
	}
	throw new Error(`Unknown command ${args.command}`);
}
function parse(values: readonly string[]): Arguments {
	const command = values[0] ?? "build";
	const options: Arguments = {
		command,
		config: "moltcms.config.ts",
		json: false,
		dryRun: false,
		explain: false,
		gitCommit: false,
		allowDirty: false,
	};
	for (let index = 1; index < values.length; index += 1) {
		const value = values[index];
		if (value === undefined) continue;
		if (!value.startsWith("-") && options.directory === undefined)
			options.directory = value;
		if (value === "--config")
			options.config = values[++index] ?? options.config;
		else if (value === "--site") options.site = values[++index];
		else if (value === "--output" || value === "--plan")
			options.output = values[++index];
		else if (value === "--json") options.json = true;
		else if (value === "--dry-run") options.dryRun = true;
		else if (value === "--explain") options.explain = true;
		else if (value === "--git-commit") options.gitCommit = true;
		else if (value === "--allow-dirty") options.allowDirty = true;
	}
	return options;
}
async function loadConfig(path: string): Promise<StaticConfig> {
	// Runtime-selected user configuration cannot be statically imported.
	const module = await import(pathToFileURL(resolve(path)).href);
	if (!("default" in module))
		throw new Error(`Config ${path} must have a default export`);
	return module.default as StaticConfig;
}
async function initialize(path: string): Promise<void> {
	if (await exists(path)) throw new Error(`${path} already exists`);
	await Bun.write(
		path,
		"import { defineConfig } from '@moltcms/static';\n\nexport default defineConfig({ sites: [] });\n",
	);
}
async function git(args: readonly string[]): Promise<string> {
	const process = Bun.spawn(["git", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	if (exitCode !== 0) throw new Error(`git ${args[0] ?? ""} failed: ${stderr}`);
	return stdout;
}
async function commitProjection(
	directory: string,
	site: string,
	kind: string,
	allowDirty: boolean,
): Promise<void> {
	const dirty = await git(["status", "--porcelain"]);
	if (
		!allowDirty &&
		dirty.trim().length > 0 &&
		dirty.split("\n").some((line) => !line.endsWith(directory))
	)
		throw new Error(
			"Repository has unrelated dirty files; use --allow-dirty to continue",
		);
	await git(["add", "--", directory]);
	const names = await git(["diff", "--cached", "--name-only"]);
	if (names.trim().length === 0) return;
	await git([
		"commit",
		"-m",
		`moltcms sync ${site}/${kind} (${names.trim().split("\n").length} changes)`,
	]);
}
function print(args: Arguments, value: unknown): void {
	if (args.json) console.log(JSON.stringify(value));
	else
		console.log(
			typeof value === "string" ? value : JSON.stringify(value, null, 2),
		);
}
main().catch((error: unknown) => {
	console.error(
		error instanceof Error ? (error.stack ?? error.message) : String(error),
	);
	process.exitCode = 1;
});
