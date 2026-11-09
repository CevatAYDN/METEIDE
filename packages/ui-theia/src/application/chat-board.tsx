import {
	type MeteEvent,
	ModelRefSchema,
	type Transcript,
} from "@mete/contracts";
import type { TeamView } from "@mete/ui-studio";
import type { MarkdownRenderer } from "@theia/core/lib/browser/markdown-rendering/markdown-renderer";
import { nls } from "@theia/core/lib/common/nls";
import type { ReactNode } from "react";
import type { DaemonFailure } from "../domain/status-service.js";
import type { RestoreControls } from "./checkpoint-list.js";
import { CheckpointList } from "./checkpoint-list.js";
import type { MessageDraft } from "./context-drafts.js";
import type { Windows } from "./context-meter.js";
import { Conversation } from "./conversation-view.js";
import { NowSlot } from "./now-slot.js";
import { type Hero, heroOf, type RunFacts } from "./run-hero.js";
import { RunRail } from "./run-rail.js";
import { PausedRun } from "./runs-list.js";
import { Failure } from "./single-agent.js";
import { failureText } from "./status-text.js";
import { toneStyle } from "./tone.js";
import type { WaitingControls } from "./waiting-strip.js";

const Metrics = ({ hero }: { readonly hero: Hero }) => (
	<div className="mete-chat-metrics">
		{hero.facts.map((fact) => (
			<span key={fact.key} title={fact.title}>
				{fact.text}
			</span>
		))}
		<dl>
			{hero.tiles.map((tile) => (
				<div key={tile.key}>
					<dt>{tile.caption}</dt>
					<dd>{tile.value}</dd>
				</div>
			))}
		</dl>
	</div>
);

const selectionText = (
	run: RunFacts["run"],
	preferredModels: Readonly<Record<string, string>> | undefined,
) => {
	if (!run) return undefined;
	const preferred = ModelRefSchema.safeParse(run.prefer);
	if (run.prefer !== undefined && !preferred.success) return undefined;
	const saved = preferred.success
		? `${preferred.data.providerId}/${preferred.data.modelId}`
		: undefined;
	// The picker session includes acknowledged changes that emit no run event.
	const current =
		preferredModels === undefined ? saved : preferredModels.assistant;
	return current
		? nls.localize("mete/chat/preferredModel", "Preferred model: {0}", current)
		: nls.localize("mete/chat/automaticModel", "Model selection: Automatic");
};

const ModelEvidence = ({
	view,
	facts,
	preferredModels,
}: {
	readonly view: TeamView;
	readonly facts: RunFacts;
	readonly preferredModels?: Readonly<Record<string, string>> | undefined;
}) => {
	// Created order is not usage order; only one taskless assistant is unambiguous.
	const assistants = view.agents.filter(
		(agent) => agent.roleId === "assistant" && agent.taskId === undefined,
	);
	const agent = assistants.length === 1 ? assistants[0] : undefined;
	const last = agent
		? nls.localize(
				"mete/chat/lastModel",
				"Last model: {0}",
				`${agent.providerId}/${agent.modelId}`,
			)
		: nls.localize("mete/chat/modelNotReported", "Last model: Not reported");
	const selection = selectionText(facts.run, preferredModels);
	return (
		<div className="mete-chat-model">
			<span>{last}</span>
			{selection ? <span>{selection}</span> : null}
		</div>
	);
};

const Header = ({
	facts,
	hero,
	view,
	preferredModels,
	onResume,
}: {
	readonly facts: RunFacts;
	readonly hero: Hero;
	readonly view: TeamView;
	readonly preferredModels?: Readonly<Record<string, string>> | undefined;
	readonly onResume: () => void;
}) => {
	const reason =
		facts.run?.status === "paused" ? facts.run.pauseReason : undefined;
	return (
		<header className="mete-chat-header">
			<h2>{nls.localize("mete/chat/title", "Conversation")}</h2>
			{hero.status ? (
				<span
					role="status"
					className="mete-chat-status"
					style={toneStyle(hero.status.tone)}
				>
					{hero.status.word}
				</span>
			) : null}
			<ModelEvidence
				view={view}
				facts={facts}
				preferredModels={preferredModels}
			/>
			{reason === "quota" || reason === "user" || reason === "budget" ? (
				<div className="mete-chat-paused">
					<PausedRun
						reason={reason}
						blocked={facts.blocked ?? []}
						onResume={onResume}
					/>
				</div>
			) : null}
		</header>
	);
};

type Controls = {
	readonly run: RunFacts;
	readonly preferredModels?: Readonly<Record<string, string>> | undefined;
	readonly names: Readonly<Record<string, string>>;
	readonly windows: Windows;
	readonly waiting: Omit<WaitingControls, "onOpen">;
	readonly onOpenReport: (path: string) => void;
	readonly transcript: {
		readonly transcript?: Transcript | undefined;
		readonly failure?: DaemonFailure | undefined;
	};
	readonly markdown: MarkdownRenderer;
	readonly onReply?: (message: string) => Promise<string | undefined>;
	readonly tools?: ReactNode | undefined;
	readonly restore: RestoreControls;
	readonly threadHistory?: ReactNode;
	readonly replyReady?: boolean | undefined;
	readonly onDraftChange?: (() => void) | undefined;
	readonly conversationKey?: string | undefined;
	readonly messageDraft?: MessageDraft | undefined;
	readonly attachments?: ReactNode | undefined;
};

const Notices = ({
	view,
	controls,
	runFailed,
}: {
	readonly view: TeamView;
	readonly controls: Controls;
	readonly runFailed?: Parameters<typeof Failure>[0] | undefined;
}) => (
	<div className="mete-chat-notices">
		{controls.transcript.failure ? (
			<p role="alert">{failureText(controls.transcript.failure)}</p>
		) : null}
		<NowSlot
			view={view}
			names={controls.names}
			windows={controls.windows}
			waiting={{ ...controls.waiting, onOpen: controls.onOpenReport }}
		/>
		{runFailed ? <Failure {...runFailed} /> : null}
	</div>
);

const Diagnostics = ({
	model,
	controls,
	details,
	hero,
}: {
	readonly model: {
		readonly view: TeamView;
		readonly feed: readonly MeteEvent[];
	};
	readonly controls: Controls;
	readonly details: ReactNode;
	readonly hero: Hero;
}) => (
	<details className="mete-chat-details">
		<summary>
			{nls.localize("mete/chat/details", "Activity, model and checkpoints")}
		</summary>
		<Metrics hero={hero} />
		{details}
		<CheckpointList
			checkpoints={model.view.checkpoints}
			restore={controls.restore}
		/>
		<RunRail
			view={model.view}
			feed={model.feed}
			names={controls.names}
			markdown={controls.markdown}
			transcript={controls.transcript.transcript}
			status={controls.run.run?.status}
			onOpenReport={controls.onOpenReport}
		/>
	</details>
);

/** Single-agent work keeps the conversation central and diagnostics folded away. */
export const ChatBoard = ({
	model,
	controls,
	details,
	tools,
}: {
	readonly model: {
		readonly goal: string;
		readonly view: TeamView;
		readonly feed: readonly MeteEvent[];
		readonly answer?: string;
		readonly runFailed?: { readonly code: string; readonly message: string };
	};
	readonly controls: Controls;
	readonly details: ReactNode;
	readonly tools?: ReactNode | undefined;
}) => {
	if (!controls.onReply) return null;
	const steps =
		controls.transcript.transcript?.conversations[0]?.steps ??
		(model.answer ? [{ text: model.answer, toolCalls: [] }] : []);
	const hero = heroOf(controls.run, model.view);
	return (
		<div className="mete-chat-layout">
			<Header
				facts={controls.run}
				hero={hero}
				view={model.view}
				preferredModels={controls.preferredModels}
				onResume={controls.waiting.onResume}
			/>
			<Notices
				view={model.view}
				controls={controls}
				runFailed={model.runFailed}
			/>
			{controls.threadHistory}
			<Conversation
				goal={model.goal}
				status={controls.run.run?.status}
				steps={steps}
				markdown={controls.markdown}
				onReply={controls.onReply}
				replyReady={controls.replyReady}
				onDraftChange={controls.onDraftChange}
				conversationKey={controls.conversationKey}
				messageDraft={controls.messageDraft}
				attachments={controls.attachments}
				tools={tools ?? controls.tools}
				details={
					<Diagnostics
						model={model}
						controls={controls}
						details={details}
						hero={hero}
					/>
				}
			/>
		</div>
	);
};
