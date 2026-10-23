// The cozy office's own colours, from the approved demo (docs/prototypes/studio-view.html; ADR-070):
// the canvas looks the same in every Theia theme, and the design tokens colour the DOM around it.

/** The room: wall, floor, rug and the light from the window. */
export const ROOM = {
	wall: "#a8c8be",
	stripe: "rgba(255,255,255,.16)",
	trim: "#8f6c4b",
	trimDark: "#7a5a3d",
	floor: "#d9b48a",
	plankLight: "rgba(255,255,255,.05)",
	plankDark: "rgba(0,0,0,.035)",
	seam: "rgba(120,80,40,.2)",
	rugOuter: "#9a6b8e",
	rugInner: "#b07fa2",
	rugStitch: "rgba(255,240,220,.35)",
	beam: "rgba(255,246,214,.17)",
} as const;

/** The wall board and its notes. */
export const BOARD = {
	frame: "#8b6343",
	cork: "#d2a873",
	speck: "rgba(120,80,40,.2)",
	header: "rgba(255,255,255,.75)",
	ink: "#4a3a2c",
	divider: "rgba(90,60,30,.28)",
	shadow: "rgba(60,40,20,.18)",
	noteInk: "#3d3128",
	pin: "#d9544a",
	badge: "rgba(36,34,58,.82)",
	badgeInk: "#ffffff",
	notes: ["#ffe08a", "#ffc4d6", "#c9ebb8", "#b8c8ff"],
} as const;

/** The coffee corner. */
export const COFFEE = {
	counter: "#a9774e",
	top: "#c8966a",
	door: "rgba(0,0,0,.08)",
	knob: "#6b4a30",
	machine: "#3a3a44",
	panel: "#575a68",
	light: "#e05a4a",
	cup: "#f3efe8",
	jar: "#e8e2d6",
	lid: "#cfc7b8",
	sign: "#f3e7d3",
	signInk: "#5a4030",
} as const;

/** A desk with its chair, monitor and lamp. */
export const DESK = {
	shadow: "rgba(60,35,15,.16)",
	top: "#c8956a",
	edge: "#dcab80",
	front: "#a8744d",
	handle: "rgba(0,0,0,.14)",
	stand: "#3b3c48",
	bezel: "#2b2c37",
	screen: "#191b26",
	glare: "rgba(255,255,255,.06)",
	lamp: "#e9b949",
	mug: "#f3efe8",
	chair: "#454a5a",
	chairTop: "#5a6073",
} as const;

/** A character's state, until the characters of the theme are drawn. */
export const STATE = {
	idle: "#6b6785",
	thinking: "#5b4bd6",
	working: "#2fa38a",
	waiting: "#f0b75a",
	ink: "#3a2e24",
	label: "rgba(255,255,255,.86)",
} as const;

/** The colours effects are drawn in. */
export const EFFECT = {
	good: "#2fa38a",
	accent: "#5b4bd6",
	warn: "#e3a13a",
	bad: "#d9544a",
} as const;
