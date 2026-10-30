#!/usr/bin/env node
import tls from "node:tls";
import { closeTerminal, processIo } from "./infrastructure/terminal.js";
import { preferHybridKeyExchange } from "./infrastructure/tls.js";
import { main } from "./main.js";

// Before any command opens a connection (ADR-160); loading the modules opens none.
preferHybridKeyExchange(tls);
try {
	process.exitCode = await main(process.argv.slice(2), processIo);
} finally {
	closeTerminal();
}
