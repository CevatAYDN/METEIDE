import { Emitter } from "@theia/core/lib/common/event";
import { injectable } from "@theia/core/shared/inversify";

// The run the Team panel shows (ADR-078), which the METE view's Runs section marks. The panel writes
// it and the section reads it, so neither imports the other.

@injectable()
export class MeteShownRun {
	protected readonly changed = new Emitter<void>();
	/** Fires when the shown run changes. */
	readonly onDidChange = this.changed.event;
	/** The run the Team panel shows; none while it shows the composer or is closed. */
	runId: string | undefined;

	set(runId: string | undefined): void {
		if (runId === this.runId) return;
		this.runId = runId;
		this.changed.fire();
	}
}
