#!/usr/bin/env node

/**
 * stc — Syncthing Conflict CLI
 *
 * A CLI tool to scan, interactively resolve, and auto-handle
 * Syncthing sync conflict files.
 */

import { Command } from "commander";
import { registerScanCommand } from "./scan.js";
import { registerResolveCommand } from "./resolve.js";
import { registerAutoCommand } from "./auto.js";

const program = new Command();

program
	.name("stc")
	.description("Scan and resolve Syncthing conflict files")
	.version("0.1.0");

registerScanCommand(program);
registerResolveCommand(program);
registerAutoCommand(program);

program.parse();
