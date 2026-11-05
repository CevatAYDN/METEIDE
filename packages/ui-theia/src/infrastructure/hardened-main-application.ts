import { dirname } from "node:path";
import { session } from "@theia/core/electron-shared/electron";
import type {
	ElectronMainApplication,
	ElectronMainApplicationContribution,
} from "@theia/core/lib/electron-main/electron-main-application";
import { ElectronMainApplication as TheiaMainApplication } from "@theia/core/lib/electron-main/electron-main-application";
import { ElectronMainApplicationGlobals } from "@theia/core/lib/electron-main/electron-main-constants";
import type { TheiaBrowserWindowOptions } from "@theia/core/lib/electron-main/theia-electron-window";
import { inject, injectable } from "@theia/core/shared/inversify";
import { cspFor } from "../application/csp.js";
import { type HeadersHook, installCsp } from "../application/csp-headers.js";
import { RENDERER_SANDBOX } from "../defaults.js";

// The Electron hardening of ADR-175: Theia 1.76 opens its windows with `sandbox: false` and no
// Content-Security-Policy (electron-main-application.js, getDefaultOptions). The app rebinds
// Theia's main application to this subclass, whose defaults every window getter spreads
// (getDefaultTheiaWindowOptions, getLastWindowOptions, and the secondary window handler, whose
// child inherits the opener's sandbox), and adds a contribution that sets the policy once the app
// is ready, before the first window loads.

/** Theia's main application with the renderer sandbox on. */
@injectable()
export class HardenedMainApplication extends TheiaMainApplication {
	protected override getDefaultOptions(): TheiaBrowserWindowOptions {
		return withSandbox(super.getDefaultOptions());
	}

	protected override getDefaultTheiaWindowOptions(): TheiaBrowserWindowOptions {
		return withSandbox(super.getDefaultTheiaWindowOptions());
	}
}

/** The options with `webPreferences.sandbox` set over whatever else they carry. */
export const withSandbox = (
	options: TheiaBrowserWindowOptions,
): TheiaBrowserWindowOptions => ({
	...options,
	webPreferences: { ...options.webPreferences, sandbox: RENDERER_SANDBOX },
});

/** Adds the policy to the frontend's documents from `onStart`, which Theia calls after `app.whenReady`. */
@injectable()
export class CspContribution implements ElectronMainApplicationContribution {
	@inject(ElectronMainApplicationGlobals)
	protected readonly globals!: ElectronMainApplicationGlobals;

	/** Read lazily so a test can hand in a fake before Electron exists. */
	protected hook(): HeadersHook {
		const request = session.defaultSession.webRequest;
		return {
			onHeadersReceived: (listener) => request.onHeadersReceived(listener),
		};
	}

	onStart(_application: ElectronMainApplication): void {
		installCsp(
			this.hook(),
			dirname(this.globals.THEIA_FRONTEND_HTML_PATH),
			cspFor(),
		);
	}
}
