import {
	type LlmChatAdapter,
	ok,
	type PolicyCheckAdapter,
	type PolicyVerdict,
	type SecretStore,
} from "@mete/contracts";
import {
	createCapabilityRegistry,
	createConfigReader,
	createEventBus,
	type ModuleContext,
} from "@mete/kernel";

type Verdict = PolicyVerdict["verdict"];

/**
 * A module context with the given settings sections, a policy that answers `verdict` (or what the
 * function says for an action), the reasons of every warning and every info line. `chat` is the
 * llm.chat@2 adapter the registry offers and `secrets` the keychain the module sees, when given.
 */
export const moduleContext = (
	verdict: Verdict | ((action: string) => Verdict),
	sections: Readonly<Record<string, unknown>> = {},
	chat?: LlmChatAdapter,
	secrets?: SecretStore,
) => {
	const registry = createCapabilityRegistry(() => []);
	const policy: PolicyCheckAdapter = {
		check: (input) => {
			const v = typeof verdict === "function" ? verdict(input.action) : verdict;
			return ok({ verdict: v, rule: `kit:${v}` });
		},
	};
	registry.provide("policy.check@1", {
		id: "security",
		trust: "core",
		features: [],
		impl: policy,
	});
	if (chat)
		registry.provide("llm.chat@2", {
			id: "gateway",
			trust: "core",
			features: [],
			impl: chat,
		});
	const warnings: string[] = [];
	const infos: Record<string, unknown>[] = [];
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
			info: (fields: Readonly<Record<string, unknown>>, msg: string) => {
				infos.push({ ...fields, msg });
			},
			debug: log,
		},
		disposables: { add: () => {}, dispose: () => {} },
		...(secrets ? { secrets } : {}),
	} satisfies ModuleContext;
	return { ctx, registry, warnings, infos };
};
