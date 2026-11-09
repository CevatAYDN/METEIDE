import { PolicyActionSchema } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { Children, isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { Chips } from "../src/application/fields.js";
import { PolicyListField } from "../src/application/policy-list-field.js";

type Props = Parameters<typeof PolicyListField>[0];
type Control = {
	readonly children?: ReactNode;
	readonly "aria-label"?: string;
	readonly value?: string;
	readonly checked?: boolean;
	readonly disabled?: boolean;
	readonly onChange?: (event: {
		target: { value: string; checked: boolean };
	}) => void;
};
const nodes = (node: ReactNode): readonly ReactNode[] =>
	Children.toArray(node).flatMap((child): ReactNode[] =>
		isValidElement<Control>(child)
			? [child, ...nodes(child.props.children)]
			: [child],
	);
const control = (tree: ReactNode, label: string) => {
	const node = nodes(tree).find(
		(child) =>
			isValidElement<Control>(child) && child.props["aria-label"] === label,
	);
	if (!isValidElement<Control>(node)) throw new Error(`Missing ${label}`);
	return node.props;
};
const chips = (tree: ReactNode) => {
	const node = nodes(tree).find(
		(child) => isValidElement(child) && child.type === Chips,
	);
	if (!isValidElement<Parameters<typeof Chips>[0]>(node))
		throw new Error("Missing Chips");
	return node.props;
};
const change = (value: string, checked = false) => ({
	target: { value, checked },
});
const setup = (props: Partial<Props> = {}) => {
	const onChange = vi.fn();
	return {
		onChange,
		tree: PolicyListField({
			field: "always_ask",
			value: undefined,
			inherited: ["git.push"],
			...props,
			onChange,
		}),
	};
};

describe("structured policy lists (ADR-192)", () => {
	it("distinguishes inheritance from a custom empty list", () => {
		const inherited = setup();
		expect(control(inherited.tree, "Rule source").value).toBe("inherited");
		const push = control(inherited.tree, "Push commits");
		expect(push.checked).toBe(true);
		expect(push.disabled).toBe(true);
		expect(push.onChange).toBeUndefined();
		const custom = setup({ value: [] });
		expect(control(custom.tree, "Rule source").value).toBe("custom");
		expect(control(custom.tree, "Push commits").checked).toBe(false);
		expect(custom.onChange).not.toHaveBeenCalled();
	});

	it("customizes by copying inherited values, preserves custom values and can inherit again", () => {
		const values = Object.freeze(["git.push", "git.merge"]);
		const t = setup({ inherited: values });
		control(t.tree, "Rule source").onChange?.(change("custom"));
		expect(t.onChange).toHaveBeenCalledWith(values);
		expect(t.onChange.mock.calls[0]?.[0]).not.toBe(values);
		const custom = setup({ value: ["git.commit"], inherited: values });
		control(custom.tree, "Rule source").onChange?.(change("custom"));
		control(custom.tree, "Rule source").onChange?.(change("unknown"));
		expect(custom.onChange).not.toHaveBeenCalled();
		control(custom.tree, "Rule source").onChange?.(change("inherited"));
		expect(custom.onChange).toHaveBeenCalledWith(undefined);
	});

	it("uses all public actions and changes checkboxes without reordering surviving values", () => {
		const t = setup({ value: ["git.merge", "git.push"] });
		const checkboxes = nodes(t.tree).filter(
			(node) =>
				isValidElement<Control>(node) && node.props.checked !== undefined,
		);
		expect(checkboxes).toHaveLength(PolicyActionSchema.options.length);
		control(t.tree, "Commit changes").onChange?.(change("", true));
		expect(t.onChange).toHaveBeenLastCalledWith([
			"git.merge",
			"git.push",
			"git.commit",
		]);
		control(t.tree, "Push commits").onChange?.(change("", false));
		expect(t.onChange).toHaveBeenLastCalledWith(["git.merge"]);
		control(t.tree, "Push commits").onChange?.(change("", true));
		expect(t.onChange).toHaveBeenLastCalledWith(["git.merge", "git.push"]);
	});

	it.each(["shell.allow", "shell.always"] as const)(
		"shows inherited %s commands without Chips and keeps custom order/text",
		(field) => {
			const values = [" git diff * ", "echo x", "git diff *"];
			const inherited = setup({ field, inherited: values });
			expect(
				nodes(inherited.tree).some(
					(n) => isValidElement(n) && n.type === Chips,
				),
			).toBe(false);
			expect(nodes(inherited.tree)).toContain(values.join("\n"));
			control(inherited.tree, "Rule source").onChange?.(change("custom"));
			expect(inherited.onChange).toHaveBeenCalledWith(values);
			const t = setup({ field, value: values });
			const list = chips(t.tree);
			expect(list.values).toEqual(values);
			expect(list.hints).toEqual([]);
			list.onChange([" git diff * ", "git diff *", "echo next"]);
			expect(t.onChange).toHaveBeenCalledWith([
				" git diff * ",
				"git diff *",
				"echo next",
			]);
			list.onChange([]);
			expect(t.onChange).toHaveBeenLastCalledWith([]);
			expect(list.label).toBe(
				field === "shell.allow"
					? "Commands allowed at risky approval"
					: "Remembered command approvals",
			);
		},
	);

	it("locks disabled native controls and refuses directly invoked callbacks", () => {
		const t = setup({ value: ["git.push"], disabled: true });
		expect(t.tree.props.disabled).toBe(true);
		control(t.tree, "Rule source").onChange?.(change("inherited"));
		control(t.tree, "Commit changes").onChange?.(change("", true));
		expect(t.onChange).not.toHaveBeenCalled();
		const inherited = setup({ disabled: true });
		control(inherited.tree, "Rule source").onChange?.(change("custom"));
		expect(inherited.onChange).not.toHaveBeenCalled();
		const commands = setup({ field: "shell.allow", value: [], disabled: true });
		chips(commands.tree).onChange(["echo x"]);
		expect(commands.onChange).not.toHaveBeenCalled();
	});

	it("uses live localization for action labels and source choices", () => {
		const previous = nls.localization;
		nls.localization = {
			languageId: "tr",
			translations: {
				"mete/permissions/actionGitPush": "Translated push",
				"mete/permissions/source": "Translated source",
				"mete/permissions/inherited": "Translated inherited",
				"mete/permissions/custom": "Translated custom",
			},
		};
		try {
			expect(control(setup().tree, "Translated push").checked).toBe(true);
			expect(control(setup().tree, "Translated source").value).toBe(
				"inherited",
			);
			expect(nodes(setup().tree)).toContain("Translated inherited");
			expect(nodes(setup().tree)).toContain("Translated custom");
		} finally {
			nls.localization = previous;
		}
	});
});
