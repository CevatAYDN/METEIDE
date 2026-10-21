import { z } from "zod";

// Naming conventions from docs/README.md. The catalog in tab 06 uses camelCase
// actions (media.3d.fromText) and digit-led domains (3d.cleanup), so segments allow both.
const CAPABILITY_REF =
	/^[a-z0-9][a-zA-Z0-9]*(\.[a-z0-9][a-zA-Z0-9]*)+@[1-9]\d*$/;
// Past tense is not machine-checkable (network.lost), so only the shape is enforced.
const EVENT_TYPE = /^[a-z]+(\.[a-z]+)+$/;
const MODULE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Versioned capability id, for example `knowledge.search@1`. */
export type CapabilityRef = `${string}@${number}`;

/** Parses a capability id: `domain.action@major`. */
export const CapabilityRefSchema = z.custom<CapabilityRef>(
	(v) => typeof v === "string" && CAPABILITY_REF.test(v),
	"expected a capability id like domain.action@1",
);

/** Parses an event type: `domain.entity.verb`. */
export const EventTypeSchema = z
	.string()
	.regex(EVENT_TYPE, "expected an event type like run.started");

/** Parses a kebab-case module id. */
export const ModuleIdSchema = z
	.string()
	.regex(MODULE_ID, "expected a kebab-case module id");

/** Parses an entity id made by `crypto.randomUUID()`. */
export const IdSchema = z.uuid();

/** Parses an ISO 8601 timestamp in UTC. */
export const TimestampSchema = z.iso.datetime();

const ARTIFACT_TYPE_REF = /^[a-z][a-z0-9-]*@[1-9]\d*$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

/** Parses an artifact type with its version, for example `gdd@1` (docs/07, Artifact). */
export const ArtifactTypeRefSchema = z
	.string()
	.regex(ARTIFACT_TYPE_REF, "expected an artifact type like gdd@1");

/** Parses a SemVer version. */
export const SemverSchema = z
	.string()
	.regex(SEMVER, "expected a SemVer version");
