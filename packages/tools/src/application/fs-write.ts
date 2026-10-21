import {
	err,
	FsEditInputSchema,
	type FsEditOutput,
	type FsWriteInput,
	FsWriteInputSchema,
	type FsWriteOutput,
	ok,
	type Result,
	type ToolContext,
	type ToolError,
} from "@mete/contracts";
import { editText, isBinary } from "../domain/text.js";
import { deleteFile, readBytes, writeText } from "../infrastructure/files.js";
import { type FsDeps, parse, permit, placeToChange } from "./fs-common.js";

// fs.write@1 and fs.edit@1 (docs/10, Built-in tools): policy.check@1 first, then the file.

type Out<T> = Promise<Result<T, ToolError>>;

export const writeTool = async (
	deps: FsDeps,
	input: unknown,
	ctx: ToolContext,
): Out<FsWriteOutput> => {
	const i = parse(FsWriteInputSchema, input);
	if (!i.ok) return i;
	const at = await placeToChange(deps, i.value.path);
	if (!at.ok) return at;
	const p = at.value;
	const del = "delete" in i.value;
	const action = del ? "fs.delete" : p.inside ? "fs.write" : "fs.write.outside";
	const allowed = permit(
		deps,
		{ action, capability: "fs.write@1", path: p.real, args: i.value },
		ctx,
	);
	if (!allowed.ok) return allowed;
	return change(p.real, i.value);
};

const change = async (real: string, i: FsWriteInput): Out<FsWriteOutput> => {
	if ("delete" in i) {
		const gone = await deleteFile(real);
		return gone.ok ? ok({ bytes: 0 }) : gone;
	}
	const written = await writeText(real, i.content, i.createOnly);
	return written.ok ? ok({ bytes: Buffer.byteLength(i.content) }) : written;
};

export const editTool = async (
	deps: FsDeps,
	input: unknown,
	ctx: ToolContext,
): Out<FsEditOutput> => {
	const i = parse(FsEditInputSchema, input);
	if (!i.ok) return i;
	const at = await placeToChange(deps, i.value.path);
	if (!at.ok) return at;
	const p = at.value;
	const action = p.inside ? "fs.write" : "fs.write.outside";
	const allowed = permit(
		deps,
		{ action, capability: "fs.edit@1", path: p.real, args: i.value },
		ctx,
	);
	if (!allowed.ok) return allowed;
	const bytes = await readBytes(p.real);
	if (!bytes.ok) return bytes;
	if (isBinary(bytes.value))
		return err({ code: "binary", message: `${i.value.path} is a binary file` });
	const edited = editText(bytes.value.toString("utf8"), i.value);
	if ("count" in edited)
		return err({
			code: "match_count",
			count: edited.count,
			message: `oldStr matched ${edited.count} times in ${i.value.path}; it must match exactly once unless replaceAll`,
		});
	const written = await writeText(p.real, edited.text);
	return written.ok ? ok({ replacements: edited.replacements }) : written;
};
