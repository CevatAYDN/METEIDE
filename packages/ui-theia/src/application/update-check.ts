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

// The GitHub provider's codes for a repository with no release that carries an update.
const UNPUBLISHED = new Set([
	"ERR_UPDATER_NO_PUBLISHED_VERSIONS",
	"ERR_UPDATER_LATEST_VERSION_NOT_FOUND",
	"ERR_UPDATER_CHANNEL_FILE_NOT_FOUND",
]);

const failure = (e: unknown, current: string): UpdateState => {
	const code = typeof e === "object" && e !== null && "code" in e ? e.code : "";
	if (UNPUBLISHED.has(String(code))) return { kind: "unpublished", current };
	// The updater's messages carry stacks and whole release feeds after the first line.
	const message = e instanceof Error ? e.message : String(e);
	return { kind: "failed", message: message.split("\n")[0] ?? message };
};

/** Checks for a newer release and downloads it; the updater answers `null` in an unpackaged app. */
export const checkUpdate = async (
	updater: Updater,
	current: string,
): Promise<UpdateState> => {
	try {
		const found = await updater.checkForUpdates();
		if (!found) return { kind: "source" };
		if (!found.isUpdateAvailable) return { kind: "latest", current };
		await updater.downloadUpdate();
		return { kind: "ready", version: found.updateInfo.version };
	} catch (e) {
		return failure(e, current);
	}
};
