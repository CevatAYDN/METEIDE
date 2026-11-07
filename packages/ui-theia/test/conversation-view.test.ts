import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Conversation } from "../src/application/conversation-view.js";

it("keeps older history readable while explicitly disabling its composer", () => {
	const out = renderToStaticMarkup(
		createElement(Conversation, {
			goal: "Older turn",
			status: "completed",
			steps: [],
			replyReady: false,
			markdown: {
				render: () => {
					throw new Error("browser only");
				},
			},
			onReply: async () => undefined,
		}),
	);
	expect(out).toContain("Older turn");
	expect(out).toContain("Return to the latest turn to reply.");
	expect(out).toMatch(/<textarea[^>]*disabled=""/);
	expect(out).toContain('disabled="" aria-label="Send message"');
});

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
	expect(out).toContain(
		'<section class="mete-chat-scroll" tabindex="0" aria-label="Messages">',
	);
	expect(out).not.toContain('role="region"');
	expect(out.indexOf("</form>")).toBeGreaterThan(
		out.indexOf("mete-chat-scroll"),
	);
	expect(out).not.toContain("Shift+Enter");
	expect(out).toContain('aria-label="Send message" title="Send message"');
	const busy = renderToStaticMarkup(
		createElement(Conversation, { ...base, status: "running" }),
	);
	expect(busy).toContain("Wait for the current response");
});

it("keeps optional tools beside Send, outside the transcript scroll region", () => {
	const out = renderToStaticMarkup(
		createElement(Conversation, {
			goal: "Work",
			status: "completed",
			steps: [],
			markdown: {
				render: () => {
					throw new Error("browser only");
				},
			},
			onReply: async () => undefined,
			tools: createElement("button", { type: "button" }, "Tools"),
			details: createElement(
				"details",
				{},
				createElement("summary", {}, "Metrics"),
			),
		}),
	);
	expect(out).toContain("Metrics");
	expect(out.indexOf("Metrics")).toBeLessThan(out.indexOf("<form"));
	expect(out.indexOf(">Tools<")).toBeGreaterThan(out.indexOf("<form"));
});
