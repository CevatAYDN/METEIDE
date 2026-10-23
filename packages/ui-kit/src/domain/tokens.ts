// The METE design tokens of docs/13 (Design system), from the approved demo: one colour set for a
// light theme and one for a dark theme, and the shape of controls, panels and the studio stage. A
// panel sets them as CSS custom properties on its own root, so they never leak into Theia's.

/** The colour tokens, by their CSS names without the leading `--`. */
export const TOKEN_NAMES = [
	"bg",
	"panel",
	"line",
	"ink",
	"muted",
	"accent",
	"good",
	"warn",
	"bad",
	"chip",
] as const;

/** One colour token. */
export type TokenName = (typeof TOKEN_NAMES)[number];

/** Which colour set a panel uses: it follows the editor's theme. */
export type TokenMode = "light" | "dark";

/** The colours of docs/13's token table. */
export const TOKENS: Readonly<
	Record<TokenMode, Readonly<Record<TokenName, string>>>
> = {
	light: {
		bg: "#ECEAF4",
		panel: "#F8F7FC",
		line: "#DAD6EA",
		ink: "#24223A",
		muted: "#6B6785",
		accent: "#5B4BD6",
		good: "#2FA38A",
		warn: "#E3A13A",
		bad: "#D9544A",
		chip: "#E4E0F3",
	},
	dark: {
		bg: "#17162A",
		panel: "#211F38",
		line: "#34315A",
		ink: "#ECEAF7",
		muted: "#A6A2C4",
		accent: "#8F83F2",
		good: "#4CC3A6",
		warn: "#F0B75A",
		bad: "#EE7368",
		chip: "#2D2A4D",
	},
};

/** docs/13 Shape: 1.5 px borders; radius 10 px for controls, 14 to 16 px for panels, 20 px for the stage. */
export const SHAPE = {
	border: "1.5px",
	controlRadius: "10px",
	panelRadius: "14px",
	stageRadius: "20px",
} as const;

/** The CSS custom properties of one colour set, such as `--bg`, for a panel's root style. */
export const tokenProperties = (
	mode: TokenMode,
): Record<`--${TokenName}`, string> =>
	Object.fromEntries(
		TOKEN_NAMES.map((name) => [`--${name}`, TOKENS[mode][name]]),
	) as Record<`--${TokenName}`, string>;
