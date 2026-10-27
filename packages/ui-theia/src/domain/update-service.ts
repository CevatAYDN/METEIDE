// What the frontend asks the app's main process about updates (ADR-137; docs/15, Release process,
// step 6): electron-updater reads the GitHub release that step 5 publishes.

/** Where the main process serves the update service on Theia's Electron IPC. */
export const METE_UPDATE_PATH = "/services/mete-update";

/** What a check found. */
export type UpdateState =
	// Not an installed build: electron-updater checks only a packaged app.
	| { kind: "source" }
	| { kind: "unpublished"; current: string }
	| { kind: "latest"; current: string }
	| { kind: "ready"; version: string }
	| { kind: "failed"; message: string };

/** The update service of the app's main process (ADR-137). */
export const MeteUpdateService = Symbol("MeteUpdateService");
export interface MeteUpdateService {
	/** Looks for a newer release and downloads it. */
	check(): Promise<UpdateState>;
	/** Quits the app and installs the downloaded release. */
	install(): Promise<void>;
}
