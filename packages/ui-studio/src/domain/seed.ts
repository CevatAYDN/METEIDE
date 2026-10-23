/** A stable number from an id: the same id gives the same colour or look in every run (ADR-070). */
export const seedOf = (id: string): number => {
	let h = 0;
	for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
	return h;
};
