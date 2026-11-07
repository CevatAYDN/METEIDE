import type { CancellationToken } from "@theia/core/lib/common/cancellation";
import { injectable } from "@theia/core/shared/inversify";
import { VSXExtensionsModel } from "@theia/vsx-registry/lib/browser/vsx-extensions-model";
import type { VSXRegistryService } from "@theia/vsx-registry/lib/common/vsx-registry-service";
import { z } from "zod";

const LocalDeployedMetadata = z.array(
	z.object({
		metadata: z.object({
			model: z.object({
				publisher: z.string(),
				name: z.string().min(1),
				version: z.string().min(1),
				displayName: z.string().optional(),
				description: z.string().optional(),
			}),
		}),
	}),
);

/** Native extension management without startup marketplace lookups (ADR-180). */
@injectable()
export class UserInitiatedExtensionsModel extends VSXExtensionsModel {
	protected userQuery: string | undefined;

	protected override async initSearchResult(): Promise<void> {
		this.search.onDidChangeQuery(() => {
			this.userQuery = undefined;
			this.resetSearchCancellationTokenSource();
			void this.updateSearchResult();
		});
	}

	/** Authorize only the query entered in the native search input. */
	searchFromUser(query: string): void {
		this.search.query = query;
		this.userQuery = query;
		void this.updateSearchResult();
	}

	protected override doUpdateSearchResult(
		param: NonNullable<Parameters<VSXRegistryService["search"]>[0]>,
		token: CancellationToken,
	): Promise<void> {
		if (param.query && this.search.query === this.userQuery) {
			return super.doUpdateSearchResult(param, token);
		}
		return this.doChange(async () => {
			this._searchResult.clear();
		}, token);
	}

	protected override async initRecommended(): Promise<void> {
		// Workspace recommendations must not trigger remote discovery on startup.
	}

	protected override async refresh(id: string, version?: string) {
		const extension = this.getExtension(id) ?? this.setExtension(id, version);
		const installedVersion = version ?? extension.installedVersion;
		if (extension.plugin || !installedVersion) return extension;
		// Disabled plugins are not hosted, but their deployed manifests remain local.
		const versionedId = `${id}@${installedVersion}` as Parameters<
			typeof this.pluginServer.getDeployedPlugins
		>[0][number];
		try {
			const raw: unknown = await this.pluginServer.getDeployedPlugins([
				versionedId,
			]);
			const parsed = LocalDeployedMetadata.safeParse(raw);
			if (!parsed.success) {
				this.onDidFailRefresh(id, parsed.error);
				return extension;
			}
			const metadata = parsed.data.find(
				({ metadata: { model } }) =>
					`${model.publisher.toLowerCase()}.${model.name.toLowerCase()}@${model.version}` ===
					versionedId,
			)?.metadata.model;
			if (metadata) {
				extension.update({
					...metadata,
					displayName: metadata.displayName ?? metadata.name,
					description: metadata.description ?? "",
				});
			}
			return extension;
		} catch (error) {
			this.onDidFailRefresh(id, error);
			return extension;
		}
	}

	override resolve(id: string) {
		// The widget factory also resolves restored tabs; even a cached remote README is off limits.
		return Promise.resolve(this.getExtension(id) ?? this.setExtension(id));
	}

	/** Hydrate explicit opens through native metadata, README origin checks and sanitization. */
	async resolveFromUser(id: string) {
		await super.refresh(id);
		return super.resolve(id);
	}
}
