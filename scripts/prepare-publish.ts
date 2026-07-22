import { cp, readdir, readFile, writeFile } from "node:fs/promises";
const packagesDirectory = new URL("../packages/", import.meta.url);
const license = new URL("../LICENSE", import.meta.url);

for (const entry of await readdir(packagesDirectory, { withFileTypes: true })) {
	if (!entry.isDirectory() || entry.name === "client") continue;
	const directory = new URL(`${entry.name}/`, packagesDirectory);
	const manifest = JSON.parse(
		await readFile(new URL("package.json", directory), "utf8"),
	) as { name: string; description?: string };
	if (
		!manifest.name.startsWith("@moltcms/static") &&
		manifest.name !== "create-moltcms-static"
	)
		continue;
	const readme =
		manifest.name === "@moltcms/static"
			? `# ${manifest.name}\n\n${manifest.description ?? "moltcms static-site package."}\n\n## Runtime\n\nThis facade and its CLI require **Bun 1.3 or later**. Node.js alone cannot run the CLI.\n\n## Install\n\n\`\`\`sh\nbun add ${manifest.name} @moltcms/client\n\`\`\`\n\n## CLI\n\n\`\`\`sh\nbunx moltcms-static build --site main\n\`\`\`\n\nThis package is part of [moltcms-static](https://github.com/smartcrabai/moltcms-static). See the repository README for adapters, configuration, and examples.\n\nLicensed under Apache-2.0.\n`
			: manifest.name === "create-moltcms-static"
				? `# create-moltcms-static\n\n${manifest.description ?? "Create a MoltCMS static site."}\n\n## Usage\n\n\`\`\`sh\nbun create moltcms-static my-site\n\`\`\`\n\nThis package is part of [moltcms-static](https://github.com/smartcrabai/moltcms-static). See the repository README for setup details.\n\nLicensed under Apache-2.0.\n`
				: `# ${manifest.name}\n\n${manifest.description ?? "moltcms static-site package."}\n\n## Install\n\n\`\`\`sh\nnpm install ${manifest.name}\n\`\`\`\n\nThis package is part of [moltcms-static](https://github.com/smartcrabai/moltcms-static). See the repository README for setup, adapters, and examples.\n\nLicensed under Apache-2.0.\n`;
	await writeFile(new URL("README.md", directory), readme);
	await cp(license, new URL("LICENSE", directory));
}
