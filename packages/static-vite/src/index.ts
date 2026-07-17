import { createServer, type Plugin, type ViteDevServer } from "vite";
import {
	moltcmsRollup,
	type MoltcmsRollupOptions,
} from "@moltcms/static-rollup";

export interface ViteDevelopmentOptions {
	root?: string;
	port?: number;
	virtualModules: MoltcmsRollupOptions;
	render(pathname: string): Promise<Response>;
	watchFiles?: readonly string[];
}
export interface DevelopmentServer {
	server: ViteDevServer;
	close(): Promise<void>;
	invalidateContent(): void;
}
/** Creates Vite middleware mode with route rendering owned by the static core. */
export function viteDevelopment(options: ViteDevelopmentOptions) {
	return {
		async start(signal?: AbortSignal): Promise<DevelopmentServer> {
			const plugin = contentReloadPlugin(options.watchFiles ?? []);
			const server = await createServer({
				root: options.root,
				appType: "custom",
				plugins: [moltcmsRollup(options.virtualModules), plugin],
				server: { port: options.port },
			});
			server.middlewares.use(async (request, response, next) => {
				try {
					const rendered = await options.render(request.url ?? "/");
					response.statusCode = rendered.status;
					for (const [name, value] of rendered.headers)
						response.setHeader(name, value);
					response.end(Buffer.from(await rendered.arrayBuffer()));
				} catch (error) {
					next(error);
				}
			});
			await server.listen();
			if (signal !== undefined)
				signal.addEventListener(
					"abort",
					() => {
						void server.close();
					},
					{ once: true },
				);
			return {
				server,
				close: () => server.close(),
				invalidateContent: () => {
					for (const module of server.moduleGraph.getModulesByFile(
						"virtual:moltcms/content",
					) ?? [])
						server.moduleGraph.invalidateModule(
							module,
							new Set(),
							Date.now(),
							true,
						);
					server.ws.send({ type: "full-reload" });
				},
			};
		},
	};
}
function contentReloadPlugin(files: readonly string[]): Plugin {
	return {
		name: "moltcms-content-reload",
		configureServer(server) {
			for (const file of files) server.watcher.add(file);
		},
		handleHotUpdate(context) {
			if (!files.includes(context.file)) return;
			for (const module of context.modules)
				context.server.moduleGraph.invalidateModule(
					module,
					new Set(),
					context.timestamp,
					true,
				);
			context.server.ws.send({ type: "full-reload", path: "*" });
			return [];
		},
	};
}
