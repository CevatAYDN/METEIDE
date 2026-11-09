import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";

const root = resolve(process.cwd(), "..", "..");
const fromRoot = createRequire(join(root, "package.json"));
const turbo = join(
	dirname(fromRoot.resolve("turbo/package.json")),
	"bin",
	"turbo",
);
const reportSchema = z.object({
	tasks: z.array(
		z.object({
			taskId: z.string(),
			outputs: z.array(z.string()).nullable(),
			excludedOutputs: z.array(z.string()).nullable(),
			resolvedTaskDefinition: z.object({ dependsOn: z.array(z.string()) }),
		}),
	),
});

it("caches compiler output without capturing installers or preserved update baselines", () => {
	const stdout = execFileSync(
		process.execPath,
		[turbo, "run", "build", "--filter=@mete/desktop", "--dry=json"],
		{ cwd: root, encoding: "utf8", timeout: 30_000 },
	);
	const report = reportSchema.parse(JSON.parse(stdout));
	const task = report.tasks.find(
		(entry) => entry.taskId === "@mete/desktop#build",
	);
	expect(task).toBeDefined();
	expect(task?.outputs).toEqual(["dist/**"]);
	expect(task?.excludedOutputs).toEqual([
		"dist/installer/**",
		"dist/update-baseline-*/**",
	]);
	expect(task?.resolvedTaskDefinition.dependsOn).toEqual(["^build"]);
});
