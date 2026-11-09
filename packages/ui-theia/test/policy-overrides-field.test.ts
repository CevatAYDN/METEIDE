import { ok, PolicySchema } from "@mete/contracts";
import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import {
	changePolicyOverride,
	PolicyOverridesField,
	type PolicyOverridesProps,
} from "../src/application/policy-overrides-field.js";

const inherited = Object.freeze({
	"shell.exec@1": 1,
	"git.push@1": 0,
} as const);
const props = (
	value?: PolicyOverridesProps["value"],
): PolicyOverridesProps => ({
	value,
	inherited,
	autonomy: 2,
	onChange: vi.fn(),
});
type Control = {
	children?: ReactNode;
	"aria-label"?: string;
	disabled?: boolean;
	onChange?: (event: { target: { value: string } }) => void;
	onClick?: () => void;
};
const nodes = (tree: ReactNode): ReactNode[] =>
	Children.toArray(tree).flatMap((node): ReactNode[] =>
		isValidElement<Control>(node) ? [node, ...nodes(node.props.children)] : [],
	);
const control = (field: PolicyOverridesField, label: string) => {
	const node = nodes(field.render()).find(
		(item) =>
			isValidElement<Control>(item) && item.props["aria-label"] === label,
	);
	if (!isValidElement<Control>(node)) throw new Error(`Missing ${label}`);
	return node.props;
};
const html = (p: PolicyOverridesProps) =>
	renderToStaticMarkup(createElement(PolicyOverridesField, p));

it("distinguishes inheritance and explicit empty without erasing inherited keys", () => {
	expect(html(props())).toContain('value="inherited" selected=""');
	const empty = html(props({}));
	expect(empty).toContain('value="custom" selected=""');
	expect(empty).toContain("shell.exec@1");
	expect(empty).toContain("Inherited");
	expect(empty).not.toContain("Remove own override");
	expect(props({}).onChange).not.toHaveBeenCalled();
});

it("copies inheritance exactly when customizing and restores undefined", () => {
	const result = changePolicyOverride(props(), {
		kind: "source",
		mode: "custom",
	});
	expect(result).toEqual(ok(inherited));
	if (result.ok) expect(result.value).not.toBe(inherited);
	expect(
		changePolicyOverride(props({}), { kind: "source", mode: "inherited" }),
	).toEqual(ok(undefined));
	expect(
		changePolicyOverride(
			{ ...props(), autonomy: 0 },
			{ kind: "source", mode: "custom" },
		),
	).toEqual(ok(inherited));
});

it("updates one key, preserves other own/global keys, and reveals inheritance on removal", () => {
	const p = props({ "shell.exec@1": 2, "fs.write@1": 1 });
	expect(
		changePolicyOverride(p, { kind: "level", ref: "shell.exec@1", level: "0" }),
	).toEqual(ok({ "shell.exec@1": 0, "fs.write@1": 1 }));
	const removed = changePolicyOverride(p, {
		kind: "remove",
		ref: "shell.exec@1",
	});
	expect(removed).toEqual(ok({ "fs.write@1": 1 }));
	if (removed.ok) {
		const rendered = html(props(removed.value));
		expect(rendered).toContain("shell.exec@1");
		expect(rendered).not.toContain("Remove own override shell.exec@1");
	}
	expect(
		changePolicyOverride(props({ "fs.write@1": 1 }), {
			kind: "remove",
			ref: "fs.write@1",
		}),
	).toEqual(ok({}));
	expect(
		changePolicyOverride(p, { kind: "remove", ref: "git.push@1" }).ok,
	).toBe(false);
	expect(
		changePolicyOverride(props({}), {
			kind: "level",
			ref: "git.push@1",
			level: "1",
		}),
	).toEqual(ok({ "git.push@1": 1 }));
	expect(inherited).toEqual({ "shell.exec@1": 1, "git.push@1": 0 });
});

it("validates add references, duplicates and levels without malformed output", () => {
	for (const ref of ["bad", "shell.exec@0", "__proto__", "shell.exec@1"])
		expect(
			changePolicyOverride(props({}), { kind: "add", ref, level: "1" }).ok,
		).toBe(false);
	for (const level of ["", "-1", "4", "1.5", "NaN", "3"])
		expect(
			changePolicyOverride(props({}), { kind: "add", ref: "fs.write@1", level })
				.ok,
		).toBe(false);
	expect(
		changePolicyOverride(props({}), {
			kind: "add",
			ref: "fs.write@1",
			level: "2",
		}),
	).toEqual(ok({ "fs.write@1": 2 }));
	expect(
		changePolicyOverride(props({ "fs.write@1": 1 }), {
			kind: "add",
			ref: "fs.write@1",
			level: "2",
		}).ok,
	).toBe(false);
	expect(
		changePolicyOverride(props({}), {
			kind: "level",
			ref: "git.push@1",
			level: "3",
		}).ok,
	).toBe(false);
});

it("shows own source labels and warns about over-limit entries without blocking repair", () => {
	expect(html(props({ "fs.write@1": 1 }))).toContain("Own override");
	expect(html({ ...props(), autonomy: 0 })).toContain("Above current autonomy");
	const p = props();
	control(new PolicyOverridesField(p), "Rule source").onChange?.({
		target: { value: "custom" },
	});
	expect(p.onChange).toHaveBeenCalledWith(inherited);
});

it("repairs multiple over-limit copies one row at a time while Save still validates the whole draft", () => {
	const original = { "shell.exec@1": 2, "fs.write@1": 2 } as const;
	const p = { ...props(), inherited: original, autonomy: 1 as const };
	const copied = changePolicyOverride(p, { kind: "source", mode: "custom" });
	expect(copied).toEqual(ok(original));
	if (!copied.ok) throw new Error("Copy refused");
	const custom = { ...p, value: copied.value };
	const field = new PolicyOverridesField(custom);
	expect(control(field, "Rule source").disabled).not.toBe(true);
	expect(control(field, "Level for shell.exec@1").disabled).toBe(false);
	control(field, "Level for shell.exec@1").onChange?.({
		target: { value: "1" },
	});
	expect(p.onChange).toHaveBeenCalledWith({
		"shell.exec@1": 1,
		"fs.write@1": 2,
	});
	const first = changePolicyOverride(custom, {
		kind: "level",
		ref: "shell.exec@1",
		level: "1",
	});
	expect(first).toEqual(ok({ "shell.exec@1": 1, "fs.write@1": 2 }));
	if (!first.ok) throw new Error("First repair refused");
	expect(
		PolicySchema.safeParse({ autonomy: 1, overrides: first.value }).success,
	).toBe(false);
	const second = changePolicyOverride(
		{ ...custom, value: first.value },
		{ kind: "level", ref: "fs.write@1", level: "1" },
	);
	expect(second).toEqual(ok({ "shell.exec@1": 1, "fs.write@1": 1 }));
	if (!second.ok) throw new Error("Second repair refused");
	expect(
		PolicySchema.safeParse({ autonomy: 1, overrides: second.value }).success,
	).toBe(true);
	expect(
		changePolicyOverride(custom, { kind: "remove", ref: "shell.exec@1" }),
	).toEqual(ok({ "fs.write@1": 2 }));
	expect(
		changePolicyOverride(custom, { kind: "add", ref: "fs.read@1", level: "1" }),
	).toEqual(ok({ ...original, "fs.read@1": 1 }));
	expect(
		changePolicyOverride(custom, { kind: "add", ref: "fs.read@1", level: "2" })
			.ok,
	).toBe(false);
	expect(
		changePolicyOverride(custom, {
			kind: "level",
			ref: "shell.exec@1",
			level: "2",
		}).ok,
	).toBe(false);
	expect(original).toEqual({ "shell.exec@1": 2, "fs.write@1": 2 });
});

it("copies effective defaults at autonomy zero but never invents defaults for a custom raw layer", () => {
	expect(PolicySchema.safeParse({ autonomy: 0 }).success).toBe(true);
	const defaults = { "shell.exec@1": 1 } as const;
	const p = { ...props(), inherited: defaults, autonomy: 0 as const };
	const field = new PolicyOverridesField(p);
	control(field, "Rule source").onChange?.({ target: { value: "custom" } });
	expect(p.onChange).toHaveBeenCalledWith(defaults);
	const repaired = changePolicyOverride(
		{ ...p, inherited: {}, value: defaults },
		{ kind: "level", ref: "shell.exec@1", level: "0" },
	);
	expect(repaired).toEqual(ok({ "shell.exec@1": 0 }));
	const explicitEmpty = { ...p, inherited: {}, value: {} };
	expect(html(explicitEmpty)).not.toContain("shell.exec@1");
	expect(
		changePolicyOverride(explicitEmpty, { kind: "source", mode: "inherited" }),
	).toEqual(ok(undefined));
});

it("keeps half-typed add drafts when a different row changes or is removed", () => {
	const p = props({ "fs.write@1": 1 });
	const field = new PolicyOverridesField(p);
	field.state = { ref: "half.", level: "2" };
	control(field, "Level for fs.write@1").onChange?.({ target: { value: "0" } });
	control(field, "Remove own override fs.write@1").onClick?.();
	control(field, "Add override").onClick?.();
	expect(field.state).toEqual({ ref: "half.", level: "2" });
	expect(p.onChange).toHaveBeenCalledTimes(2);
});

it("locks native controls and directly invoked handlers while busy", () => {
	const p = { ...props({ "fs.write@1": 1 }), disabled: true };
	const field = new PolicyOverridesField(p);
	for (const label of [
		"Rule source",
		"Level for fs.write@1",
		"Capability",
		"Override level",
	])
		expect(control(field, label).disabled).toBe(true);
	control(field, "Rule source").onChange?.({ target: { value: "inherited" } });
	control(field, "Level for fs.write@1").onChange?.({ target: { value: "0" } });
	control(field, "Capability").onChange?.({ target: { value: "fs.read@1" } });
	control(field, "Remove own override fs.write@1").onClick?.();
	control(field, "Add override").onClick?.();
	expect(field.state.ref).toBe("");
	expect(p.onChange).not.toHaveBeenCalled();
	expect(html(p)).toContain('disabled=""');
});
