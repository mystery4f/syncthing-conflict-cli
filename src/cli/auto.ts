/**
 * `stc auto` command — auto-resolve conflicts using a strategy.
 *
 * Groups conflicts by original file for correct multi-conflict handling.
 */

import type { Command } from "commander";
import chalk from "chalk";
import { scanConflicts, groupByOriginal, type ScanOptions } from "../core/scanner.js";
import {
	autoResolveGroup,
	type AutoStrategy,
	type GroupResolveResult,
} from "../core/resolver.js";
import { promptAutoConfirm } from "../ui/prompts.js";

const VALID_STRATEGIES: AutoStrategy[] = [
	"newest",
	"oldest",
	"largest",
	"smallest",
	"conflict",
	"original",
];

export function registerAutoCommand(program: Command): void {
	program
		.command("auto [dir]")
		.description("Auto-resolve conflicts using a strategy")
		.option(
			"--strategy <strategy>",
			`Strategy: ${VALID_STRATEGIES.join(", ")}`,
			"newest",
		)
		.option("--dry-run", "Show what would be done without executing", true)
		.option("--execute", "Actually execute the resolution")
		.option("--exclude <patterns>", "Comma-separated exclude patterns")
		.option("--depth <n>", "Max recursion depth", Number.parseInt)
		.action(async (dir: string, options: AutoCommandOptions) => {
			const directory = dir || ".";
			await runAuto(directory, options);
		});
}

interface AutoCommandOptions {
	strategy?: string;
	dryRun?: boolean;
	execute?: boolean;
	exclude?: string;
	depth?: number;
}

async function runAuto(directory: string, options: AutoCommandOptions): Promise<void> {
	const strategy = (options.strategy ?? "newest") as AutoStrategy;

	if (!VALID_STRATEGIES.includes(strategy)) {
		console.log(
			chalk.red(
				`Invalid strategy "${strategy}". Valid: ${VALID_STRATEGIES.join(", ")}`,
			),
		);
		process.exit(1);
	}

	const isExecute = options.execute === true;

	const scanOptions: ScanOptions = {
		directory,
		exclude: options.exclude?.split(","),
		depth: options.depth,
	};

	const pairs = await scanConflicts(scanOptions);

	if (pairs.length === 0) {
		console.log(chalk.green("No conflict files found."));
		return;
	}

	// Group by original file
	const groups = groupByOriginal(pairs);
	const groupEntries = [...groups.entries()];

	console.log(
		chalk.bold(
			`${isExecute ? "EXECUTING" : "DRY RUN"}: Auto-resolve ${groups.size} group${groups.size > 1 ? "s" : ""} (${pairs.length} total conflicts) using "${strategy}" strategy`,
		),
	);
	console.log("");

	// Preview
	const results: Array<{ original: string; count: number; result: GroupResolveResult }> = [];

	for (const [originalPath, groupPairs] of groupEntries) {
		const result = autoResolveGroup(groupPairs, strategy, { backup: isExecute });
		results.push({ original: originalPath, count: groupPairs.length, result });
		console.log(
			`  ${isExecute ? "" : "[dry-run] "} ${groupPairs[0]!.meta.originalName} (${groupPairs.length} conflict${groupPairs.length > 1 ? "s" : ""}) → ${result.success ? "ok" : `FAILED: ${result.error ?? "unknown"}`}`,
		);
	}

	if (!isExecute) {
		console.log("");
		console.log(chalk.yellow("This was a dry run. Use --execute to apply changes."));
		return;
	}

	// Confirm
	const confirmed = await promptAutoConfirm(strategy, groups.size);
	if (!confirmed) {
		console.log(chalk.gray("Cancelled."));
		return;
	}

	const successCount = results.filter((r) => r.result.success).length;
	const failCount = results.filter((r) => !r.result.success).length;

	console.log("");
	console.log(chalk.green(`✓ Resolved ${successCount} group${successCount > 1 ? "s" : ""}.`));
	if (failCount > 0) {
		console.log(chalk.red(`✗ Failed ${failCount}:`));
		for (const r of results.filter((r) => !r.result.success)) {
			console.log(`  ${r.original}: ${r.result.error}`);
		}
	}
}
