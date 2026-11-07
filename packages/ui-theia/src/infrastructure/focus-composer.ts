/** Focus only a ready, visible composer that already owns the active panel. */
export const focusComposer = (
	state: { node: HTMLElement; ready: () => boolean; visible: () => boolean },
	focused: () => void,
): void => {
	const focus = () => {
		const active = state.node.ownerDocument.activeElement;
		if (
			state.ready() &&
			state.visible() &&
			(active === state.node || state.node.contains(active))
		) {
			state.node.querySelector("textarea")?.focus();
			focused();
		}
	};
	const window = state.node.ownerDocument.defaultView;
	if (window) window.requestAnimationFrame(focus);
	else focus();
};
