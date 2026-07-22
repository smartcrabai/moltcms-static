#!/usr/bin/env bun

import { createApp } from "./index.js";

async function main(): Promise<void> {
	const values = process.argv.slice(2);
	if (values.includes("--help") || values.includes("-h")) {
		console.log("Usage: bun create moltcms-static <directory>");
		return;
	}
	const directory = values.find((value) => !value.startsWith("-"));
	if (directory === undefined)
		throw new Error("Usage: bun create moltcms-static <directory>");
	await createApp(directory);
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
