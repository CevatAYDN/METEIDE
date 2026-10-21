#!/usr/bin/env node
import { processIo } from "./infrastructure/terminal.js";
import { main } from "./main.js";

process.exitCode = await main(process.argv.slice(2), processIo);
