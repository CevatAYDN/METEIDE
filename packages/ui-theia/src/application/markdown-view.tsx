import type { MarkdownRenderer } from "@theia/core/lib/browser/markdown-rendering/markdown-renderer";
import { useEffect, useRef } from "react";

// Model text as Markdown: Theia's renderer sanitizes it (DOMPurify), so an answer can carry
// headings, lists and code without trusting the model with HTML.

/** Draws `text` as Markdown in a host element the component owns. */
export const MarkdownView = ({
	text,
	renderer,
}: {
	readonly text: string;
	readonly renderer: MarkdownRenderer;
}) => {
	const host = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const node = host.current;
		if (!node) return;
		const drawn = renderer.render({ value: text });
		node.replaceChildren(drawn.element);
		return () => {
			drawn.dispose();
			node.replaceChildren();
		};
	}, [renderer, text]);
	return (
		<div
			className="mete-markdown"
			style={{ overflowWrap: "anywhere" }}
			ref={host}
		/>
	);
};
