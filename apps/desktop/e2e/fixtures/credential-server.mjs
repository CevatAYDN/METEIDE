// Synthetic credential only; no network, real account or model provider.
if (process.env.METE_TEST_KEY !== "mete-e2e-keychain-sentinel") {
	process.stderr.write("Required fixture credential is missing\n");
	process.exit(1);
}
await import("../../../../packages/mcp/test/fixtures/server.mjs");
