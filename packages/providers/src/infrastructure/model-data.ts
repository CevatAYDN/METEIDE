import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { type ModelData, ModelDataSchema } from "../domain/model-data.js";

// The shipped models.yaml sits in data/, two folders up from src/ and dist/ files (docs/09).
const SHIPPED = new URL("../../data/models.yaml", import.meta.url);

/** Reads and validates the shipped model rows; a broken file is a packaging bug. */
export const loadShippedModels = async (
	file: URL = SHIPPED,
): Promise<ModelData> =>
	ModelDataSchema.parse(parse(await readFile(file, "utf8")));
