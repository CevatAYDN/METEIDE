import "reflect-metadata";
import { ok } from "@mete/contracts";
import URI from "@theia/core/lib/common/uri";
import type { FileService } from "@theia/filesystem/lib/browser/file-service";
import { type ComponentProps, isValidElement } from "react";
import { expect, it, vi } from "vitest";
import type { WelcomeView } from "../src/application/welcome-view.js";
import { SettingsForms } from "../src/infrastructure/settings-forms.js";
import { MeteWelcomeWidget } from "../src/infrastructure/welcome-widget.js";
import { required } from "./required-fixture.js";

// Shell/command ports only: refresh, form loading, retargeting and saving remain real.
vi.mock("../src/infrastructure/panel-widget.js", () => ({
	MetePanelWidget: class {
		update() {}
		close() {}
	},
}));
vi.mock("@theia/core", () => ({ CommandService: class {} }));
vi.mock("@theia/core/lib/browser/theming", () => ({ ThemeService: class {} }));
vi.mock("@theia/core/lib/browser/window/window-service", () => ({
	WindowService: class {},
}));
vi.mock("@theia/core/lib/browser/widgets/widget", () => ({
	codicon: (name: string) => name,
}));
vi.mock("@theia/filesystem/lib/browser/file-service", () => ({
	FileService: class {},
}));
vi.mock("@theia/workspace/lib/browser/workspace-service", () => ({
	WorkspaceService: class {},
}));
vi.mock("../src/infrastructure/board-contribution.js", () => ({
	START_RUN_COMMAND: { id: "mete.run.start" },
}));
vi.mock("../src/infrastructure/settings-contribution.js", () => ({
	SHOW_SETTINGS_COMMAND: { id: "mete.settings.open" },
}));

class Welcome extends MeteWelcomeWidget {
	constructor(deps: object) {
		super();
		Object.assign(this, deps);
	}
	view() {
		const child = this.render().props.children;
		if (!isValidElement<ComponentProps<typeof WelcomeView>>(child))
			throw new Error("Missing Welcome");
		return child.props;
	}
}

const setup = (stage: "settings" | "file" | "quota" | "replacement") => {
	const a = URI.fromFilePath("/review-a");
	const b = URI.fromFilePath("/review-b");
	let root = a;
	const held = stage === "replacement" ? b : a;
	const gate = Promise.withResolvers<void>();
	const entered = Promise.withResolvers<void>();
	const wait = async () => {
		entered.resolve();
		await gate.promise;
	};
	const writes = vi.fn(async (_file: URI, _text: string) => {});
	const files = {
		exists: async (file: URI) => {
			if (
				stage === "file" &&
				file.toString() === a.resolve(".mete/privacy.yaml").toString()
			)
				await wait();
			return false;
		},
		write: writes,
	} as unknown as FileService;
	const widget = new Welcome({
		files,
		forms: new SettingsForms(files, () => {}),
		keys: { stateOf: () => ({ key: "", busy: false }) },
		themes: { getCurrentTheme: () => ({ type: "light" }) },
		workspace: {
			get roots() {
				return Promise.resolve([{ resource: root }]);
			},
			tryGetRoots: () => [{ resource: root }],
		},
		daemon: {
			keys: async () => ok([]),
			status: async () => ok([]),
			settings: async (dir: string) => {
				if (
					(stage === "settings" || stage === "replacement") &&
					dir === held.path.fsPath()
				)
					await wait();
				return ok({ globalFile: "/review-global/settings.yaml" });
			},
			quota: async (dir: string) => {
				if (stage === "quota" && dir === a.path.fsPath()) await wait();
				return ok({ providers: [{ id: dir, state: "ready" }], units: [] });
			},
		},
	});
	const privacy = () => {
		const form = widget.view().privacy;
		if (form?.kind !== "form") throw new Error("Missing privacy form");
		return form;
	};
	return {
		widget,
		privacy,
		b,
		writes,
		entered: entered.promise,
		release: gate.resolve,
		switchRoot: () => {
			root = b;
		},
	};
};

it.each(["settings", "file", "quota"] as const)(
	"ignores late A %s results and saves only the current B privacy form",
	async (stage) => {
		const t = setup(stage);
		const old = t.widget.refresh();
		await t.entered;
		t.switchRoot();
		await t.widget.refresh();
		t.release();
		await old;
		expect(t.privacy().state.target).toBe("global");
		t.privacy().actions.onTarget("workspace");
		await vi.waitFor(() => expect(t.privacy().state.target).toBe("workspace"));
		t.privacy().actions.onField("allowTraining", true);
		t.privacy().actions.onSave();
		await vi.waitFor(() => expect(t.writes).toHaveBeenCalledOnce());
		expect(required(t.writes.mock.calls[0])[0].toString()).toBe(
			t.b.resolve(".mete/privacy.yaml").toString(),
		);
		expect(required(t.writes.mock.calls[0])[1]).toBe("allowTraining: true\n");
		expect(t.widget.view().states).toEqual([
			{ id: t.b.path.fsPath(), state: "ready" },
		]);
	},
);

it("removes old privacy controls and rejects retained actions during and after replacement", async () => {
	const t = setup("replacement");
	await t.widget.refresh();
	const old = t.privacy().actions;
	t.switchRoot();
	const pending = t.widget.refresh();
	await t.entered;
	expect(t.widget.view().privacy).toBeUndefined();
	for (const act of [
		() => old.onTarget("workspace"),
		() => old.onField("allowTraining", true),
		old.onSave,
		old.onClear,
	])
		act();
	t.release();
	await pending;
	old.onSave();
	await new Promise<void>((resolve) => setImmediate(resolve));
	expect(t.writes).not.toHaveBeenCalled();
	expect(t.privacy().state.dirty).toBe(false);
});
