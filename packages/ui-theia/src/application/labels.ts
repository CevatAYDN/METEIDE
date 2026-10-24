import { nls } from "@theia/core/lib/common/nls";

// The words of a setting's choice (ADR-082, ADR-094): the value a file holds, in plain words.

const OPTIONS: Readonly<Record<string, () => string>> = {
	free: () => nls.localize("mete/settings/free", "Free models only"),
	paid: () => nls.localize("mete/settings/paid", "Paid models only"),
	both: () => nls.localize("mete/settings/both", "Free first, then paid"),
	"0": () => nls.localize("mete/settings/level0", "0: suggest only"),
	"1": () => nls.localize("mete/settings/level1", "1: approve each step"),
	"2": () => nls.localize("mete/settings/level2", "2: approve risky actions"),
	"3": () => nls.localize("mete/settings/level3", "3: full autonomy"),
	true: () => nls.localize("mete/settings/yes", "Yes"),
	false: () => nls.localize("mete/settings/no", "No"),
	powershell: () =>
		nls.localize("mete/settings/powershell", "Windows PowerShell"),
	"git-bash": () => nls.localize("mete/settings/gitBash", "Git Bash"),
};

/** A choice's value as its label; a value with no label shows as it is. */
export const optionLabel = (v: string | number | boolean | undefined) =>
	OPTIONS[String(v)]?.() ?? String(v);
