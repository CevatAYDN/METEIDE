import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result } from "@mete/contracts";
import { withLockRetry } from "@mete/kernel";

// Artifact files of team runs in .mete/artifacts/<run id>/ (ARCHITECTURE.md, workspace files);
// their metadata lives in the run snapshot (docs/07, Artifact).

/** Where a written artifact is, relative to the workspace root with forward slashes, and its hash. */
export type Written = { readonly path: string; readonly sha256: string };

/** Why an artifact could not be written. */
export type ArtifactError = { readonly code: "io"; readonly message: string };

/** Writes artifact files for core-engine. */
export type ArtifactStore = {
	write(file: {
		runId: string;
		name: string;
		content: string;
	}): Promise<Result<Written, ArtifactError>>;
};

/** An artifact store over the workspace at `workspaceDir`. */
export const createArtifactStore = (workspaceDir: string): ArtifactStore => ({
	async write({ runId, name, content }) {
		const dir = join(workspaceDir, ".mete", "artifacts", runId);
		try {
			await withLockRetry(() => mkdir(dir, { recursive: true }));
			await withLockRetry(() => writeFile(join(dir, name), content, "utf8"));
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			return err({ code: "io", message });
		}
		const sha256 = createHash("sha256").update(content).digest("hex");
		return ok({ path: `.mete/artifacts/${runId}/${name}`, sha256 });
	},
});
