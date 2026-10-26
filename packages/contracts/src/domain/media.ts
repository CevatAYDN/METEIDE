import { z } from "zod";

// media.*@1, 3d.*@1 and gameengine.*@1 of docs/06 (Capabilities), run through level 2 mappings
// (ADR-120). A media or 3d answer is the workspace-relative path of the file the server wrote;
// an engine answer is its log, from which the tester writes its test-report@1.

const file = z.string().min(1);
const prompt = z.string().trim().min(1);
// Where an asset-spec@1 entry wants the file.
const path = file.optional();

/** Input of media.image.generate@1 and media.3d.fromText@1. */
export const MediaFromTextInputSchema = z.strictObject({ prompt, path });
/** Input of media.image.edit@1. */
export const MediaImageEditInputSchema = z.strictObject({ file, prompt, path });
/** Input of media.3d.fromImage@1. */
export const Media3dFromImageInputSchema = z.strictObject({ file, path });
/** Input of 3d.export@1: `format` is the target file format, such as glb. */
export const Export3dInputSchema = z.strictObject({
	file,
	format: z.string().min(1),
	path,
});
/** Input of 3d.cleanup@1: `ops` are the operations to run, such as decimate or uv_unwrap. */
export const Cleanup3dInputSchema = z.strictObject({
	file,
	ops: z.array(z.string().min(1)).min(1).readonly(),
});
/** Input of gameengine.build@1 and gameengine.test@1: the engine works on the workspace's project. */
export const GameEngineRunInputSchema = z.strictObject({});
/** Input of gameengine.importAsset@1. */
export const GameEngineImportInputSchema = z.strictObject({ file });

/** Output of the media.* capabilities and 3d.export@1. */
export const MediaFileOutputSchema = z.strictObject({ file });
/** Output of 3d.cleanup@1. */
export const Cleanup3dOutputSchema = z.strictObject({
	file,
	report: z.string(),
});
/** Output of the gameengine.* capabilities. */
export const GameEngineLogOutputSchema = z.strictObject({ log: z.string() });
