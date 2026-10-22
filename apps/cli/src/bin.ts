#!/usr/bin/env node
import { closeTerminal, processIo } from "./infrastructure/terminal.js";
import { main } from "./main.js";

try {
	process.exitCode = await main(process.argv.slice(2), processIo);
} finally {
	closeTerminal();
}
