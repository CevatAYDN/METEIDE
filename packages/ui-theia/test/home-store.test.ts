import "reflect-metadata";
import { ok } from "@mete/contracts";
import { Emitter } from "@theia/core/lib/common/event";
import URI from "@theia/core/lib/common/uri";
import type { WorkspaceService } from "@theia/workspace/lib/browser/workspace-service";
import { describe, expect, it, vi } from "vitest";
import { MeteDaemonEvents } from "../src/application/daemon-events.js";
import { runsHere } from "../src/domain/home-model.js";
import type {
	MeteDaemonService,
	StatusRuns,
} from "../src/domain/status-service.js";
import { MeteHomeStore } from "../src/infrastructure/home-store.js";

vi.mock("@theia/workspace/lib/browser/workspace-service", () => ({
	WorkspaceService: class {},
}));
vi.mock(
	"@theia/filesystem/lib/browser/file-dialog/file-dialog-service",
	() => ({
		FileDialogService: class {},
	}),
);
vi.mock("@theia/core/lib/browser/dialogs", () => ({ ConfirmDialog: class {} }));
vi.mock("../src/infrastructure/board-contribution.js", () => ({
	OPEN_BOARD_COMMAND: { id: "mete.board.open" },
}));
vi.mock("../src/infrastructure/artifact-command.js", () => ({
	OPEN_ARTIFACT_COMMAND: { id: "mete.artifact.open" },
}));

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
};
type StatusReply = Awaited<ReturnType<MeteDaemonService["status"]>>;
type QuotaReply = Awaited<ReturnType<MeteDaemonService["quota"]>>;
const quota = ok({ providers: [], units: [] });
const run = (status: "running" | "paused"): StatusRuns[number] => ({
	id: "run",
	workspaceId: "workspace",
	templateId: null,
	goal: "Work",
	status,
	...(status === "paused" ? { pauseReason: "approval" as const } : {}),
	autonomyLevel: 2,
	budget: { cloudRequests: 10, maxHours: 1 },
	createdAt: "2026-11-07T10:00:00.000Z",
});

class HomeStore extends MeteHomeStore {
	constructor(deps: object) {
		super();
		Object.assign(this, deps);
	}
	listen() {
		this.init();
	}
}

const setup = () => {
	let roots = [{ resource: URI.fromFilePath("/first") }];
	const changed = new Emitter<typeof roots>();
	const status = vi.fn<MeteDaemonService["status"]>(async () => ok([]));
	const askQuota = vi.fn<MeteDaemonService["quota"]>(async () => quota);
	const recent = vi.fn(async (): Promise<string[]> => []);
	const open = vi.fn();
	const logger = { warn: vi.fn(async () => {}) };
	const badge = { set: vi.fn() };
	const store = new HomeStore({
		daemon: {
			status,
			quota: askQuota,
			threadList: async () => ok({ conversations: [] }),
		},
		workspace: {
			get roots() {
				return Promise.resolve(roots);
			},
			tryGetRoots: () => roots,
			recentWorkspaces: recent,
			onWorkspaceChanged: changed.event,
			open,
		} as unknown as WorkspaceService,
		logger,
		badge,
		events: new MeteDaemonEvents(),
		commands: { onDidExecuteCommand: new Emitter().event },
	});
	const switchTo = (dir?: string) => {
		roots = dir ? [{ resource: URI.fromFilePath(dir) }] : [];
		changed.fire(roots);
	};
	return { store, status, askQuota, recent, open, logger, badge, switchTo };
};

describe("Home refresh identity", () => {
	it("keeps successful rows, the badge and window safety when current quota rejects", async () => {
		const t = setup();
		const pending = deferred<QuotaReply>();
		const asked = deferred<void>();
		t.status.mockResolvedValue(
			ok([
				{ ...run("running"), id: "active" },
				{ ...run("paused"), id: "waiting" },
			]),
		);
		t.askQuota.mockImplementationOnce(() => {
			asked.resolve();
			return pending.promise;
		});
		const refresh = t.store.refresh();
		await asked.promise;
		const successful = t.store.model;
		pending.reject(new Error("quota transport closed"));
		await refresh;
		expect(t.store.model).toEqual(successful);
		expect(t.store.model).toMatchObject({
			kind: "runs",
			rows: [
				{ id: "active", status: "running" },
				{ id: "waiting", status: "paused", waiting: true },
			],
			providers: [],
		});
		expect(t.badge.set).toHaveBeenLastCalledWith(1);
		expect(runsHere(t.store.model)).toBe(true);
		const other = URI.fromFilePath("/other");
		t.store.openWorkspace(other.toString());
		expect(t.open).toHaveBeenCalledOnce();
		const [opened, options] = t.open.mock.calls[0] ?? [];
		expect(opened?.toString()).toBe(other.toString());
		expect(options).toEqual({ preserveWindow: false });
	});

	it("handles a recent-workspace rejection without discarding runs or the last list", async () => {
		const t = setup();
		t.recent.mockResolvedValueOnce([URI.fromFilePath("/first").toString()]);
		t.status.mockResolvedValue(ok([run("running")]));
		await t.store.refresh();
		const folders = t.store.workspaces;
		expect(folders).toHaveLength(1);
		const pending = deferred<string[]>();
		t.recent.mockReturnValueOnce(pending.promise);
		await t.store.refresh();
		const successful = t.store.model;
		const reported = deferred<void>();
		t.logger.warn.mockImplementationOnce(async () => reported.resolve());
		pending.reject(new Error("recent workspaces unavailable"));
		await reported.promise;
		expect(t.logger.warn).toHaveBeenCalled();
		expect(t.store.workspaces).toBe(folders);
		expect(t.store.model).toBe(successful);
		expect(runsHere(t.store.model)).toBe(true);
	});

	it("keeps a newer approval and badge when an older quota finishes last", async () => {
		const t = setup();
		const oldQuota = deferred<QuotaReply>();
		const quotaAsked = deferred<void>();
		t.status.mockResolvedValueOnce(ok([run("running")]));
		t.askQuota.mockImplementationOnce(() => {
			quotaAsked.resolve();
			return oldQuota.promise;
		});
		const first = t.store.refresh();
		await quotaAsked.promise;
		t.status.mockResolvedValueOnce(ok([run("paused")]));
		await t.store.refresh();
		const latest = t.store.model;
		oldQuota.resolve(quota);
		await first;
		expect(t.store.model).toBe(latest);
		expect(t.store.model).toMatchObject({
			kind: "runs",
			rows: [{ status: "paused", waiting: true }],
		});
		expect(t.badge.set).toHaveBeenLastCalledWith(1);
	});

	it("ignores an older status that finishes after the newer refresh", async () => {
		const t = setup();
		const oldStatus = deferred<StatusReply>();
		const statusAsked = deferred<void>();
		t.status.mockImplementationOnce(() => {
			statusAsked.resolve();
			return oldStatus.promise;
		});
		const first = t.store.refresh();
		await statusAsked.promise;
		t.status.mockResolvedValueOnce(ok([run("paused")]));
		await t.store.refresh();
		const latest = t.store.model;
		oldStatus.resolve(ok([run("running")]));
		await first;
		expect(t.store.model).toBe(latest);
		expect(t.badge.set).toHaveBeenLastCalledWith(1);
		expect(t.askQuota).toHaveBeenCalledTimes(1);
	});

	it.each(["status", "quota"] as const)(
		"ignores a stale rejected %s request",
		async (request) => {
			const t = setup();
			const pending = deferred<never>();
			const asked = deferred<void>();
			t.status.mockResolvedValue(ok([run("paused")]));
			const ask = request === "status" ? t.status : t.askQuota;
			ask.mockImplementationOnce(() => {
				asked.resolve();
				return pending.promise;
			});
			const first = t.store.refresh();
			await asked.promise;
			await t.store.refresh();
			const latest = t.store.model;
			pending.reject(new Error("old transport failure"));
			await first;
			expect(t.store.model).toBe(latest);
			expect(t.badge.set).toHaveBeenLastCalledWith(1);
		},
	);

	it.each(["switch", "close", "dispose"] as const)(
		"ignores quota invalidated by %s",
		async (action) => {
			const t = setup();
			const pending = deferred<QuotaReply>();
			const asked = deferred<void>();
			t.askQuota.mockImplementationOnce(() => {
				asked.resolve();
				return pending.promise;
			});
			const first = t.store.refresh();
			await asked.promise;
			if (action === "dispose") t.store.dispose();
			else {
				t.switchTo(action === "switch" ? "/second" : undefined);
				await t.store.refresh();
			}
			const latest = t.store.model;
			t.badge.set.mockClear();
			pending.resolve(quota);
			await first;
			expect(t.store.model).toBe(latest);
			expect(t.badge.set).not.toHaveBeenCalled();
		},
	);

	it("refreshes on a workspace change and stops listening after disposal", async () => {
		const t = setup();
		t.store.listen();
		await t.store.refresh();
		const asked = deferred<void>();
		t.status.mockImplementationOnce(async () => {
			asked.resolve();
			return ok([]);
		});
		t.switchTo("/second");
		await asked.promise;
		expect(t.status).toHaveBeenLastCalledWith(
			URI.fromFilePath("/second").path.fsPath(),
		);
		t.store.dispose();
		t.status.mockClear();
		t.switchTo("/third");
		await t.store.refresh();
		expect(t.status).not.toHaveBeenCalled();
	});

	it("does not restore stale recent folders after a newer refresh or disposal", async () => {
		const t = setup();
		const oldRecent = deferred<string[]>();
		t.recent.mockReturnValueOnce(oldRecent.promise);
		await t.store.refresh();
		t.switchTo("/second");
		await t.store.refresh();
		t.store.dispose();
		oldRecent.resolve([URI.fromFilePath("/first").toString()]);
		await oldRecent.promise;
		expect(t.store.workspaces).toEqual([]);
	});
});
