import type { Plugin } from "rollup";
import { canonicalJson, type ContentSnapshot } from "@moltcms/static-core";

export interface MoltcmsRollupOptions {
	snapshot(): ContentSnapshot;
	schemaVersions: unknown;
	assets: Record<string, string>;
	projectionRevision(): string;
	client?: boolean;
}
const prefix = "\0virtual:moltcms:";
/** A Rollup-compatible virtual module plugin shared by the Vite adapter. */
export function moltcmsRollup(options: MoltcmsRollupOptions): Plugin {
	return {
		name: "moltcms-static-virtual-modules",
		resolveId(source) {
			return source.startsWith("virtual:moltcms/")
				? `${prefix}${source.slice("virtual:moltcms/".length)}`
				: null;
		},
		load(id) {
			if (!id.startsWith(prefix)) return null;
			const name = id.slice(prefix.length);
			if (options.client && (name === "content" || name === "schema"))
				this.error(
					`virtual:moltcms/${name} is server-only and cannot be imported by a client bundle`,
				);
			if (name === "content")
				return `export const projectionRevision = ${JSON.stringify(options.projectionRevision())}; export default ${canonicalJson(options.snapshot().records).trim()};`;
			if (name === "schema")
				return `export const projectionRevision = ${JSON.stringify(options.projectionRevision())}; export default ${canonicalJson(options.schemaVersions).trim()};`;
			if (name === "assets")
				return `export default ${canonicalJson(options.assets).trim()};`;
			this.error(`Unknown moltcms virtual module ${name}`);
		},
		watchChange() {
			this.addWatchFile?.(options.projectionRevision());
		},
	};
}
