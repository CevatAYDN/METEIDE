import type { Policy } from "@mete/contracts";
import { Children, isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
	editDenyDraft,
	PolicyDenyField,
	publishDenyDraft,
	stageDenyDraft,
} from "../src/application/policy-deny-field.js";

type Props = Parameters<typeof PolicyDenyField>[0];
type Control = {
	children?: ReactNode;
	value?: string;
	disabled?: boolean;
	"aria-label"?: string;
	onChange?: (event: { target: { value: string } }) => void;
};
const controls = (node: ReactNode): readonly Control[] =>
	Children.toArray(node).flatMap((child): Control[] =>
		isValidElement<Control>(child)
			? [child.props, ...controls(child.props.children)]
			: [],
	);
const source = (props: Props) => {
	const found = controls(PolicyDenyField(props)).find(
		(control) => control["aria-label"] === "Deny rule source",
	);
	if (!found) throw new Error("Missing deny source selector");
	return found;
};
const pathRule = { action: "fs.write", path: "private/**" } as const;
const commandRule = {
	action: "shell.exec",
	command: "*Stop-Process*",
} as const;
const inherited: Policy["never_allow"] = [pathRule, commandRule];
const setup = (value: Props["value"] = inherited, disabled = false): Props => ({
	value,
	inherited,
	disabled,
	onChange: vi.fn(),
});

describe("deny rule field drafts (ADR-192)", () => {
	it("distinguishes inheritance from an explicitly empty deny list", () => {
		const props = { ...setup(), value: undefined };
		expect(source(props).value).toBe("inherited");
		expect(source(setup([])).value).toBe("custom");
		const shown = controls(PolicyDenyField(props));
		expect(shown.filter((c) => c.value === "private/**")).toHaveLength(1);
		expect(shown.filter((c) => c.onChange)).toHaveLength(1);
		expect(props.onChange).not.toHaveBeenCalled();
	});

	it("customizes by cloning every inherited rule and restores inheritance", () => {
		const props = { ...setup(), value: undefined };
		source(props).onChange?.({ target: { value: "custom" } });
		expect(props.onChange).toHaveBeenCalledWith(inherited);
		const call = vi.mocked(props.onChange).mock.calls[0]?.[0];
		expect(call).not.toBe(inherited);
		expect(call?.[0]).not.toBe(inherited[0]);
		expect(call?.[1]).not.toBe(inherited[1]);
		const custom = setup([]);
		source(custom).onChange?.({ target: { value: "inherited" } });
		expect(custom.onChange).toHaveBeenCalledWith(undefined);
		source(custom).onChange?.({ target: { value: "unknown" } });
		expect(custom.onChange).toHaveBeenCalledTimes(1);
	});

	it("edits and removes by position, retaining order, patterns and duplicates", () => {
		const rules: Policy["never_allow"] = [pathRule, commandRule, pathRule];
		const edited = editDenyDraft(rules, {
			type: "pattern",
			index: 2,
			pattern: "  secrets/**  ",
		});
		expect(edited).toEqual([
			rules[0],
			rules[1],
			{ action: "fs.write", path: "  secrets/**  " },
		]);
		expect(editDenyDraft(rules, { type: "remove", index: 2 })).toEqual(
			rules.slice(0, 2),
		);
		expect(rules[0]).toEqual({ action: "fs.write", path: "private/**" });
		const command = editDenyDraft(rules, {
			type: "action",
			index: 0,
			action: "shell.exec",
		});
		expect(command[0]).toEqual({ action: "shell.exec", command: "private/**" });
		expect(
			editDenyDraft(command, {
				type: "action",
				index: 0,
				action: "fs.delete",
			})[0],
		).toEqual({ action: "fs.delete", path: "private/**" });
	});

	it.each(["fs.write", "fs.delete", "fs.write.outside", "shell.exec"] as const)(
		"adds only the supported %s variant and publishes after its pattern is complete",
		(action) => {
			const props = setup([]);
			const pending = editDenyDraft([], { type: "add", action });
			expect(pending).toEqual([
				action === "shell.exec"
					? { action, command: "" }
					: { action, path: "" },
			]);
			expect(publishDenyDraft(props, pending)).toBe(false);
			expect(props.onChange).not.toHaveBeenCalled();
			const complete = editDenyDraft(pending, {
				type: "pattern",
				index: 0,
				pattern: "**",
			});
			expect(publishDenyDraft(props, complete)).toBe(true);
			expect(props.onChange).toHaveBeenCalledWith(complete);
		},
	);

	it("retains half-typed local drafts without publishing or dropping other rows", () => {
		const props = setup();
		const pending = editDenyDraft(inherited, {
			type: "pattern",
			index: 0,
			pattern: "",
		});
		expect(pending[0]).toEqual({ action: "fs.write", path: "" });
		expect(pending[1]).toBe(inherited[1]);
		expect(publishDenyDraft(props, pending)).toBe(false);
		const repaired = editDenyDraft(pending, {
			type: "pattern",
			index: 0,
			pattern: "p/**",
		});
		expect(publishDenyDraft(props, repaired)).toBe(true);
		const removed = editDenyDraft(pending, { type: "remove", index: 0 });
		expect(removed).toEqual([inherited[1]]);
		expect(publishDenyDraft(props, removed)).toBe(true);
	});

	it("forwards incomplete editor rows for retention without publishing or losing other rows", () => {
		const props = { ...setup(), onDraft: vi.fn() };
		const erased = editDenyDraft(inherited, {
			type: "pattern",
			index: 0,
			pattern: "",
		});
		stageDenyDraft(props, erased);
		expect(props.onDraft).toHaveBeenLastCalledWith(erased);
		expect(erased[1]).toBe(inherited[1]);
		const added = editDenyDraft(inherited, {
			type: "add",
			action: "shell.exec",
		});
		stageDenyDraft(props, added);
		expect(props.onDraft).toHaveBeenLastCalledWith(added);
		expect(added.slice(0, 2)).toEqual(inherited);
		expect(props.onChange).not.toHaveBeenCalled();
		stageDenyDraft({ ...props, disabled: true }, erased);
		stageDenyDraft({ ...props, value: undefined }, erased);
		expect(props.onDraft).toHaveBeenCalledTimes(2);
		const repaired = editDenyDraft(erased, {
			type: "pattern",
			index: 0,
			pattern: "p/**",
		});
		stageDenyDraft(props, repaired);
		expect(props.onChange).toHaveBeenCalledWith(repaired);
		expect(props.onDraft).toHaveBeenCalledTimes(2);
	});

	it("rejects malformed shapes and preserves explicit empty and arbitrary nonempty patterns", () => {
		const props = setup();
		for (const candidate of [
			[{ action: "git.push", path: "**" }],
			[{ action: "shell.exec", path: "**" }],
			[{ action: "fs.write", path: "**", extra: true }],
			[{ action: "fs.write", path: 1 }],
			null,
		])
			expect(publishDenyDraft(props, candidate)).toBe(false);
		expect(props.onChange).not.toHaveBeenCalled();
		expect(
			publishDenyDraft(props, [
				{ action: "shell.exec", command: "echo x && echo y" },
			]),
		).toBe(true);
		expect(publishDenyDraft(props, [])).toBe(true);
		expect(props.onChange).toHaveBeenLastCalledWith([]);
	});

	it("locks busy controls and refuses direct publishing and source handlers", () => {
		const props = setup(inherited, true);
		expect(PolicyDenyField(props).props.disabled).toBe(true);
		source(props).onChange?.({ target: { value: "inherited" } });
		expect(publishDenyDraft(props, [])).toBe(false);
		const inheritedProps = { ...props, value: undefined };
		source(inheritedProps).onChange?.({ target: { value: "custom" } });
		expect(props.onChange).not.toHaveBeenCalled();
	});
});
