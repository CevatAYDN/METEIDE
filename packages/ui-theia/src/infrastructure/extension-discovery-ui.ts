import type { FrontendApplicationContribution } from "@theia/core/lib/browser/frontend-application-contribution";
import type { WidgetOpenerOptions } from "@theia/core/lib/browser/widget-open-handler";
import type URI from "@theia/core/lib/common/uri";
import { inject, injectable } from "@theia/core/shared/inversify";
import { VSXExtensionEditorManager } from "@theia/vsx-registry/lib/browser/vsx-extension-editor-manager";
import { VSXExtensionsModel } from "@theia/vsx-registry/lib/browser/vsx-extensions-model";
import type { UserInitiatedExtensionsModel } from "./extension-discovery.js";

/** Separate explicit native opens from the layout restorer's widget-factory resolutions. */
@injectable()
export class UserInitiatedExtensionEditorManager extends VSXExtensionEditorManager {
	@inject(VSXExtensionsModel)
	protected readonly model!: UserInitiatedExtensionsModel;

	override async open(uri: URI, options?: WidgetOpenerOptions) {
		await this.model.resolveFromUser(this.createWidgetOptions(uri).id);
		return super.open(uri, options);
	}
}

/** Observe native input without replacing Theia's child-scoped search bar or its controls. */
@injectable()
export class UserInitiatedExtensionSearch
	implements FrontendApplicationContribution
{
	@inject(VSXExtensionsModel)
	protected readonly model!: UserInitiatedExtensionsModel;

	onStart(): void {
		document.addEventListener("input", this.onInput, true);
	}

	onStop(): void {
		document.removeEventListener("input", this.onInput, true);
	}

	protected readonly onInput = (event: Event): void => {
		const input = event.target;
		if (
			event.isTrusted &&
			input instanceof HTMLInputElement &&
			input.closest(".theia-vsx-extensions-search-bar")
		) {
			this.model.searchFromUser(input.value);
		}
	};
}
