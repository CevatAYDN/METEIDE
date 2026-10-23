import { EMPTY_TEAM_VIEW, type TaskCard, type TeamView } from "@mete/ui-studio";
import { describe, expect, it } from "vitest";
import { artifactToOpen } from "../src/application/artifact.js";

// The report the approvals inbox opens: the waiting task's first, else the latest written.

const task = (
	id: string,
	status: TaskCard["status"],
	artifactPath?: string,
): TaskCard => ({
	id,
	title: id,
	roleId: "dev",
	dependsOn: [],
	status,
	...(artifactPath ? { artifactPath } : {}),
});
const view = (tasks: TaskCard[]): TeamView => ({ ...EMPTY_TEAM_VIEW, tasks });

describe("the artifact the inbox opens", () => {
	it("opens the report of the task that waits for review", () => {
		expect(
			artifactToOpen(
				view([
					task("a", "approved", "a.md"),
					task("b", "submitted", "b.md"),
					task("c", "approved", "c.md"),
				]),
			),
		).toBe("b.md");
	});

	it("falls back to the latest report, with forward slashes, and to none", () => {
		expect(
			artifactToOpen(
				view([task("a", "approved", String.raw`x\a.md`), task("b", "todo")]),
			),
		).toBe("x/a.md");
		expect(artifactToOpen(view([task("b", "todo")]))).toBeUndefined();
	});
});
