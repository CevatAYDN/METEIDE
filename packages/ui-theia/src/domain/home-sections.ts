import { type HomeModel, waitingCount } from "./home-model.js";

// The METE view's sections (docs/13, Home; ADR-078) and what each one counts in its title
// (ADR-109). The sections are the view's own identity, so they live here, away from Theia; the
// labels, which are text, stay in the widget.

/** The sections, in the order the METE view stacks them. */
export const HOME_SECTIONS = [
	"waiting",
	"runs",
	"workspaces",
	"quota",
] as const;

/** One section of the METE view. */
export type HomeSection = (typeof HOME_SECTIONS)[number];

/** The widget id of a section. */
export const sectionId = (section: HomeSection) => `mete.home.${section}`;

/**
 * What a section's title counts, or `undefined` while it cannot count: the runs that wait for the
 * human, every run, the folders opened before. Quota counts nothing; its card speaks for itself.
 */
export const sectionCount = (
	section: HomeSection,
	model: HomeModel,
	workspaces: number,
): number | undefined => {
	switch (section) {
		case "waiting":
			return model.kind === "runs" ? waitingCount(model) : undefined;
		case "runs":
			return model.kind === "runs" ? model.rows.length : undefined;
		case "workspaces":
			return workspaces;
		case "quota":
			return undefined;
	}
};
