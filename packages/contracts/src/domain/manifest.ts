import { z } from "zod";
import {
	type CapabilityRef,
	CapabilityRefSchema,
	ModuleIdSchema,
} from "./ids.js";
import { err, ok, type Result } from "./result.js";

// ModuleManifest from docs/06-kernel-and-modules.md.

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

/** What a module may do; checked by the security policy. */
export const PermissionSchema = z.enum([
	"fs.read",
	"fs.write",
	"shell",
	"net",
	"secrets",
	"ui",
	"runtime.install",
	"llm",
]);

/** When the kernel activates a module. */
export type ActivationEvent =
	| "onStartup"
	| "onWorkspaceOpen"
	| `onCapability:${CapabilityRef}`
	| `onCommand:${string}`;

const isActivationEvent = (v: unknown): boolean => {
	if (v === "onStartup" || v === "onWorkspaceOpen") return true;
	if (typeof v !== "string") return false;
	if (v.startsWith("onCapability:"))
		return CapabilityRefSchema.safeParse(v.slice("onCapability:".length))
			.success;
	return v.startsWith("onCommand:") && v.length > "onCommand:".length;
};

/** Parses one activation event. */
export const ActivationEventSchema = z.custom<ActivationEvent>(
	isActivationEvent,
	"expected onStartup, onWorkspaceOpen, onCapability:<ref> or onCommand:<id>",
);

const refs = z.array(CapabilityRefSchema).readonly();

/** Parses a module manifest; third-party modules MUST run in their own process. */
export const ModuleManifestSchema = z
	.strictObject({
		id: ModuleIdSchema,
		version: z.string().regex(SEMVER, "expected a SemVer version"),
		displayName: z.string().min(1),
		class: z.enum(["essential", "optional"]),
		trust: z.enum(["core", "first-party", "third-party"]),
		provides: refs,
		requires: refs,
		optional: refs,
		activation: z.array(ActivationEventSchema).readonly(),
		isolation: z.enum(["in-process", "worker", "process"]),
		permissions: z.array(PermissionSchema).readonly(),
	})
	.refine((m) => m.trust !== "third-party" || m.isolation === "process", {
		message: "third-party modules MUST use isolation: process",
		path: ["isolation"],
	});

/** A validated module manifest. */
export type ModuleManifest = z.infer<typeof ModuleManifestSchema>;

/** Why a manifest failed validation. */
export type ManifestParseError = {
	readonly code: "invalid_manifest";
	readonly issues: ReadonlyArray<string>;
};

/** Validates a manifest before the kernel registers its module. */
export const parseManifest = (
	input: unknown,
): Result<ModuleManifest, ManifestParseError> => {
	const r = ModuleManifestSchema.safeParse(input);
	if (r.success) return ok(r.data);
	return err({
		code: "invalid_manifest",
		issues: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
	});
};
