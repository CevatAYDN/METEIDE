// The window's time of day from the user's local clock (docs/13, Scene layout: a window showing the
// local time of day; ADR-070), with the demo's day curve. The demo's day starts at 06:00, so a local
// hour h is the day's fraction p = (h - 6) / 24: the sun crosses the pane until about 19:30, dusk
// darkens the sky from 18:00 to 20:24, the night lasts until 04:05 and dawn ends at 06:00.

/** A colour as red, green and blue, 0 to 255. */
export type Rgb = readonly [number, number, number];

/** The sky at a moment: the day's fraction, how dark it is (0 day, 1 night) and how warm (sunrise, sunset). */
export type Sky = {
	readonly p: number;
	readonly n: number;
	readonly warm: number;
};

const clamp = (v: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, v));
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** The sky at a local time. */
export const skyOf = (now: Date): Sky => {
	const hours = now.getHours() + now.getMinutes() / 60;
	const p = ((((hours - 6) / 24) % 1) + 1) % 1;
	let night = 0;
	if (p >= 0.5 && p < 0.6) night = (p - 0.5) / 0.1;
	else if (p >= 0.6 && p < 0.92) night = 1;
	else if (p >= 0.92) night = 1 - (p - 0.92) / 0.08;
	const warm = Math.min(
		1,
		Math.max(0, 1 - Math.abs(p - 0.55) / 0.06) +
			Math.max(0, 1 - Math.abs(p - 0.96) / 0.05),
	);
	return { p, n: ease(clamp(night, 0, 1)), warm };
};

/** A colour `t` of the way from `a` to `b`. */
export const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
	a[0] + (b[0] - a[0]) * t,
	a[1] + (b[1] - a[1]) * t,
	a[2] + (b[2] - a[2]) * t,
];

/** A colour as a CSS string the stage understands, with an alpha (1 when left out). */
export const rgb = (c: Rgb, alpha = 1) =>
	`rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${alpha})`;
