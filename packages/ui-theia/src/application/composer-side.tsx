import { nls } from "@theia/core/lib/common/nls";
import { useId } from "react";
import type { ComposerOption } from "./composer.js";
import { Icon } from "./roster-look.js";

// The composer's side column in the Composer board's look (ADR-128): the chosen option's preferred
// models (ADR-122), the folder's uncommitted changes for a team (ADR-156), and Start. Laid out by
// style/mete-composer.css.

const prefer = () =>
	nls.localize("mete/run/preferModel", "Preferred model (optional)");

type Choice = {
	readonly key: string;
	readonly label: string;
	readonly value: string | undefined;
	readonly models: readonly string[];
	readonly onChange: (value: string) => void;
};

const ModelChoice = ({ choice }: { readonly choice: Choice }) => {
	const list = useId();
	return (
		<label className="mete-composer-model">
			<span>{choice.label}</span>
			<input
				className="mete-field"
				list={list}
				value={choice.value ?? ""}
				placeholder="providerId/modelId"
				aria-label={`${choice.label} · ${prefer()}`}
				onChange={(e) => choice.onChange(e.target.value)}
			/>
			<datalist id={list}>
				{choice.models.map((m) => (
					<option key={m} value={m} />
				))}
			</datalist>
		</label>
	);
};

type SideProps = {
	readonly chosen: ComposerOption | undefined;
	readonly singleModel?: string | undefined;
	readonly roleModels?: Readonly<Record<string, string>> | undefined;
	readonly onSingleModel?: ((model: string) => void) | undefined;
	readonly onRoleModel?: ((roleId: string, model: string) => void) | undefined;
	/** The folder's uncommitted changes (ADR-156). */
	readonly uncommitted: number | undefined;
	readonly ready: boolean;
	readonly busy: boolean;
	readonly error?: string | undefined;
	readonly onStart: () => void;
};

// The single agent's one model, or a field per team role; the router's choice has none.
const choicesOf = (p: SideProps): readonly Choice[] => {
	const { chosen } = p;
	if (!chosen || chosen.templateId === undefined) return [];
	if (chosen.templateId === null)
		return [
			{
				key: "single",
				label: chosen.label,
				value: p.singleModel,
				models: chosen.models ?? [],
				onChange: (v) => p.onSingleModel?.(v),
			},
		];
	return (chosen.roles ?? []).map((r) => ({
		key: r.id,
		label: r.name || r.id,
		value: p.roleModels?.[r.id],
		models: r.models ?? [],
		onChange: (v) => p.onRoleModel?.(r.id, v),
	}));
};

const Preferences = ({ choices }: { readonly choices: readonly Choice[] }) =>
	choices.length === 0 ? null : (
		<div className="mete-composer-prefer">
			<h3>{prefer()}</h3>
			<p className="mete-composer-hint">providerId/modelId</p>
			{choices.map((c) => (
				<ModelChoice key={c.key} choice={c} />
			))}
		</div>
	);

// A team works in worktrees cut at the last commit (docs/10), so the folder's own edits are not in
// them; the single agent works in the folder itself and needs no line (ADR-156).
const Uncommitted = ({ chosen, uncommitted: count }: SideProps) => {
	if (!count || !chosen || chosen.templateId === null) return null;
	const has =
		count === 1
			? nls.localize(
					"mete/run/uncommittedOne",
					"This folder has 1 uncommitted change.",
				)
			: nls.localize(
					"mete/run/uncommitted",
					"This folder has {0} uncommitted changes.",
					count,
				);
	const why = nls.localize(
		"mete/run/uncommittedWhy",
		"A team starts from the last commit, so its members do not see them; commit them first if the team needs them.",
	);
	return <p className="mete-composer-uncommitted">{`${has} ${why}`}</p>;
};

/** The chosen option's preferred models, the uncommitted line and Start, beside the teams. */
export const Side = (props: SideProps) => (
	<aside className="mete-composer-side">
		<Preferences choices={choicesOf(props)} />
		<Uncommitted {...props} />
		<button
			type="button"
			className="mete-button mete-composer-start"
			disabled={!props.ready}
			onClick={props.onStart}
		>
			<Icon name="play" />
			{nls.localize("mete/run/start", "Start run")}
		</button>
		{props.busy ? (
			<p className="mete-composer-hint" role="status">
				{nls.localize("mete/run/starting", "METE is starting the run…")}
			</p>
		) : null}
		{props.error ? <p role="alert">{props.error}</p> : null}
	</aside>
);
