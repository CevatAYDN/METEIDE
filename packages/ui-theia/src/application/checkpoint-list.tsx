import type { CheckpointCard } from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";
import { LIST, MUTED, ROW, TITLE } from "./look.js";
import { when } from "./time-text.js";

// The run's checkpoints under the Team panel's view (ADR-079), newest first, each with Restore. A
// restore records the state before it as a new checkpoint, which then shows at the top, so the
// list itself is the undo. No event names a checkpoint's step, so a row shows its number and time.

const numberOf = (ref: string) => ref.slice(ref.lastIndexOf("/") + 1);

/** What a restore says: the checkpoint restored and the one that undoes it, by number. */
export const restoredText = (r: {
	readonly ref: string;
	readonly undo: string;
}) =>
	nls.localize(
		"mete/checkpoint/done",
		"Restored checkpoint #{0}; checkpoint #{1} undoes it.",
		numberOf(r.ref),
		numberOf(r.undo),
	);

/** What restoring a checkpoint asks for, and the one in flight, whose button waits. */
export type RestoreControls = {
	readonly onRestore: (checkpointId: string) => void;
	readonly restoring?: string | undefined;
};

/** The checkpoint list, or nothing for a run without checkpoints. */
export const CheckpointList = ({
	checkpoints,
	restore,
}: {
	readonly checkpoints: readonly CheckpointCard[];
	readonly restore: RestoreControls;
}) =>
	checkpoints.length === 0 ? null : (
		<section aria-label={nls.localize("mete/checkpoint/title", "Checkpoints")}>
			<h3 style={TITLE}>
				{nls.localize("mete/checkpoint/title", "Checkpoints")}
			</h3>
			<p style={MUTED}>
				{nls.localize(
					"mete/checkpoint/hint",
					"Restore puts this folder's files back as they were at a checkpoint, for a paused or ended run; the files as they are now are kept as a new checkpoint first, so a restore can be undone.",
				)}
			</p>
			<ul style={LIST}>
				{[...checkpoints].reverse().map((c) => (
					<li key={c.id} style={ROW}>
						<span>
							{nls.localize(
								"mete/checkpoint/row",
								"#{0} · {1}",
								c.n,
								when(c.at),
							)}
						</span>
						{c.restoredAt ? (
							<span style={MUTED}>
								{nls.localize(
									"mete/checkpoint/restored",
									"restored {0}",
									when(c.restoredAt),
								)}
							</span>
						) : null}
						<button
							type="button"
							className="mete-button quiet"
							disabled={restore.restoring !== undefined}
							onClick={() => restore.onRestore(c.id)}
						>
							{restore.restoring === c.id
								? nls.localize("mete/checkpoint/restoring", "Restoring…")
								: nls.localize("mete/checkpoint/restore", "Restore")}
						</button>
					</li>
				))}
			</ul>
		</section>
	);
