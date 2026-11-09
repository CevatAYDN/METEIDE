import { nls } from "@theia/core/lib/common/nls";
import { z } from "zod";
import { PolicyDenyField } from "./policy-deny-field.js";
import { PolicyListField } from "./policy-list-field.js";
import { PolicyOverridesField } from "./policy-overrides-field.js";
import { readPolicyRule } from "./policy-rule-fields.js";
import type { Draft, FieldValue } from "./section-draft.js";

type Props = {
	readonly state: {
		readonly values: Draft;
		readonly defaults: Draft;
		readonly inherited?: Draft;
		readonly readValid: boolean;
		readonly busy: boolean;
		readonly dirty: boolean;
		readonly note?: { readonly kind: "saved" | "refused" } | undefined;
	};
	readonly onField: (key: string, value: FieldValue) => void;
};
const level = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
// Empty patterns are in-memory form drafts only; strict readPolicyRule still gates every save.
const denyDraft = z
	.array(
		z.union([
			z.strictObject({
				action: z.enum(["fs.write", "fs.delete", "fs.write.outside"]),
				path: z.string(),
			}),
			z.strictObject({ action: z.literal("shell.exec"), command: z.string() }),
		]),
	)
	.readonly()
	.optional();

const Unavailable = () => (
	<p role="alert">
		{nls.localize(
			"mete/permissions/unavailable",
			"Rules are unavailable. Refresh or open the source file.",
		)}
	</p>
);

const List = ({
	state,
	onField,
	field,
}: Props & {
	readonly field: "always_ask" | "shell.allow" | "shell.always";
}) => {
	const value = readPolicyRule(field, state.values[field]);
	const inherited = readPolicyRule(field, state.defaults[field]);
	if (!value.ok || !inherited.ok || inherited.value === undefined)
		return <Unavailable />;
	return (
		<PolicyListField
			field={field}
			value={value.value}
			inherited={inherited.value}
			disabled={state.busy}
			onChange={(next) => onField(field, next)}
		/>
	);
};

const Deny = ({ state, onField }: Props) => {
	const value = denyDraft.safeParse(state.values.never_allow);
	const inherited = readPolicyRule("never_allow", state.defaults.never_allow);
	if (!value.success || !inherited.ok || inherited.value === undefined)
		return <Unavailable />;
	return (
		<PolicyDenyField
			value={value.data}
			inherited={inherited.value}
			disabled={state.busy}
			onChange={(next) => onField("never_allow", next)}
			onDraft={(next) => onField("never_allow", next)}
		/>
	);
};

const Overrides = ({ state, onField }: Props) => {
	const value = readPolicyRule("overrides", state.values.overrides);
	const source =
		state.values.overrides === undefined
			? state.defaults.overrides
			: (state.inherited?.overrides ?? {});
	const inherited = readPolicyRule("overrides", source);
	const autonomy = level.safeParse(
		state.values.autonomy ?? state.defaults.autonomy,
	);
	if (
		!value.ok ||
		!inherited.ok ||
		inherited.value === undefined ||
		!autonomy.success
	)
		return <Unavailable />;
	return (
		<PolicyOverridesField
			value={value.value}
			inherited={inherited.value}
			autonomy={autonomy.data}
			disabled={state.busy}
			onChange={(next) => onField("overrides", next)}
		/>
	);
};

/** Structured editors for existing policy rules; never a live permission verdict. */
export const PolicyFields = (props: Props) => {
	if (props.state.readValid !== true) return <Unavailable />;
	return (
		<div className="mete-policy-rules">
			{(props.state.values.autonomy ?? props.state.defaults.autonomy) === 3 ? (
				<p role="status">
					{nls.localize(
						"mete/permissions/fullAutonomy",
						"Actions at full autonomy bypass ask-first rules; lower capability overrides still apply.",
					)}
				</p>
			) : null}
			<List {...props} field="always_ask" />
			<List {...props} field="shell.allow" />
			<List {...props} field="shell.always" />
			<details>
				<summary>
					{nls.localize("mete/permissions/advanced", "Advanced rules")}
				</summary>
				<div className="mete-policy-advanced">
					<Deny {...props} />
					<Overrides {...props} />
				</div>
			</details>
		</div>
	);
};
