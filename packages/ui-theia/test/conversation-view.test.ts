import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Conversation } from "../src/application/conversation-view.js";

it("keeps a labeled message composer after a reply and disables Send during work", () => {
	const base = {
		goal: "selam",
		status: "completed",
		steps: [{ text: "Merhaba", toolCalls: [] }],
		markdown: {
			render: () => {
				throw new Error("browser only");
			},
		},
		onReply: async () => undefined,
	};
	const out = renderToStaticMarkup(createElement(Conversation, base));
	expect(out).toContain("textarea");
	expect(out).toContain("Send message");
	expect(out).toContain("Conversation");
	expect(out).toContain("selam");
	expect(out).not.toContain('aria-label="Steps"');
	const busy = renderToStaticMarkup(
		createElement(Conversation, { ...base, status: "running" }),
	);
	expect(busy).toContain("Wait for the current response");
});
