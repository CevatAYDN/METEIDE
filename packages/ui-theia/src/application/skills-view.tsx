import type { SkillDiagnostic, SkillTrustEntry } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { Icon } from "./roster-look.js";
import {
	canDisableSkill,
	canEditSkill,
	type SkillState,
	type SkillsViewModel,
} from "./skill-session.js";
import {
	skillIssueText,
	skillScopeText,
	skillStatusText,
} from "./skill-text.js";

const diagnosticKey = (item: SkillDiagnostic) =>
	JSON.stringify([item.sourceId ?? null, item.code, item.location ?? null]);
const uniqueDiagnostics = (items: readonly SkillDiagnostic[]) => [
	...new Map(items.map((item) => [diagnosticKey(item), item])).entries(),
];

const Diagnostics = ({
	items,
}: {
	readonly items: readonly SkillDiagnostic[];
}) => (
	<ul className="mete-skills-diagnostics">
		{uniqueDiagnostics(items).map(([key, item]) => (
			<li key={key}>
				{skillIssueText(item)}
				{item.location ? <code>{item.location}</code> : null}
				{item.sourceId ? <code>{item.sourceId}</code> : null}
			</li>
		))}
	</ul>
);
const sessionReady = (state: SkillState) =>
	state.phase === "ready" && state.inventory !== undefined && !state.busy;
const interactive = (state: SkillState) =>
	sessionReady(state) && state.inventory?.complete === true;
const emptyInventory = (state: SkillState) =>
	state.phase === "ready" &&
	state.inventory?.complete === true &&
	state.inventory.entries.length === 0 &&
	state.inventory.diagnostics.length === 0;

const SkillRow = ({
	entry,
	model,
}: {
	readonly entry: SkillTrustEntry;
	readonly model: SkillsViewModel;
}) => (
	<li className="mete-skills-row" data-skill-source={entry.source.sourceId}>
		<div className="mete-skills-row-head">
			<strong>{entry.metadata?.name ?? entry.source.path}</strong>
			<span>{skillStatusText(entry.status)}</span>
			<div className="mete-skills-actions">
				{model.onEdit ? (
					<button
						type="button"
						className="mete-button quiet"
						disabled={!interactive(model.state) || !canEditSkill(entry)}
						onClick={() => void model.onEdit?.(entry)}
					>
						<Icon name="edit" />
						{nls.localize("mete/skills/edit", "Edit SKILL.md")}
					</button>
				) : null}
				<button
					type="button"
					className="mete-button quiet"
					disabled={
						!interactive(model.state) ||
						!entry.metadata ||
						["invalid", "missing", "unavailable"].includes(entry.status)
					}
					onClick={() => void model.onReview(entry)}
				>
					<Icon name="inspect" />
					{nls.localize("mete/skills/review", "Review")}
				</button>
				{canDisableSkill(entry) ? (
					<button
						type="button"
						className="mete-button quiet"
						disabled={!sessionReady(model.state)}
						onClick={() => void model.onDisable(entry)}
					>
						<Icon name="circle-slash" />
						{nls.localize("mete/skills/disable", "Disable")}
					</button>
				) : null}
			</div>
		</div>
		<div className="mete-skills-source">
			<span>{skillScopeText(entry.source.scope)}</span>
			<code>{entry.source.path}</code>
		</div>
		{entry.metadata ? <p>{entry.metadata.description}</p> : null}
		<Diagnostics items={entry.diagnostics} />
	</li>
);

const Preview = ({ model }: { readonly model: SkillsViewModel }) => {
	const preview = model.state.preview;
	if (!preview) return null;
	const { inspection } = preview;
	return (
		<section
			className="mete-skills-preview"
			aria-label={nls.localize("mete/skills/review", "Review")}
		>
			<div className="mete-skills-source">
				<span>{skillScopeText(inspection.source.scope)}</span>
				<code>{inspection.source.path}</code>
			</div>
			<dl>
				<dt>{nls.localize("mete/skills/rawHash", "Raw file SHA-256")}</dt>
				<dd>
					<code>{inspection.sha256}</code>
				</dd>
				<dt>{nls.localize("mete/skills/expires", "Expires")}</dt>
				<dd>{new Date(preview.expiresAt).toLocaleString()}</dd>
				{inspection.metadata.license ? (
					<>
						<dt>{nls.localize("mete/skills/license", "License")}</dt>
						<dd>{inspection.metadata.license}</dd>
					</>
				) : null}
				{inspection.metadata.compatibility ? (
					<>
						<dt>
							{nls.localize("mete/skills/compatibility", "Compatibility")}
						</dt>
						<dd>{inspection.metadata.compatibility}</dd>
					</>
				) : null}
				{inspection.metadata["allowed-tools"] ? (
					<>
						<dt>
							{nls.localize(
								"mete/skills/unsupportedTools",
								"Tool permissions (unsupported)",
							)}
						</dt>
						<dd>{inspection.metadata["allowed-tools"]}</dd>
					</>
				) : null}
			</dl>
			<textarea
				className="mete-skills-text"
				aria-label={nls.localize("mete/skills/maskedText", "Masked SKILL.md")}
				readOnly
				value={inspection.text}
			/>
			<div className="mete-skills-actions">
				<button
					type="button"
					className="mete-button"
					disabled={
						!interactive(model.state) ||
						Date.now() >= Date.parse(preview.expiresAt)
					}
					onClick={() => void model.onApprove()}
				>
					<Icon name="check" />
					{nls.localize("mete/skills/approve", "Approve")}
				</button>
				<button
					type="button"
					className="mete-button quiet"
					disabled={model.state.busy}
					onClick={model.onDismiss}
				>
					<Icon name="close" />
					{nls.localize("mete/skills/dismiss", "Close review")}
				</button>
			</div>
		</section>
	);
};

const StateNote = ({ state }: { readonly state: SkillState }) => (
	<>
		{state.phase === "loading" ? (
			<p role="status">
				{nls.localize("mete/skills/loading", "Discovering skills...")}
			</p>
		) : null}
		{state.busy ? (
			<p role="status">{nls.localize("mete/skills/working", "Working...")}</p>
		) : null}
		{state.phase === "recovery" ? (
			<p role="alert">
				{nls.localize(
					"mete/skills/recovery",
					"Outcome uncertain. Recover this session and refresh; the decision will not be replayed.",
				)}
			</p>
		) : null}
		{state.error ? <p role="alert">{skillIssueText(state.error)}</p> : null}
		{state.inventory && state.phase !== "ready" ? (
			<p>
				{nls.localize(
					"mete/skills/previous",
					"Previously read inventory; it may be out of date.",
				)}
			</p>
		) : null}
		{state.inventory?.complete === false ? (
			<p role="alert">
				{nls.localize(
					"mete/skills/incomplete",
					"Discovery is incomplete. Approval is unavailable.",
				)}
			</p>
		) : null}
		{emptyInventory(state) ? (
			<p role="status">
				{nls.localize("mete/skills/empty", "No skills found.")}
			</p>
		) : null}
	</>
);

/** Compact source-qualified management; full previews remain escaped plaintext. */
export const SkillsView = ({ model }: { readonly model: SkillsViewModel }) => {
	const { state } = model;
	const refresh = nls.localize("mete/skills/refresh", "Refresh skills");
	return (
		<section
			className="mete-skills"
			aria-label={nls.localize("mete/groups/skills", "Skills")}
			aria-busy={state.busy || state.phase === "loading"}
		>
			<div className="mete-settings-head">
				<h3>{nls.localize("mete/groups/skills", "Skills")}</h3>
				<button
					type="button"
					className="mete-button quiet icon"
					aria-label={refresh}
					title={refresh}
					disabled={
						state.busy ||
						state.phase === "loading" ||
						state.phase === "recovery"
					}
					onClick={() => void model.onRefresh()}
				>
					<Icon name="refresh" spin={state.phase === "loading"} />
				</button>
			</div>
			{state.phase === "idle" ? (
				<button
					type="button"
					className="mete-button"
					onClick={() => void model.onRefresh()}
				>
					<Icon name="search" />
					{nls.localize("mete/skills/discover", "Discover")}
				</button>
			) : null}
			<StateNote state={state} />
			{state.phase === "recovery" ? (
				<button
					type="button"
					className="mete-button quiet"
					disabled={state.busy}
					onClick={() => void model.onRecover()}
				>
					<Icon name="debug-restart" />
					{nls.localize("mete/skills/recover", "Recover and refresh")}
				</button>
			) : null}
			<Diagnostics items={state.inventory?.diagnostics ?? []} />
			<ul className="mete-skills-list">
				{state.inventory?.entries.map((entry) => (
					<SkillRow key={entry.source.sourceId} entry={entry} model={model} />
				))}
			</ul>
			<Preview model={model} />
		</section>
	);
};
