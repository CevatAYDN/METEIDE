import type { MeteEvent } from "@mete/contracts";
import { Emitter } from "@theia/core/lib/common/event";
import { injectable } from "@theia/core/shared/inversify";
import type { MeteDaemonClient } from "../domain/status-service.js";

/** An event of the daemon of a folder, as the frontend receives it. */
export type FolderEvent = {
	readonly workspaceDir: string;
	readonly event: MeteEvent;
};

/** The frontend's end of the event channel: the backend calls onEvent, the panels listen. */
@injectable()
export class MeteDaemonEvents implements MeteDaemonClient {
	protected readonly emitter = new Emitter<FolderEvent>();
	/** Fires for every event the backend forwards. */
	readonly onDidReceive = this.emitter.event;

	onEvent(workspaceDir: string, event: MeteEvent): void {
		this.emitter.fire({ workspaceDir, event });
	}
}
