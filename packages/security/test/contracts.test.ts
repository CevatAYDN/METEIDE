import type {
	PolicyCheckAdapter,
	PolicyGrantAdapter,
	SecretsMaskAdapter,
} from "@mete/contracts";
import {
	policyCheckContract,
	policyGrantContract,
	secretsMaskContract,
} from "@mete/testing";
import { setup } from "./setup.js";

// Runs the policy.check@1, policy.grant@1 and secrets.mask@1 contract kits against this package's adapters.

const opened = async () => {
	const s = await setup();
	await s.security.activate(s.ctx);
	const close = async () => {
		await s.security.deactivate();
		await s.storage.deactivate();
	};
	return { s, close };
};

policyCheckContract("security module", async () => {
	const { s, close } = await opened();
	return {
		adapter: s.impl<PolicyCheckAdapter>("policy.check@1"),
		workspaceDir: s.dirs.workspaceDir,
		home: s.home,
		close,
	};
});

policyGrantContract("security module", async () => {
	const { s, close } = await opened();
	return {
		grant: s.impl<PolicyGrantAdapter>("policy.grant@1"),
		check: s.impl<PolicyCheckAdapter>("policy.check@1"),
		close,
	};
});

secretsMaskContract("security module", async () => {
	const { s, close } = await opened();
	return { adapter: s.impl<SecretsMaskAdapter>("secrets.mask@1"), close };
});
