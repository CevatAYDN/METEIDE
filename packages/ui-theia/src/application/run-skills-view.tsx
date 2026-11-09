import type { SkillContextSummary } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { RunSkillsState } from "./run-skills.js";
import { Button } from "./runs-list.js";
import { skillScopeText } from "./skill-text.js";

type Props = {
	readonly state: RunSkillsState;
	readonly onRetry: () => void;
	readonly onExpand: (contextId: string) => void;
};

const statusText = (status: SkillContextSummary["status"]) =>
	({
		selected: () => nls.localize("mete/runSkills/selected", "Selected"),
		loaded: () => nls.localize("mete/runSkills/loaded", "Loaded"),
		blocked: () => nls.localize("mete/runSkills/blocked", "Blocked"),
		history: () => nls.localize("mete/runSkills/history", "Earlier context"),
	})[status]();

const blockText = (code: string) =>
	nls.localize("mete/runSkills/blockCode", "Blocked: {0}", code);

const Context = ({
	context,
	state,
	onExpand,
}: {
	readonly context: SkillContextSummary;
	readonly state: RunSkillsState;
	readonly onExpand: Props["onExpand"];
}) => {
	const id = context.owner.contextId;
	const detail =
		state.detail?.context.owner.contextId === id ? state.detail : undefined;
	return (
		<li data-context-id={id}>
			<strong>{`${context.roleId} · ${statusText(context.status)}`}</strong>
			{context.block ? (
				<p role="alert">{blockText(context.block.code)}</p>
			) : null}
			<ul>
				{context.loaded.map((m) => (
					<li key={m.receiptId}>
						{`${m.name} (${skillScopeText(m.source.scope)} · ${m.source.path} · r${m.version.revision})`}
					</li>
				))}
			</ul>
			{context.loaded.length ? (
				<details onToggle={(e) => e.currentTarget.open && onExpand(id)}>
					<summary>
						{nls.localize("mete/runSkills/show", "Show retained text")}
					</summary>
					{state.detailFailed === id ? (
						<p role="alert">
							{nls.localize(
								"mete/runSkills/detailFailed",
								"Could not read the retained text.",
							)}
						</p>
					) : null}
					{detail?.snapshots.map((s) => (
						<pre key={s.receiptId}>{s.inspection.text}</pre>
					))}
				</details>
			) : null}
		</li>
	);
};

/** Selection is not load, and load is not proof that a model used or followed a skill. */
export const RunSkills = (props: Props) => {
	const { state } = props;
	if (state.phase === "idle" || state.phase === "loading") return null;
	if (state.phase === "failed")
		return (
			<div>
				<p role="alert">
					{nls.localize(
						"mete/runSkills/readFailed",
						"Could not read this run's skills. Retry the read.",
					)}
				</p>
				<Button
					label={nls.localize("mete/thread/retry", "Retry")}
					icon="refresh"
					quiet
					onClick={props.onRetry}
				/>
			</div>
		);
	const result = state.result;
	if (!result || result.kind === "legacy") return null;
	if (!result.contexts.length && !result.block) return null;
	return (
		<details className="mete-chat-details">
			<summary>
				{nls.localize("mete/runSkills/title", "Skills in this run")}
			</summary>
			<p className="mete-composer-hint">
				{nls.localize(
					"mete/runSkills/notProof",
					"Loaded means METE kept this exact version for the context. It does not prove the model followed it.",
				)}
			</p>
			{result.block ? <p role="alert">{blockText(result.block.code)}</p> : null}
			<ul>
				{result.contexts.map((c) => (
					<Context
						key={c.owner.contextId}
						context={c}
						state={state}
						onExpand={props.onExpand}
					/>
				))}
			</ul>
		</details>
	);
};
