// The cozy office's own colours, from the approved demo (docs/prototypes/studio-view.html; ADR-070):
// the canvas looks the same in every Theia theme, and the design tokens colour the DOM around it.

/** The room: wall, floor, rug and the light from the window. */
export const ROOM = {
	// The shade over the room while the run waits for the network (docs/13).
	offlineShade: "rgba(0,0,0,.3)",
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
	// The slab on the panel (ADR-165): a clear frame, the floor's front edge and its soft shadow.
	frame: "rgba(0,0,0,0)",
	edge: "#b48a5e",
	edgeLine: "rgba(90,60,30,.28)",
	shadow: "rgba(60,40,20,.08)",
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
	pinMark: "#ffffff",
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

/** A name pill: its fill and ink. */
export const STATE = {
	ink: "#3a2e24",
	label: "rgba(255,255,255,.86)",
} as const;

/**
 * The people of the demo's six roles: body, hair and skin colours (hair and skin as the demo pairs
 * them) and accessories, which a role's id picks from (ADR-070); and the parts all of them share.
 */
export const PEOPLE = {
	bodies: ["#8a6fd6", "#e07a5f", "#3f5f8c", "#2f8f7b", "#e2a33b", "#6d8f3c"],
	hairs: ["#3b2a20", "#6b3416", "#1f1b18", "#2a211b", "#b5452f", "#4a3626"],
	skins: ["#f2c9a5", "#e8b48f", "#d9a27a", "#f0c39c", "#f5d0b0", "#c98e66"],
	accessories: ["pencil", "clip", "glasses", "hood", "beret", "headset"],
	legs: "#33323f",
	shadow: "rgba(60,35,15,.2)",
	collar: "rgba(255,255,255,.35)",
	eye: "#2b2420",
	cheek: "rgba(240,120,110,.35)",
	mouth: "#5a3a2c",
	glasses: "#22202a",
	beret: "#c0392b",
	headset: "#2c2c36",
	pencil: "#f2c14e",
	pencilTip: "#e8846b",
	clipBoard: "#8b6343",
	clipPaper: "#fbf8f1",
} as const;

/** The marks over a character: its state's icon and the count of a group. */
export const MARK = {
	badge: "#5b4bd6",
	badgeInk: "#ffffff",
	dots: "#6b6785",
	bubble: "#ffffff",
	bubbleEdge: "rgba(60,40,20,.2)",
	clock: "#f0b75a",
	clockHand: "#5a3d10",
	spinner: "rgba(47,163,138,.95)",
} as const;

/** The colours effects are drawn in. */
export const EFFECT = {
	good: "#2fa38a",
	accent: "#5b4bd6",
	warn: "#e3a13a",
	bad: "#d9544a",
} as const;

/** The window: its frame and sill, and the sky and skyline as colour triples that mix with the time of day. */
export const WINDOW = {
	frame: "#7b5a3d",
	sill: "#8e6a48",
	pot: "#c26a4a",
	sprout: "#5d9a66",
	// Top and bottom of the sky by day (d), at night (n) and at sunrise and sunset (w).
	skyDayTop: [126, 190, 236],
	skyDayBottom: [214, 238, 250],
	skyNightTop: [16, 22, 56],
	skyNightBottom: [44, 56, 104],
	skyWarmTop: [236, 130, 92],
	skyWarmBottom: [255, 206, 150],
	buildingDay: [96, 124, 142],
	buildingNight: [22, 28, 56],
	cloud: [255, 255, 255],
	cloudWarm: [255, 214, 190],
	sun: [255, 238, 178],
	moon: [246, 243, 226],
	star: [255, 255, 240],
	lit: [255, 214, 120],
} as const;

/** The wall clock. */
export const CLOCK = {
	rim: "#7b5a3d",
	face: "#fbf8f1",
	tick: "#b7a99a",
	hand: "#3a2e24",
	pin: "#d9544a",
} as const;

/** The Vault shelf and its books. */
export const SHELF = {
	frame: "#8b5e3c",
	inner: "#6b4730",
	sign: "#f3e7d3",
	signInk: "#5a4030",
	spine: "rgba(255,255,255,.35)",
	books: [
		"#c0504d",
		"#4f81bd",
		"#9bbb59",
		"#8064a2",
		"#f79646",
		"#4bacc6",
		"#d9a441",
		"#6a8caf",
	],
} as const;

/** A potted plant. */
export const PLANT = {
	pot: "#c26a4a",
	rim: "#d77d5b",
	leafLight: "#4f8f5b",
	leafDark: "#3f7a4c",
} as const;

/** What a monitor shows while its character works: code, a results page, a painting or test rows. */
export const SCREEN = {
	codeBg: "#1d2130",
	codeLines: ["#7cc4ff", "#c792ea", "#ffcb6b", "#9ece6a", "#f78c6c"],
	pageBg: "#ffffff",
	pageBar: "#e8e4f2",
	pageGlass: "#6b6785",
	pageLink: "#5b7fd6",
	pageText: "#b9b4c7",
	paintBg: "#fbf7ef",
	paintArt: "#6cc58a",
	paintShine: "rgba(255,255,255,.35)",
	testPending: "#565c74",
	testText: "#4a5068",
	sleepDot: "rgba(150,170,255,.6)",
	offlineBg: "#2a2d3a",
	offlineIcon: "#8a90a8",
	offlineSlash: "#d9544a",
} as const;
