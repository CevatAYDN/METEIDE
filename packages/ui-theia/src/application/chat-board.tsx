import type { MeteEvent, Transcript } from "@mete/contracts";
import type { TeamView } from "@mete/ui-studio";
import type { MarkdownRenderer } from "@theia/core/lib/browser/markdown-rendering/markdown-renderer";
import { nls } from "@theia/core/lib/common/nls";
import type { ReactNode } from "react";
import type { DaemonFailure } from "../domain/status-service.js";
import type { RestoreControls } from "./checkpoint-list.js";
import { CheckpointList } from "./checkpoint-list.js";
import type { Windows } from "./context-meter.js";
import { Conversation } from "./conversation-view.js";
import { NowSlot } from "./now-slot.js";
import type { RunFacts } from "./run-hero.js";
import { RunHero } from "./run-hero-view.js";
import { RunRail } from "./run-rail.js";
import { Failure } from "./single-agent.js";
import { failureText } from "./status-text.js";
import type { WaitingControls } from "./waiting-strip.js";

/** Single-agent work keeps the conversation central and diagnostics folded away. */
export const ChatBoard = ({
	model,
	controls,
	details,
}: {
	readonly model: {
		readonly goal: string;
		readonly view: TeamView;
		readonly feed: readonly MeteEvent[];
		readonly answer?: string;
		readonly runFailed?: { readonly code: string; readonly message: string };
	};
	readonly controls: {
		readonly run: RunFacts;
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
		readonly restore: RestoreControls;
	};
	readonly details: ReactNode;
}) => {
	if (!controls.onReply) return null;
	const steps =
		controls.transcript.transcript?.conversations[0]?.steps ??
		(model.answer ? [{ text: model.answer, toolCalls: [] }] : []);
	return (
		<div className="mete-chat-layout">
			{controls.transcript.failure ? (
				<p role="alert">{failureText(controls.transcript.failure)}</p>
			) : null}
			<RunHero
				goal={model.goal}
				facts={controls.run}
				view={model.view}
				names={controls.names}
				onResume={controls.waiting.onResume}
			/>
			<NowSlot
				view={model.view}
				names={controls.names}
				windows={controls.windows}
				waiting={{ ...controls.waiting, onOpen: controls.onOpenReport }}
			/>
			{model.runFailed ? <Failure {...model.runFailed} /> : null}
			<Conversation
				goal={model.goal}
				status={controls.run.run?.status}
				steps={steps}
				markdown={controls.markdown}
				onReply={controls.onReply}
			/>
			<details className="mete-chat-details">
				<summary>
					{nls.localize("mete/chat/details", "Activity, model and checkpoints")}
				</summary>
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
		</div>
	);
};
