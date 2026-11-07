import "reflect-metadata";
import URI from "@theia/core/lib/common/uri";
import type { VSXExtensionData } from "@theia/vsx-registry/lib/browser/vsx-extension";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserInitiatedExtensionsModel } from "../src/infrastructure/extension-discovery.js";
import {
	UserInitiatedExtensionEditorManager,
	UserInitiatedExtensionSearch,
} from "../src/infrastructure/extension-discovery-ui.js";

const remote = vi.hoisted(() => ({
	search: vi.fn(),
	metadata: vi.fn(),
	readme: vi.fn(),
	open: vi.fn(),
}));
const local = vi.hoisted(() => ({
	deployed: vi.fn<() => Promise<unknown[]>>(),
	plugin: vi.fn(() => undefined),
	error: vi.fn(),
}));
// The desktop boundary follows the installed 1.76.0 query/factory/README paths.
vi.mock("@theia/vsx-registry/lib/browser/vsx-extensions-model", () => ({
	VSXExtensionsModel: class {
		listener = () => {};
		query = "";
		search = {
			get query() {
				return "";
			},
			set query(_value: string) {},
			parseQuery: () => ({ freeText: this.query }),
			onDidChangeQuery: (listener: () => void) => {
				this.listener = listener;
			},
		};
		constructor() {
			Object.defineProperty(this.search, "query", {
				get: () => this.query,
				set: (value: string) => {
					if (value === this.query) return;
					this.query = value;
					this.listener();
				},
			});
		}
		_searchResult = new Set<string>();
		_unversionedInstalled = new Set<string>();
		disabled = new Set<string>();
		pluginSupport = { getPlugin: local.plugin };
		pluginServer = { getDeployedPlugins: local.deployed };
		logger = { error: local.error };
		extensions = new Map<string, ReturnType<typeof this.createExtension>>();
		getExtension(id = "fixture.extension") {
			return this.extensions.get(id);
		}
		setExtension(id = "fixture.extension", version?: string) {
			const extension =
				this.getExtension(id) ?? this.createExtension(id, version);
			this.extensions.set(id, extension);
			return extension;
		}
		createExtension(id: string, version?: string) {
			const data: Partial<VSXExtensionData> = {};
			const model = this;
			return {
				id,
				installedVersion: version,
				get plugin() {
					return model.pluginSupport.getPlugin();
				},
				get installed() {
					return model._unversionedInstalled.has(id);
				},
				get disabled() {
					return model.disabled.has(id);
				},
				get name() {
					return data.name;
				},
				get displayName() {
					return data.displayName || data.name || id;
				},
				get description() {
					return data.description;
				},
				get publisher() {
					return data.publisher;
				},
				get version() {
					return data.version;
				},
				get readmeUrl() {
					return data.readmeUrl;
				},
				get verified() {
					return data.verified;
				},
				update: (value: Partial<VSXExtensionData>) =>
					Object.assign(data, value),
			};
		}
		async refresh(id: string, version?: string) {
			remote.metadata(id, version);
			return this.setExtension(id, version);
		}
		onDidFailRefresh(id: string, error: unknown) {
			local.error(id, error);
			return this.getExtension(id);
		}
		async doChange(task: () => Promise<void>) {
			await task();
		}
		resetSearchCancellationTokenSource() {}
		updateSearchResult = () => this.doUpdateSearchResult({ query: this.query });
		async doUpdateSearchResult(param: { query: string }) {
			remote.search(param.query);
		}
		async resolve(id: string) {
			const extension = await this.refresh(id);
			remote.readme(id);
			return extension;
		}
		async initRecommended() {
			remote.metadata("fixture.recommended");
		}
	},
}));
vi.mock("@theia/vsx-registry/lib/browser/vsx-extension-editor-manager", () => ({
	VSXExtensionEditorManager: class {
		createWidgetOptions() {
			return { id: "fixture.extension" };
		}
		async open(...args: unknown[]) {
			remote.open(...args);
			return {};
		}
	},
}));

class Model extends UserInitiatedExtensionsModel {
	initial() {
		return this.initSearchResult();
	}
	initialRecommendations() {
		return this.initRecommended();
	}
	refreshInstalled() {
		return this.refresh("fixture.extension");
	}
	reloadDisabledInstalled() {
		this._unversionedInstalled.add("fixture.extension");
		this.disabled.add("fixture.extension");
		this.setExtension("fixture.extension", "1.0.0");
		return this.refresh("fixture.extension", "1.0.0");
	}
	refreshSearch() {
		return this.updateSearchResult();
	}
}
class EditorManager extends UserInitiatedExtensionEditorManager {
	constructor(model: Model) {
		super();
		Object.assign(this, { model });
	}
}
class Search extends UserInitiatedExtensionSearch {
	constructor(model: Model) {
		super();
		Object.assign(this, { model });
	}
}

describe("user-initiated extension discovery", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		local.deployed.mockResolvedValue([]);
	});

	it("does not query Open VSX for initial installed/recommended metadata", async () => {
		const model = new Model();
		await model.initial();
		await model.initialRecommendations();
		expect(await model.refreshInstalled()).toMatchObject({
			id: "fixture.extension",
		});
		expect(remote.metadata).not.toHaveBeenCalled();
		expect(remote.search).not.toHaveBeenCalled();
	});

	it("keeps disabled installed rows readable from local metadata after reload", async () => {
		local.deployed.mockResolvedValue([
			{
				metadata: {
					model: {
						publisher: "fixture",
						name: "extension",
						version: "1.0.0",
						displayName: "METE Lifecycle Fixture",
						description: "Local lifecycle acceptance fixture",
						readmeUrl: "https://unrequested.invalid/README.md",
						verified: true,
					},
				},
			},
		]);
		const model = new Model();
		const extension = await model.reloadDisabledInstalled();
		expect(extension).toMatchObject({
			id: "fixture.extension",
			plugin: undefined,
			installed: true,
			disabled: true,
			name: "extension",
			displayName: "METE Lifecycle Fixture",
			description: "Local lifecycle acceptance fixture",
			publisher: "fixture",
			version: "1.0.0",
			readmeUrl: undefined,
			verified: undefined,
		});
		expect(local.plugin).toHaveBeenCalled();
		expect(local.deployed).toHaveBeenCalledWith(["fixture.extension@1.0.0"]);
		await model.resolve("fixture.extension");
		expect(remote.metadata).not.toHaveBeenCalled();
		expect(remote.search).not.toHaveBeenCalled();
		expect(remote.readme).not.toHaveBeenCalled();
	});

	it.each([
		{
			publisher: "fixture",
			name: "extension",
			version: "1.0.0",
			displayName: 42,
		},
		{
			publisher: "another",
			name: "extension",
			version: "1.0.0",
			displayName: "Wrong extension",
		},
		{
			publisher: "fixture",
			name: "extension",
			version: "2.0.0",
			displayName: "Wrong version",
		},
	])(
		"does not apply malformed or mismatched deployed metadata: %j",
		async (model) => {
			local.deployed.mockResolvedValue([{ metadata: { model } }]);
			const extension = await new Model().reloadDisabledInstalled();
			expect(extension).toMatchObject({
				displayName: "fixture.extension",
				installed: true,
				disabled: true,
			});
			expect(remote.metadata).not.toHaveBeenCalled();
			expect(remote.search).not.toHaveBeenCalled();
			expect(remote.readme).not.toHaveBeenCalled();
		},
	);

	it("does not discover extensions when Theia restores a non-empty query", async () => {
		const model = new Model();
		await model.initial();
		model.search.query = "restored query";
		await model.refreshSearch();
		expect(remote.search).not.toHaveBeenCalled();
	});

	it("does not fetch metadata or README when the detail factory restores an editor", async () => {
		const model = new Model();
		await model.resolve("fixture.extension");
		expect(remote.metadata).not.toHaveBeenCalled();
		expect(remote.readme).not.toHaveBeenCalled();
	});

	it("searches on explicit input but does not authorize later programmatic queries", async () => {
		const model = new Model();
		await model.initial();
		model.searchFromUser("requested query");
		await model.refreshSearch();
		expect(remote.search).toHaveBeenCalledWith("requested query");
		remote.search.mockClear();
		model.search.query = "restored later";
		await model.refreshSearch();
		await model.refreshInstalled();
		await model.resolve("fixture.unrelated");
		expect(remote.search).not.toHaveBeenCalled();
		expect(remote.metadata).not.toHaveBeenCalled();
		expect(remote.readme).not.toHaveBeenCalled();
	});

	it("hydrates an explicitly opened editor even if its widget was already restored", async () => {
		const model = new Model();
		await model.resolve("fixture.extension");
		const manager = new EditorManager(model);
		const uri = new URI("vsx:fixture.extension");
		const options = { mode: "reveal" as const };
		await manager.open(uri, options);
		expect(remote.metadata).toHaveBeenCalledWith(
			"fixture.extension",
			undefined,
		);
		expect(remote.readme).toHaveBeenCalledWith("fixture.extension");
		expect(remote.open).toHaveBeenCalledWith(uri, options);
	});

	it("wires only trusted native search input and removes the listener on shutdown", () => {
		const addEventListener = vi.fn();
		const removeEventListener = vi.fn();
		vi.stubGlobal("document", { addEventListener, removeEventListener });
		class Input {
			value = "requested query";
			closest() {
				return true;
			}
		}
		vi.stubGlobal("HTMLInputElement", Input);
		try {
			const model = new Model();
			const search = vi.spyOn(model, "searchFromUser");
			const contribution = new Search(model);
			contribution.onStart();
			const listener = addEventListener.mock.calls[0]?.[1] as (
				event: unknown,
			) => void;
			listener({ isTrusted: false, target: new Input() });
			expect(search).not.toHaveBeenCalled();
			listener({ isTrusted: true, target: new Input() });
			expect(search).toHaveBeenCalledWith("requested query");
			contribution.onStop();
			expect(removeEventListener).toHaveBeenCalledWith("input", listener, true);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
