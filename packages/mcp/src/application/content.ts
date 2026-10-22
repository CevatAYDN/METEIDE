import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { McpContent } from "@mete/contracts";
import type { ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import { saveAsset } from "../infrastructure/assets.js";

// A tool result's content blocks as McpContent (docs/10, content types). Images are saved and
// named by path; audio and binary resources are saved too and linked by their file URL, since
// mcp.tools@1 has no audio content of its own.

const saved = async (workspaceDir: string, data: string, mimeType: string) => {
	const path = await saveAsset(workspaceDir, data, mimeType);
	const uri = pathToFileURL(join(workspaceDir, path)).href;
	return { type: "resource", uri, mimeType } as const;
};

const embedded = (
	workspaceDir: string,
	r: Extract<ContentBlock, { type: "resource" }>["resource"],
): Promise<McpContent> | McpContent => {
	if ("text" in r && typeof r.text === "string")
		return { type: "text", text: r.text };
	if ("blob" in r && typeof r.blob === "string")
		return saved(
			workspaceDir,
			r.blob,
			r.mimeType ?? "application/octet-stream",
		);
	return {
		type: "resource",
		uri: r.uri,
		...(r.mimeType ? { mimeType: r.mimeType } : {}),
	};
};

const one = async (
	workspaceDir: string,
	b: ContentBlock,
): Promise<McpContent> => {
	switch (b.type) {
		case "text":
			return { type: "text", text: b.text };
		case "image": {
			const path = await saveAsset(workspaceDir, b.data, b.mimeType);
			return { type: "image", mediaType: b.mimeType, path };
		}
		case "audio":
			return saved(workspaceDir, b.data, b.mimeType);
		case "resource_link":
			return {
				type: "resource",
				uri: b.uri,
				...(b.mimeType ? { mimeType: b.mimeType } : {}),
			};
		case "resource":
			return embedded(workspaceDir, b.resource);
	}
};

/** Converts every block in order; a failed save rejects, and the caller reports it as io. */
export const toContent = (
	workspaceDir: string,
	blocks: readonly ContentBlock[],
) => Promise.all(blocks.map((b) => one(workspaceDir, b)));
