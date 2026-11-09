import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Execute real maintenance entrypoints with only filesystem/process effects replaced. */
export const script = async (path, overrides, processState, messages = []) => {
	const context = createContext({
		process: processState,
		console: { log: (message) => messages.push(message), error() {} },
	});
	const module = new SourceTextModule(readFileSync(path, "utf8"), {
		context,
		initializeImportMeta: (meta) => {
			meta.url = pathToFileURL(path).href;
		},
	});
	await module.link(async (name) => {
		const specifier = name.startsWith(".")
			? new URL(name, pathToFileURL(path)).href
			: name;
		const exports = { ...(await import(specifier)), ...overrides[name] };
		return new SyntheticModule(
			Object.keys(exports),
			function () {
				for (const [key, value] of Object.entries(exports))
					this.setExport(key, value);
			},
			{ context },
		);
	});
	return module.evaluate();
};

/** Keep each entrypoint's exit status and environment isolated. */
export const processState = () => ({
	execPath: process.execPath,
	platform: process.platform,
	env: { npm_execpath: "pnpm.cjs" },
	exitCode: undefined,
	exit: (code) => {
		throw new Error(`process.exit(${code})`);
	},
});

/** Run the production release entrypoint with deterministic command results. */
export const releaseScript = async ({
	failedGate,
	root = ROOT,
	licenseGroups = {
		MIT: [
			{
				name: "fixture",
				versions: ["1.0.0"],
				paths: [join(ROOT, "node_modules", "fixture")],
				license: "MIT",
			},
		],
	},
	licenseOutput = JSON.stringify(licenseGroups),
} = {}) => {
	const calls = [];
	const messages = [];
	const state = processState();
	await script(
		join(ROOT, "scripts", "release-check.mjs"),
		{
			"node:url": {
				fileURLToPath: () => join(root, "scripts", "release-check.mjs"),
			},
			"node:child_process": {
				spawnSync: (_command, args) => {
					calls.push(Array.from(args));
					return {
						status: failedGate && messages.at(-1).endsWith(failedGate) ? 1 : 0,
						stdout: args.includes("licenses") ? licenseOutput : "",
						stderr: "",
					};
				},
			},
			"node:fs": {
				readFileSync: (path) =>
					String(path).endsWith("package.json")
						? '{"devDependencies":{"electron":"42.11.14"}}'
						: "id,severity\n",
				mkdtempSync: () => join(tmpdir(), "fake-electronegativity"),
				rmSync() {},
				readdirSync: () => ["installer.exe"],
			},
		},
		state,
		messages,
	);
	return { calls, messages, state };
};
