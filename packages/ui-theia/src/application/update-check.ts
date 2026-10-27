import type { UpdateState } from "../domain/update-service.js";

// One update check (ADR-137): electron-updater looks for a newer GitHub release and downloads it.
// Pure over the updater, so tests pass a fake one and no test reaches the network.

/** The part of electron-updater's AppUpdater a check uses. */
export interface Updater {
	checkForUpdates(): Promise<{
		isUpdateAvailable: boolean;
		updateInfo: { version: string };
	} | null>;
	downloadUpdate(): Promise<unknown>;
}

// The GitHub provider's codes for a repository with no release that carries an update. A releases
// feed with no entry at all, which a repository that never published returns, fails its XML read.
const UNPUBLISHED = new Set([
	"ERR_XML_MISSED_ELEMENT",
	"ERR_UPDATER_NO_PUBLISHED_VERSIONS",
	"ERR_UPDATER_LATEST_VERSION_NOT_FOUND",
	"ERR_UPDATER_CHANNEL_FILE_NOT_FOUND",
]);

// GitHub answers a private or moved repository's releases feed with 404 to an app with no token.
const HIDDEN = "HTTP_ERROR_404";

// The updater's messages carry stacks and whole release feeds after the first line.
const failed = (e: unknown): UpdateState => {
	const message = e instanceof Error ? e.message : String(e);
	return { kind: "failed", message: message.split("\n")[0] ?? message };
};

const checkFailure = (e: unknown, current: string): UpdateState => {
	const code = String(
		typeof e === "object" && e !== null && "code" in e ? e.code : "",
	);
	if (UNPUBLISHED.has(code)) return { kind: "unpublished", current };
	return code === HIDDEN ? { kind: "hidden" } : failed(e);
};

/** Checks for a newer release and downloads it; the updater answers `null` in an unpackaged app. */
export const checkUpdate = async (
	updater: Updater,
	current: string,
): Promise<UpdateState> => {
	const found = await updater
		.checkForUpdates()
		.catch((e: unknown) => checkFailure(e, current));
	if (found === null) return { kind: "source" };
	if ("kind" in found) return found;
	if (!found.isUpdateAvailable) return { kind: "latest", current };
	return updater
		.downloadUpdate()
		.then(
			(): UpdateState => ({ kind: "ready", version: found.updateInfo.version }),
			failed,
		);
};
