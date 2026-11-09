import {
	CapabilityRefSchema,
	err,
	ok,
	type Policy,
	PolicyActionSchema,
	type Result,
} from "@mete/contracts";
import { type ZodType, z } from "zod";

/** Existing structured policy fields, in display order (ADR-192). */
export const POLICY_RULE_KEYS = [
	"always_ask",
	"never_allow",
	"shell.allow",
	"shell.always",
	"overrides",
] as const;

/** One existing policy rule field, not a permission or an evaluation rule. */
export type PolicyRuleKey = (typeof POLICY_RULE_KEYS)[number];

/** Explicit rule values derived from the public policy contract. */
export type PolicyRuleValues = {
	readonly always_ask: Policy["always_ask"];
	readonly never_allow: Policy["never_allow"];
	readonly "shell.allow": Policy["shell"]["allow"];
	readonly "shell.always": Policy["shell"]["always"];
	readonly overrides: Policy["overrides"];
};
/** A value of any supported rule field. */
export type PolicyRuleValue = PolicyRuleValues[PolicyRuleKey];

// These leaf schemas are private in PolicySchema; mirror only their field shapes,
// without its defaults or override<=autonomy check (SECURITY.md, Policy file).
const text = z.string().min(1);
const commands = z.array(text).readonly();
const schemas: { readonly [K in PolicyRuleKey]: ZodType<PolicyRuleValues[K]> } =
	{
		always_ask: z.array(PolicyActionSchema).readonly(),
		never_allow: z
			.array(
				z.union([
					z.strictObject({
						action: PolicyActionSchema.extract([
							"fs.write",
							"fs.delete",
							"fs.write.outside",
						]),
						path: text,
					}),
					z.strictObject({
						action: z.literal("shell.exec"),
						command: text,
					}),
				]),
			)
			.readonly(),
		"shell.allow": commands,
		"shell.always": commands,
		overrides: z.record(
			z.string().pipe(CapabilityRefSchema),
			z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
		),
	};

// Zod containers may ignore hidden/symbol keys, array metadata or __proto__.
// Refuse those inputs before parsing rather than returning a lossy success.
const isDataKey = (value: object, key: string | symbol): boolean => {
	if (Array.isArray(value) && key === "length") return true;
	if (
		typeof key !== "string" ||
		["__proto__", "constructor", "prototype"].includes(key)
	)
		return false;
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return (
		descriptor?.enumerable === true &&
		"value" in descriptor &&
		(!Array.isArray(value) ||
			(/^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length))
	);
};

const hasPlainData = (value: unknown): boolean => {
	if (typeof value !== "object" || value === null) return true;
	const array = Array.isArray(value);
	const prototype: unknown = Object.getPrototypeOf(value);
	if (
		prototype !== (array ? Array.prototype : Object.prototype) &&
		!(prototype === null && !array)
	)
		return false;
	return Reflect.ownKeys(value).every((key) => isDataKey(value, key));
};

/** Reads one explicit field; undefined inherits, and invalid data returns a field-local error. */
export const readPolicyRule = <K extends PolicyRuleKey>(
	key: K,
	value: unknown,
): Result<PolicyRuleValues[K] | undefined, string> => {
	if (value === undefined) return ok(undefined);
	if (
		!hasPlainData(value) ||
		(key === "never_allow" &&
			Array.isArray(value) &&
			!value.every(hasPlainData))
	)
		return err(`${key}: unsupported own keys or non-data container`);
	const parsed = schemas[key].safeParse(value);
	if (parsed.success) return ok(parsed.data);
	const issue = parsed.error.issues[0];
	return err(
		`${[key, ...(issue?.path ?? [])].join(".")}: ${issue?.message ?? "invalid rule value"}`,
	);
};
