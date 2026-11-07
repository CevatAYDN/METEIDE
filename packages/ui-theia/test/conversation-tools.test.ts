import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	ConversationTools,
	toggleConversationGroup,
} from "../src/application/conversation-tools.js";

type Checkbox = ReactElement<{
	readonly id: string;
	readonly disabled: boolean;
	readonly onChange: (event: { target: { checked: boolean } }) => void;
}>;
type Label = ReactElement<{
	readonly htmlFor: string;
	readonly children: [Checkbox, ReactElement];
}>;
type Replace = ReactElement<{
	readonly children: string;
	readonly type: string;
	readonly disabled?: boolean;
	readonly onClick: () => void;
}>;

const inspect = (props: Parameters<typeof ConversationTools>[0]) => {
	const captured: { view?: ReturnType<typeof ConversationTools> } = {};
	const Probe = () => {
		captured.view = ConversationTools(props);
		return captured.view;
	};
	const markup = renderToStaticMarkup(createElement(Probe));
	if (!captured.view) throw new Error("Selector did not render");
	return { view: captured.view, markup };
};

describe("conversation tool groups", () => {
	it("starts unchecked and names MCP's whole configured-server scope", () => {
		const markup = renderToStaticMarkup(
			createElement(ConversationTools, {
				capabilities: [],
				onChange: () => {},
			}),
		);
		expect(markup.match(/type="checkbox"/g)).toHaveLength(2);
		expect(markup).not.toContain('checked=""');
		expect(markup).toContain("Web");
		expect(markup).toContain("MCP servers (all configured servers)");
	});

	it("toggles web as one group without removing MCP or duplicating references", () => {
		const selected = toggleConversationGroup(["mcp.tools@1"], "web", true);
		expect(selected).toEqual(["mcp.tools@1", "web.search@1", "web.fetch@1"]);
		expect(toggleConversationGroup(selected, "web", true)).toEqual(selected);
		expect(toggleConversationGroup(selected, "web", false)).toEqual([
			"mcp.tools@1",
		]);
		expect(toggleConversationGroup(selected, "mcp", false)).toEqual([
			"web.search@1",
			"web.fetch@1",
		]);
	});

	it("keeps unknown saved selection mixed and refuses checkbox edits until explicit replacement", () => {
		const onChange = vi.fn();
		const { view, markup } = inspect({
			capabilities: undefined,
			onChange,
		});
		expect(markup).toContain("<fieldset");
		expect(markup.match(/aria-checked="mixed"/g)).toHaveLength(2);
		expect(markup.match(/disabled=""/g)).toHaveLength(2);
		const [[label], replace] = view.props.children as [[Label, Label], Replace];
		const checkbox = label.props.children[0];
		expect(label.props.htmlFor).toBe(checkbox.props.id);
		checkbox.props.onChange({ target: { checked: true } });
		expect(onChange).not.toHaveBeenCalled();
		expect(replace.props.children).toBe("Replace saved selection");
		expect(replace.props.type).toBe("button");
		replace.props.onClick();
		expect(onChange).toHaveBeenCalledExactlyOnceWith([]);
	});

	it("guards disabled checkbox and replacement handlers as well as native controls", () => {
		for (const capabilities of [undefined, []]) {
			const onChange = vi.fn();
			const { view } = inspect({
				capabilities,
				disabled: true,
				onChange,
			});
			const [[label], replace] = view.props.children as [
				[Label, Label],
				Replace | false,
			];
			const checkbox = label.props.children[0];
			expect(checkbox.props.disabled).toBe(true);
			checkbox.props.onChange({ target: { checked: true } });
			if (replace) {
				expect(replace.props.disabled).toBe(true);
				replace.props.onClick();
			}
			expect(onChange).not.toHaveBeenCalled();
		}
	});

	it("allows known checkbox edits without dropping the other group", () => {
		const onChange = vi.fn();
		const { view } = inspect({
			capabilities: ["mcp.tools@1"],
			onChange,
		});
		const [[label], replace] = view.props.children as [[Label, Label], false];
		expect(replace).toBe(false);
		const checkbox = label.props.children[0];
		expect(checkbox.props.disabled).toBe(false);
		checkbox.props.onChange({ target: { checked: true } });
		expect(onChange).toHaveBeenCalledExactlyOnceWith([
			"mcp.tools@1",
			"web.search@1",
			"web.fetch@1",
		]);
	});
});
