import { injectable } from "@theia/core/shared/inversify";
import { autoUpdater } from "electron-updater";
import { checkUpdate } from "../application/update-check.js";
import type {
	MeteUpdateService,
	UpdateState,
} from "../domain/update-service.js";

// The app's main process side of "Check for Updates…" (ADR-137): electron-updater reads the
// `latest.yml` of the GitHub release that electron-builder's `publish` setting names.

@injectable()
export class MeteUpdateMain implements MeteUpdateService {
	// One check at a time: a second click while one runs gets the same answer.
	private pending: Promise<UpdateState> | undefined;

	check(): Promise<UpdateState> {
		// Downloaded on the user's click only; a downloaded release also installs on the next quit.
		autoUpdater.autoDownload = false;
		this.pending ??= checkUpdate(
			autoUpdater,
			autoUpdater.currentVersion.version,
		).finally(() => {
			this.pending = undefined;
		});
		return this.pending;
	}

	async install(): Promise<void> {
		autoUpdater.quitAndInstall();
	}
}
