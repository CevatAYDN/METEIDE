import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { TeamWorkspaceActions } from "../src/application/team-workspace-actions.js";

type Button = { children: ReactNode; disabled: boolean; onClick: () => void };

it("routes explicit actions without saving a team, scanning skills or changing policy", () => {
	const onCommand = vi.fn();
	const view = TeamWorkspaceActions({ busy: false, onCommand });
	const controls = Children.toArray(view.props.children);
	for (const control of controls) {
		if (!isValidElement<Button>(control)) throw new Error("Missing action");
		expect(control.props.disabled).toBe(false);
		control.props.onClick();
	}
	expect(onCommand.mock.calls).toEqual([
		["mete.settings.skills"],
		["mete.settings.permissions"],
		["mete.memory.open"],
	]);
});

it("locks actions while the team is saving and exposes ordinary labeled buttons", () => {
	const onCommand = vi.fn();
	const view = TeamWorkspaceActions({ busy: true, onCommand });
	const out = renderToStaticMarkup(view);
	expect(out).toContain('aria-label="Team workspace"');
	for (const control of Children.toArray(view.props.children)) {
		if (!isValidElement<Button>(control)) throw new Error("Missing action");
		expect(control.props.disabled).toBe(true);
		control.props.onClick();
	}
	expect(onCommand).not.toHaveBeenCalled();
});
