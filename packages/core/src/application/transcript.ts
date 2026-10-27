import {
	type EngineError,
	ok,
	type Result,
	type Transcript,
	type TranscriptStep,
} from "@mete/contracts";
import { TRANSCRIPT_FIELD_MAX } from "../defaults.js";
import { conversationsOf, cut } from "../domain/transcript.js";
import { type EngineState, peek } from "./run-state.js";
import { masked, type StepDeps } from "./steps.js";

// team.engine@2 `transcript` (ADR-125): the steps of a run's saved conversation, masked when read,
// since tool arguments are stored as the model sent them. A field is masked before it is cut, so a
// cut never splits a secret the mask would have found.

const field = async (deps: StepDeps, text: string) =>
	cut(await masked(deps, text), TRANSCRIPT_FIELD_MAX);

const maskStep = async (
	deps: StepDeps,
	s: TranscriptStep,
): Promise<TranscriptStep> => ({
	...s,
	...(s.text === undefined ? {} : { text: await masked(deps, s.text) }),
	toolCalls: await Promise.all(
		s.toolCalls.map(async (c) => ({
			...c,
			args: await field(deps, c.args),
			...(c.result
				? { result: { ...c.result, text: await field(deps, c.result.text) } }
				: {}),
		})),
	),
});

/** The run's transcript, live or stored, without taking a stored run into the engine. */
export const readTranscript = async (
	s: EngineState,
	runId: string,
): Promise<Result<Transcript, EngineError>> => {
	const snapshot = peek(s, runId);
	if (!snapshot.ok) return snapshot;
	const conversations = await Promise.all(
		conversationsOf(snapshot.value.context).map(async (c) => ({
			...c,
			steps: await Promise.all(c.steps.map((step) => maskStep(s.deps, step))),
		})),
	);
	return ok({ runId, conversations });
};
