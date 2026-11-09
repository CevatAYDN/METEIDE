import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engineHarness, reply } from "./engine.js";

/** A strict run through the real engine with only scripted boundary adapters. */
export const verificationHarness = async (
	gates: string,
	options: Omit<Parameters<typeof engineHarness>[0], "templates"> = {
		scripts: [reply("report")],
	},
	configure?: (h: ReturnType<typeof engineHarness>) => void,
	rewrite: (source: string) => string = (source) => source,
) => {
	const root = await mkdtemp(join(tmpdir(), "mete-verification-"));
	const builtIn = join(root, "templates");
	await mkdir(builtIn);
	await writeFile(
		join(builtIn, "verify.yaml"),
		rewrite(`apiVersion: mete/v2
kind: TeamTemplate
metadata: { id: verify, name: Verify, version: 1.0.0 }
pattern: single
roles:
  - { id: dev, name: Dev, goal: Build, tier: coder, capabilities: [] }
tasks:
  - { id: build, role: dev, title: Build, verify: ${gates} }
`),
	);
	const h = engineHarness({
		...options,
		templates: { builtIn, workspace: root },
	});
	configure?.(h);
	const started = await h.engine.start({
		goal: "verify",
		templateId: "verify",
	});
	if (!started.ok) throw new Error(started.error.message);
	const runId = started.value.runId;
	return {
		...h,
		runId,
		root,
		builtIn,
		read: () => h.verification.read({ runId }),
		close: async () => {
			await h.stop();
			h.db.close();
			await rm(root, { recursive: true, force: true });
		},
	};
};
