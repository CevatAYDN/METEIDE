import { nls } from "@theia/core/lib/common/nls";
import type { KeyboardEvent, ReactNode } from "react";

/** The selected member's form section (ADR-192). */
export type MemberSection = "member" | "tasks";

const sectionKey = (
	section: MemberSection,
	key: string,
): MemberSection | undefined => {
	if (key === "Home") return "member";
	if (key === "End") return "tasks";
	if (key === "ArrowLeft" || key === "ArrowRight")
		return section === "member" ? "tasks" : "member";
	return undefined;
};

type SectionProps = {
	readonly id: string;
	readonly selected: MemberSection;
	readonly onSelect: (section: MemberSection) => void;
	readonly member: ReactNode;
	readonly tasks: ReactNode;
};

const sectionKeyboard =
	(props: SectionProps, section: MemberSection) =>
	(event: KeyboardEvent<HTMLButtonElement>) => {
		const next = sectionKey(section, event.key);
		if (!next) return;
		event.preventDefault();
		event.stopPropagation();
		props.onSelect(next);
		event.currentTarget.parentElement
			?.querySelector<HTMLButtonElement>(`[data-member-section="${next}"]`)
			?.focus();
	};

const sectionTabs = (props: SectionProps) => (
	<div
		className="mete-member-tabs"
		role="tablist"
		aria-label={nls.localize("mete/team/memberSections", "Member sections")}
	>
		{(["member", "tasks"] as const).map((section) => (
			<button
				key={section}
				type="button"
				id={`${props.id}-${section}-tab`}
				role="tab"
				aria-controls={`${props.id}-${section}-panel`}
				aria-selected={props.selected === section}
				tabIndex={props.selected === section ? 0 : -1}
				data-member-section={section}
				onClick={() => props.onSelect(section)}
				onKeyDown={sectionKeyboard(props, section)}
			>
				{section === "member"
					? nls.localize("mete/team/memberTab", "Member")
					: nls.localize("mete/team/tasksTab", "Tasks")}
			</button>
		))}
	</div>
);

/** Selected-member tabs retain both panel subtrees so local field drafts survive switching. */
export const MemberSections = (props: SectionProps) => (
	<>
		{sectionTabs(props)}
		{(["member", "tasks"] as const).map((section) => (
			<div
				key={section}
				className="mete-member-panel"
				id={`${props.id}-${section}-panel`}
				role="tabpanel"
				aria-labelledby={`${props.id}-${section}-tab`}
				hidden={props.selected !== section}
			>
				{props[section]}
			</div>
		))}
	</>
);
