import { quotaReserveContract } from "@mete/testing";
import { folders, setup } from "./setup.js";

// Runs the quota.reserve@1 contract kit against this package's adapter.

quotaReserveContract("quota module", async (now) => {
	const s = await setup(await folders(), {}, now);
	await s.quotaModule.activate(s.ctx);
	return { adapter: s.adapter(), close: s.close };
});
