// Bootstrap stub: `moltcms-static codegen` overwrites this file with the
// schema types and fingerprint of the live projection during the E2E run.
import type { SchemaVersionIndex } from "@moltcms/client";

export interface MoltcmsSchemas {
	post: {
		1: {
			title: string;
			slug: string;
			body?: string | null;
		};
	};
}

export const schemaVersions = {
	post: [1],
} as const satisfies SchemaVersionIndex<MoltcmsSchemas>;

export const schemaFingerprint = "e2e-bootstrap";
