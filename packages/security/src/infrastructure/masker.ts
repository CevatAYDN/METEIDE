import { createHash } from "node:crypto";
import type { MaskResult } from "@mete/contracts";
import { lintSource } from "@secretlint/core";
import { creator as recommended } from "@secretlint/secretlint-rule-preset-recommend";
import { MASK_TAG_HEX } from "../defaults.js";

// secrets.mask@1 from docs/09 (Privacy): secretlint rules, `[SECRET:<first 8 hex of sha256>]`.

const CONFIG = {
	rules: [
		{ id: "@secretlint/secretlint-rule-preset-recommend", rule: recommended },
	],
};

const tag = (secret: string) =>
	`[SECRET:${createHash("sha256").update(secret).digest("hex").slice(0, MASK_TAG_HEX)}]`;

// Sorted and merged, so overlapping findings from two rules replace one span once.
const merge = (ranges: ReadonlyArray<readonly [number, number]>) => {
	const out: [number, number][] = [];
	for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
		const last = out.at(-1);
		if (last && start <= last[1]) last[1] = Math.max(last[1], end);
		else out.push([start, end]);
	}
	return out;
};

/** Replaces every secret secretlint finds; the text is never written anywhere. */
export const maskSecrets = async (text: string): Promise<MaskResult> => {
	const result = await lintSource({
		source: {
			content: text,
			filePath: "outbound.txt",
			ext: ".txt",
			contentType: "text",
		},
		options: { config: CONFIG, noPhysicFilePath: true },
	});
	const spans = merge(result.messages.map((m) => m.range));
	let out = "";
	let from = 0;
	for (const [start, end] of spans) {
		out += text.slice(from, start) + tag(text.slice(start, end));
		from = end;
	}
	return { text: out + text.slice(from), masked: spans.length };
};
