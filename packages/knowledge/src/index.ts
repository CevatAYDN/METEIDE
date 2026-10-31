// Public API of this package: types, contracts and the module (CONTRIBUTING.md).

export { restoreVersion, versionsOf } from "./infrastructure/history.js";
export { createVaultModule, type VaultOptions } from "./module.js";
export { createKnowledgeSearchModule } from "./search-module.js";
