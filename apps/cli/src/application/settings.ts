import type { SecretsMaskAdapter } from "@mete/contracts";
import { mergedSection } from "@mete/kernel";
import type { App } from "../infrastructure/app.js";

// What `mete/settings` answers (ADR-081): each configuration section the app loaded, merged as
// modules read it and per file. Keys live in the keychain (docs/09), but a string in a section, such
// as an MCP server's args, could still hold a token, so every string passes secrets.mask@1.

// Masks every string inside a value, keeping its shape.
const maskedWith =
	(mask: SecretsMaskAdapter) =>
	async (value: unknown): Promise<unknown> => {
		if (typeof value === "string") return (await mask.mask(value)).text;
		if (Array.isArray(value)) return Promise.all(value.map(maskedWith(mask)));
		if (typeof value !== "object" || value === null) return value;
		const entries = await Promise.all(
			Object.entries(value).map(
				async ([k, v]) => [k, await maskedWith(mask)(v)] as const,
			),
		);
		return Object.fromEntries(entries);
	};

/** The loaded sections with every string masked, or undefined without secrets.mask@1. */
export const settingsOf = async (app: App) => {
	const masker = app.registry.resolve<SecretsMaskAdapter>("secrets.mask@1");
	if (!masker.ok) return undefined;
	const masked = maskedWith(masker.value[0].impl);
	const { layers, loadedAt } = app.config;
	const names = [
		...new Set([
			...Object.keys(layers.global.sections),
			...Object.keys(layers.workspace),
		]),
	].sort();
	const sections = await Promise.all(
		names.map(async (name) => {
			const global = Object.hasOwn(layers.global.sections, name)
				? { file: layers.global.file, value: layers.global.sections[name] }
				: undefined;
			const ws = layers.workspace[name];
			return {
				name,
				merged: await masked(mergedSection(layers, name)),
				...(global
					? { global: { ...global, value: await masked(global.value) } }
					: {}),
				...(ws
					? { workspace: { file: ws.file, value: await masked(ws.value) } }
					: {}),
			};
		}),
	);
	return { loadedAt, sections };
};
