import { QuickCommandService } from "@theia/core/lib/browser/quick-input/quick-command-service";
import type { CancellationToken } from "@theia/core/lib/common/cancellation";
import { nls } from "@theia/core/lib/common/nls";
import type { QuickPicks } from "@theia/core/lib/common/quick-pick-service";
import { injectable } from "@theia/core/shared/inversify";
import { filterCommandPicks } from "../application/command-palette-filter.js";

/** Keep native command eligibility and execution while matching case-expanded labels. */
@injectable()
export class MeteQuickCommandService extends QuickCommandService {
	override getPicks(filter: string, _token: CancellationToken): QuickPicks {
		const commands = this.getCommands();
		const recent = filterCommandPicks(
			commands.recent.map((command) => this.toItem(command)),
			filter,
		);
		const other = filterCommandPicks(
			commands.other.map((command) => this.toItem(command)),
			filter,
		);
		const picks: QuickPicks = [];
		if (recent.length > 0) {
			picks.push(
				{ type: "separator", label: nls.localizeByDefault("recently used") },
				...recent,
			);
			if (other.length > 0)
				picks.push({
					type: "separator",
					label: nls.localizeByDefault("other commands"),
				});
		}
		return [...picks, ...other];
	}
}
