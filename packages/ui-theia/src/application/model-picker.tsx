import type { ModelInfo, ProviderState } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import {
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import {
	nextActive,
	type PickGroup,
	type PickList,
	pickList,
	startActive,
	valuesOf,
} from "./model-pick.js";
import { stateText } from "./quota-text.js";
import { Icon } from "./roster-look.js";

// The one picker of the three model fields (ADR-161), as the design set's ModelPicker board draws
// it: a combobox whose list opens below the field. It picks a row and reports typed text; each field
// keeps its own commit (ADR-161 (4)). Laid out by style/mete-picker.css.

export type PickerProps = {
	/** The field's id, for the caller's label. */
	readonly id: string;
	/** The list's name: the role and the field. */
	readonly label: string;
	readonly value: string;
	/** `providerId/modelId` of the models the role's chain offers, best first. */
	readonly models: readonly string[];
	readonly facts: readonly ModelInfo[];
	readonly states: readonly ProviderState[];
	readonly onChange: (text: string) => void;
	/** A row was picked: its `providerId/modelId`, or null for Let METE choose. */
	readonly onPick: (ref: string | null) => void;
	/** The caller's commit of typed text: the field was left, or Enter met no row. */
	readonly onCommit?: (() => void) | undefined;
};

export type OptionsProps = {
	readonly id: string;
	readonly list: PickList;
	readonly value: string;
	readonly query: string;
	readonly active: number | undefined;
	readonly onPick: (at: number) => void;
};

// The list keeps the field's focus, so a pick, a heading or its scroll bar does not leave the field.
const keep = (e: MouseEvent) => e.preventDefault();

const Option = ({
	at,
	selected,
	o,
	children,
}: {
	readonly at: number;
	readonly selected: boolean;
	readonly o: OptionsProps;
	readonly children: ReactNode;
}) => (
	// biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/useFocusableInteractive: the combobox pattern keeps the focus in the field, which holds the list's keys and names the active row by aria-activedescendant (ADR-161 (1)).
	<li
		id={`${o.id}-${at}`}
		className={`mete-picker-opt${at === o.active ? " active" : ""}`}
		// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: an option of the combobox's own list, as the board draws it.
		role="option"
		aria-selected={selected}
		onClick={() => o.onPick(at)}
	>
		{children}
	</li>
);

const Group = ({
	g,
	base,
	o,
}: {
	readonly g: PickGroup;
	readonly base: number;
	readonly o: OptionsProps;
}) => (
	<li role="presentation">
		<div className="mete-picker-head" aria-hidden="true">
			{g.providerId}
		</div>
		{g.state ? (
			<div className="mete-picker-state" aria-hidden="true">
				{stateText(g.state)}
			</div>
		) : null}
		{/* biome-ignore lint/a11y/useSemanticElements: a fieldset cannot sit in a listbox; a group of options is a ul here, as in the board. */}
		<ul role="group" aria-label={g.state ? stateText(g.state) : g.providerId}>
			{g.models.map((m, i) => (
				<Option
					key={m.ref}
					at={base + i}
					selected={m.ref === o.value.trim()}
					o={o}
				>
					<span className="mete-picker-row">
						<span className="mete-picker-id">{m.modelId}</span>
						{m.ref === o.value.trim() ? <Icon name="check" /> : null}
					</span>
					<span className="mete-picker-facts">
						{m.chips.map((c) => (
							<span key={c} className="mete-picker-chip">
								{c}
							</span>
						))}
					</span>
				</Option>
			))}
		</ul>
	</li>
);

const where = () =>
	nls.localize(
		"mete/picker/where",
		"Models come from the providers in Settings, Models and keys, where Test… lists an endpoint's models; the Quota chip says why a provider cannot serve.",
	);

const Nothing = ({ query }: { readonly query: string }) => (
	<li role="presentation">
		<p className="mete-picker-note" role="status">
			{`${
				query.trim()
					? nls.localize(
							"mete/picker/noMatch",
							"No model matches “{0}”.",
							query.trim(),
						)
					: nls.localize(
							"mete/picker/empty",
							"No model can serve this role now.",
						)
			} ${where()}`}
		</p>
	</li>
);

const Use = ({
	at,
	o,
	use,
}: {
	readonly at: number;
	readonly o: OptionsProps;
	readonly use: string;
}) => (
	<Option at={at} selected={false} o={o}>
		<span className="mete-picker-choose">
			{nls.localize("mete/picker/use", "Use “{0}”", use)}
		</span>
		<span className="mete-picker-hint">
			{nls.localize(
				"mete/picker/notListed",
				"Not listed for this role: it leads only if it can serve it",
			)}
		</span>
	</Option>
);

/** Let METE choose, the chain under a heading per provider, Use “…”, or why nothing is listed. */
export const PickOptions = (o: OptionsProps) => {
	let next = 1;
	const groups = o.list.groups.map((g) => {
		const base = next;
		next += g.models.length;
		return <Group key={g.providerId} g={g} base={base} o={o} />;
	});
	return (
		<>
			<Option at={0} selected={o.value.trim() === ""} o={o}>
				<span className="mete-picker-choose">
					{nls.localize("mete/run/choose", "Let METE choose")}
				</span>
			</Option>
			{groups}
			{o.list.use ? <Use at={next} o={o} use={o.list.use} /> : null}
			{next === 1 && !o.list.use ? <Nothing query={o.query} /> : null}
		</>
	);
};

type Open = { readonly query: string; readonly active: number | undefined };

const usePicker = (p: PickerProps, listId: string) => {
	const [open, setOpen] = useState<Open>();
	const list = pickList(p.models, p.facts, p.states, open?.query ?? "");
	const values = valuesOf(list);
	// `value` is the field's text now: while typing, the prop still holds the text before it.
	const show = (query: string, value: string) => {
		const shown = valuesOf(pickList(p.models, p.facts, p.states, query));
		setOpen({ query, active: startActive(shown, value, query) });
	};
	const pick = (at: number | undefined) => {
		setOpen(undefined);
		const v = at === undefined ? undefined : values[at];
		if (v === undefined) p.onCommit?.();
		else p.onPick(v);
	};
	const keys: Readonly<Record<string, () => void>> = open
		? { Escape: () => setOpen(undefined), Enter: () => pick(open.active) }
		: { ArrowDown: () => show("", p.value), Enter: () => p.onCommit?.() };
	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		const to = open ? nextActive(e.key, open.active, values.length) : undefined;
		const act =
			open && to !== undefined
				? () => setOpen({ ...open, active: to })
				: keys[e.key];
		if (!act) return;
		e.preventDefault();
		// An open list's keys are its own, not the panel's or a dialog's around it.
		if (open) e.stopPropagation();
		act();
	};
	const activeId =
		open?.active === undefined ? undefined : `${listId}-${open.active}`;
	return { open, list, show, pick, onKeyDown, activeId };
};

type Picker = ReturnType<typeof usePicker>;

const Field = ({
	p,
	s,
	listId,
}: {
	readonly p: PickerProps;
	readonly s: Picker;
	readonly listId: string;
}) => (
	<input
		id={p.id}
		className="mete-field mono mete-picker-field"
		role="combobox"
		aria-expanded={s.open !== undefined}
		aria-controls={listId}
		aria-autocomplete="list"
		aria-activedescendant={s.activeId}
		autoComplete="off"
		spellCheck={false}
		value={p.value}
		placeholder="providerId/modelId"
		onChange={(e) => {
			p.onChange(e.target.value);
			s.show(e.target.value, e.target.value);
		}}
		onKeyDown={s.onKeyDown}
		onClick={() => {
			if (!s.open) s.show("", p.value);
		}}
		onBlur={() => {
			if (s.open) s.pick(undefined);
			else p.onCommit?.();
		}}
	/>
);

/** A model field whose list opens below it and filters as the user types (ADR-161). */
export const ModelPicker = (p: PickerProps) => {
	const listId = useId();
	const listRef = useRef<HTMLUListElement>(null);
	const s = usePicker(p, listId);
	// Eight rows show, then the list scrolls; the active row stays in sight.
	useEffect(() => {
		if (s.activeId)
			listRef.current?.ownerDocument
				.getElementById(s.activeId)
				?.scrollIntoView({ block: "nearest" });
	}, [s.activeId]);
	return (
		<div className="mete-picker">
			<Field p={p} s={s} listId={listId} />
			<ul
				id={listId}
				ref={listRef}
				className="mete-picker-list"
				// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the combobox's own list, not a select (ADR-161 rejects the native one).
				role="listbox"
				aria-label={p.label}
				hidden={s.open === undefined}
				onMouseDown={keep}
			>
				<PickOptions
					id={listId}
					list={s.list}
					value={p.value}
					query={s.open?.query ?? ""}
					active={s.open?.active}
					onPick={s.pick}
				/>
			</ul>
		</div>
	);
};
