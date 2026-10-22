import {
	ok,
	type PolicyCheckAdapter,
	type PolicyVerdict,
} from "@mete/contracts";
import {
	createCapabilityRegistry,
	createConfigReader,
	createEventBus,
	type ModuleContext,
} from "@mete/kernel";

/** A module context with the given settings sections, a policy that always answers `verdict`, and the reasons of every warning. */
export const moduleContext = (
	verdict: PolicyVerdict["verdict"],
	sections: Readonly<Record<string, unknown>> = {},
) => {
	const registry = createCapabilityRegistry(() => []);
	const policy: PolicyCheckAdapter = {
		check: () => ok({ verdict, rule: `kit:${verdict}` }),
	};
	registry.provide("policy.check@1", {
		id: "security",
		trust: "core",
		features: [],
		impl: policy,
	});
	const warnings: string[] = [];
	const log = () => {};
	const ctx = {
		capabilities: registry,
		events: createEventBus((e) => {
			throw e;
		}),
		config: createConfigReader({
			global: { file: "settings.yaml", sections },
			workspace: {},
		}),
		logger: {
			error: log,
			warn: (fields: Readonly<Record<string, unknown>>) => {
				warnings.push(String(fields.reason ?? ""));
			},
			info: log,
			debug: log,
		},
		disposables: { add: () => {}, dispose: () => {} },
	} satisfies ModuleContext;
	return { ctx, registry, warnings };
};
