import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import type { Message } from "@theia/core/shared/@lumino/messaging";

// The behaviour every METE panel shares (docs/13, Keyboard-first; ADR-112): it takes focus when
// Theia activates it. Theia calls a widget active only while one of its elements holds focus, and a
// widget that never focuses stays inactive, so each `openView({ activate: true })` waits out the
// shell's two-second activation check and the caller goes on late (ApplicationShell.activeWidget).

/** The base of a METE panel: activation puts the keyboard in the panel, not in the widget before it. */
export abstract class MetePanelWidget extends ReactWidget {
	protected override onActivateRequest(msg: Message): void {
		super.onActivateRequest(msg);
		// -1 keeps the panel itself out of the tab order; the elements inside it stay reachable.
		this.node.tabIndex = -1;
		this.node.focus();
	}
}
