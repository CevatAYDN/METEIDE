import "reflect-metadata";
import type { CommandRegistry } from "@theia/core";
import URI from "@theia/core/lib/common/uri";
import type { FileService } from "@theia/filesystem/lib/browser/file-service";
import { describe, expect, it, vi } from "vitest";
import {
	SHOW_PERMISSIONS_COMMAND,
	SHOW_SETTINGS_COMMAND,
	SHOW_SKILLS_COMMAND,
	SHOW_TEAMS_COMMAND,
} from "../src/application/settings-commands.js";
import { MeteSettingsContribution } from "../src/infrastructure/settings-contribution.js";
import { SettingsForms } from "../src/infrastructure/settings-forms.js";
import { MeteSettingsWidget } from "../src/infrastructure/settings-widget.js";
import { required } from "./required-fixture.js";

vi.mock("@theia/core/lib/browser", () => ({
	AbstractViewContribution: class {},
	bindViewContribution: vi.fn(),
	WidgetFactory: Symbol("WidgetFactory"),
}));
vi.mock("../src/infrastructure/panel-widget.js", () => ({
	MetePanelWidget: class {
		update() {}
	},
}));
vi.mock("@theia/core/lib/browser/opener-service", () => ({
	OpenerService: Symbol("OpenerService"),
	open: vi.fn(),
}));
vi.mock("@theia/core/lib/browser/theming", () => ({ ThemeService: class {} }));
vi.mock("@theia/core/lib/browser/widgets/widget", () => ({
	codicon: (name: string) => name,
}));
vi.mock("@theia/core/lib/browser/window/window-service", () => ({
	WindowService: class {},
}));
vi.mock("@theia/filesystem/lib/browser/file-service", () => ({
	FileService: class {},
}));
vi.mock("@theia/workspace/lib/browser/workspace-service", () => ({
	WorkspaceService: class {},
}));

class SettingsWidget extends MeteSettingsWidget {
	async seed() {
		this.forms = new SettingsForms(
			{ exists: async () => false } as Pick<
				FileService,
				"exists"
			> as FileService,
			() => {},
		);
		await this.forms.load(new URI("file:///workspace"), undefined);
		this.forms.forms().gateway?.actions.onField("models", "paid");
		this.navigation.choice().search?.onChange("unrelated search");
	}
	snapshot() {
		return {
			group: this.navigation.choice().group,
			query: this.navigation.choice().search?.value,
			form: this.forms?.forms().gateway,
		};
	}
}

class Contribution extends MeteSettingsContribution {
	constructor(readonly target: SettingsWidget) {
		super();
	}
	override openView = vi.fn(async () => this.target);
}

describe("direct Settings navigation", () => {
	it("opens the requested group without refreshing or discarding a dirty form", async () => {
		const widget = new SettingsWidget();
		await widget.seed();
		const before = widget.snapshot().form?.state;
		const refresh = vi.spyOn(widget, "refresh");
		widget.showGroup("skills");
		expect(widget.snapshot()).toMatchObject({ group: "skills", query: "" });
		expect(widget.snapshot().form?.state).toBe(before);
		widget.showGroup("limits");
		expect(widget.snapshot().form?.state.values.models).toBe("paid");
		expect(widget.snapshot().form?.state.dirty).toBe(true);
		widget.showGroup();
		expect(widget.snapshot().group).toBe("limits");
		expect(refresh).not.toHaveBeenCalled();
	});

	it("registers explicit routes to the existing widget without startup work", async () => {
		const widget = new SettingsWidget();
		const contribution = new Contribution(widget);
		const execute = new Map<string, () => unknown>();
		contribution.registerCommands({
			registerCommand: (command, handler) => {
				execute.set(command.id, () => required(handler?.execute)());
			},
		} as Pick<CommandRegistry, "registerCommand"> as CommandRegistry);
		expect(contribution.openView).not.toHaveBeenCalled();
		expect([...execute.keys()]).toEqual([
			SHOW_SETTINGS_COMMAND.id,
			SHOW_PERMISSIONS_COMMAND.id,
			SHOW_SKILLS_COMMAND.id,
			SHOW_TEAMS_COMMAND.id,
		]);
		for (const [command, group] of [
			[SHOW_PERMISSIONS_COMMAND, "limits"],
			[SHOW_SKILLS_COMMAND, "skills"],
			[SHOW_TEAMS_COMMAND, "teams"],
		] as const) {
			await required(execute.get(command.id))();
			expect(widget.snapshot().group).toBe(group);
		}
		await required(execute.get(SHOW_SETTINGS_COMMAND.id))();
		expect(widget.snapshot().group).toBe("teams");
		expect(contribution.openView).toHaveBeenLastCalledWith({
			activate: true,
			reveal: true,
		});
	});
});
