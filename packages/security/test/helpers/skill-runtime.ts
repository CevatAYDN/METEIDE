import {
	ok,
	type SkillTrustAdapter,
	type SkillTrustList,
} from "@mete/contracts";
import { vi } from "vitest";
import type { SkillRuntimeReaderOptions } from "../../src/application/skill-runtime-readers.js";
import { skillFixture } from "./skill-readers.js";

/** Native reader identities and scripted trust status for runtime read/load/check tests. */
export const skillRuntimeFixture = () => {
	const f = skillFixture();
	const status: SkillTrustList = {
		entries: [],
		complete: true,
		diagnostics: [],
	};
	const lifecycle = { current: true };
	const management = vi.fn(async () => {
		throw new Error("unexpected management operation");
	});
	const trust = {
		status: vi.fn<SkillTrustAdapter["status"]>(async () => ok(status)),
		prepare: management,
		approve: management,
		disable: management,
	} satisfies SkillTrustAdapter;
	const registration = f.options.registry.provide("skill.trust@1", {
		...f.adapters.source,
		impl: trust,
	});
	const options = {
		...f.options,
		nativeTrust: new WeakSet<SkillTrustAdapter>([trust]),
		nativeMaskers: new WeakSet([f.adapters.masker.impl]),
		current: () => lifecycle.current,
	} satisfies SkillRuntimeReaderOptions;
	return { ...f, status, lifecycle, management, trust, registration, options };
};
