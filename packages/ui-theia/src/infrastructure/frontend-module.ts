import { CommandContribution, MenuContribution } from "@theia/core";
import { FrontendApplicationContribution } from "@theia/core/lib/browser/frontend-application-contribution";
import { ServiceConnectionProvider } from "@theia/core/lib/browser/messaging/service-connection-provider";
import { QuickCommandService } from "@theia/core/lib/browser/quick-input/quick-command-service";
import { ContainerModule } from "@theia/core/shared/inversify";
import { VSXExtensionEditorManager } from "@theia/vsx-registry/lib/browser/vsx-extension-editor-manager";
import { VSXExtensionsModel } from "@theia/vsx-registry/lib/browser/vsx-extensions-model";
import { MeteApprovalContribution } from "../application/approval-commands.js";
import { MeteDaemonEvents } from "../application/daemon-events.js";
import { MeteKeyContribution } from "../application/key-command.js";
import { MeteCommandContribution } from "../application/status-command.js";
import {
	METE_DAEMON_PATH,
	MeteDaemonService,
} from "../domain/status-service.js";
import { MeteArtifactContribution } from "./artifact-command.js";
import { bindAssets } from "./assets-contribution.js";
import { bindAudit } from "./audit-contribution.js";
import { bindBoard } from "./board-contribution.js";
import { bindChanges } from "./changes-contribution.js";
import { MeteQuickCommandService } from "./command-palette.js";
import { MeteEditorContextContribution } from "./editor-context-contribution.js";
import { MeteEditorContext } from "./editor-context-service.js";
import { UserInitiatedExtensionsModel } from "./extension-discovery.js";
import {
	UserInitiatedExtensionEditorManager,
	UserInitiatedExtensionSearch,
} from "./extension-discovery-ui.js";
import { bindHome } from "./home-contribution.js";
import { bindMemory } from "./memory-contribution.js";
import { bindQuota } from "./quota-contribution.js";
import { bindSettings } from "./settings-contribution.js";
import { bindShell } from "./shell-contribution.js";
import { bindStopAll } from "./stop-all-contribution.js";
import { bindTeamEditor } from "./team-editor-contribution.js";
import { bindWelcome } from "./welcome-contribution.js";

// Theia's generated frontend loads this file by the path in package.json and binds `module.default`.
// biome-ignore lint/style/noDefaultExport: Theia reads `default` from an extension module
export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
	rebind(QuickCommandService).to(MeteQuickCommandService).inSingletonScope();
	rebind(VSXExtensionsModel)
		.to(UserInitiatedExtensionsModel)
		.inSingletonScope();
	rebind(VSXExtensionEditorManager)
		.to(UserInitiatedExtensionEditorManager)
		.inSingletonScope();
	bind(UserInitiatedExtensionSearch).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(UserInitiatedExtensionSearch);
	bind(MeteDaemonEvents).toSelf().inSingletonScope();
	bind(MeteEditorContext).toSelf().inSingletonScope();
	// The events object is the client the backend calls back (ADR-047: events reach the panels).
	bind(MeteDaemonService)
		.toDynamicValue((ctx) =>
			ServiceConnectionProvider.createProxy<MeteDaemonService>(
				ctx.container,
				METE_DAEMON_PATH,
				ctx.container.get(MeteDaemonEvents),
			),
		)
		.inSingletonScope();
	bind(CommandContribution).to(MeteCommandContribution).inSingletonScope();
	bind(CommandContribution).to(MeteApprovalContribution).inSingletonScope();
	bind(CommandContribution).to(MeteKeyContribution).inSingletonScope();
	bind(CommandContribution).to(MeteArtifactContribution).inSingletonScope();
	bind(MeteEditorContextContribution).toSelf().inSingletonScope();
	bind(CommandContribution).toService(MeteEditorContextContribution);
	bind(MenuContribution).toService(MeteEditorContextContribution);
	bindHome(bind);
	bindBoard(bind);
	bindChanges(bind);
	bindAudit(bind);
	bindAssets(bind);
	bindMemory(bind);
	bindQuota(bind);
	bindStopAll(bind);
	bindTeamEditor(bind);
	bindSettings(bind);
	bindWelcome(bind);
	bindShell(bind);
});
