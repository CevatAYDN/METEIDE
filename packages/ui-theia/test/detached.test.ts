import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DAEMON_DETACHED, runScript } from "../src/infrastructure/spawn-cli.js";

// What happens to the daemon when the desktop ends: a parent spawns a child the way the backend
// spawns the daemon (pipes, windowsHide, the detached setting under test) and then exits. The child
// stands in for the daemon: on the end of its input it takes half a second to stop, as the daemon
// closes its database and frees the run lock, then writes a marker and exits 0. Without that time a
// child that is not detached could, under load, write the marker in the instant between its input
// closing and its job object killing it.

const CHILD = `
process.stdin.on("data", () => {});
process.stdin.on("end", () => {
	setTimeout(() => {
		require("node:fs").writeFileSync(process.argv[2], "stopped");
		process.exit(0);
	}, 500);
});
`;

const PARENT = `
const { spawn } = require("node:child_process");
const [, , child, marker, detached] = process.argv;
const c = spawn(process.execPath, [child, marker], {
	stdio: ["pipe", "pipe", "pipe"],
	windowsHide: true,
	detached: detached === "true",
});
process.stdout.write(String(c.pid));
setTimeout(() => process.exit(0), 300);
`;

let root: string | undefined;
afterEach(async () => {
	if (root) await rm(root, { recursive: true, force: true });
	root = undefined;
});

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

// Waits up to 3 s for the child to have stopped by itself.
const settle = async (pid: number, marker: string) => {
	for (let i = 0; i < 30 && (alive(pid) || !existsSync(marker)); i++)
		await new Promise((r) => setTimeout(r, 100));
};

const endParent = async (detached: boolean) => {
	root = await mkdtemp(join(tmpdir(), "mete-detached-"));
	const child = join(root, "child.cjs");
	const parent = join(root, "parent.cjs");
	const marker = join(root, "stopped");
	await writeFile(child, CHILD);
	await writeFile(parent, PARENT);
	const r = await runScript(parent, [child, marker, String(detached)]);
	const pid = Number(r.stdout);
	await settle(pid, marker);
	return { pid, marker };
};

describe("the daemon when the desktop ends", () => {
	it("stops by itself on its closed input, so it frees the run lock", async () => {
		const { pid, marker } = await endParent(DAEMON_DETACHED);
		expect(existsSync(marker)).toBe(true);
		expect(alive(pid)).toBe(false);
	});

	it.runIf(process.platform === "win32")(
		"would die with its parent on Windows if it were not detached",
		async () => {
			const { marker } = await endParent(false);
			expect(existsSync(marker)).toBe(false);
		},
	);
});
