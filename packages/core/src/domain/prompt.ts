import type { ChatMessage } from "@mete/contracts";

// The opening messages of a single-agent run (docs/08, Single agent and Agent context assembly).

/** Where the agent works: the operating system and the shell shell.exec@1 runs. */
export type Platform = { readonly os: string; readonly shell: string };

/** The system message for role `assistant`, then the goal. */
export const openingMessages = (
	goal: string,
	where: Platform,
): ChatMessage[] => [
	{
		role: "system",
		content: [
			"You are the assistant: one agent working in the user's workspace.",
			"Reach the goal in the user's message with small, verified steps.",
			"Use the tools to read, search and change files and to run commands; paths are relative to the workspace root.",
			"When the goal is reached, reply without calling a tool: a short summary of what you changed and how you checked it.",
			`Operating system: ${where.os}. Shell: ${where.shell}.`,
		].join("\n"),
	},
	{ role: "user", content: goal },
];
