/**
 * `stc auto` command — auto-resolve conflicts using a strategy.
 */

import type { Command } from "commander";
import chalk from "chalk";
import { scanConflicts, type ScanOptions } from "../core/scanner.js";
import {
	autoResolve,
	type AutoStrategy,
	type ResolveResult,
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

	console.log(
		chalk.bold(
			`${isExecute ? "EXECUTING" : "DRY RUN"}: Auto-resolve ${pairs.length} conflicts using "${strategy}" strategy`,
		),
	);
	console.log("");

	// Preview all resolutions
	const results: ResolveResult[] = [];
	for (const pair of pairs) {
		const result = autoResolve(pair, strategy, { backup: isExecute });
		results.push(result);
		console.log(
			`  ${isExecute ? "" : "[dry-run] "} ${pair.meta.originalName} → keep ${result.choice}`,
		);
	}

	if (!isExecute) {
		console.log("");
		console.log(
			chalk.yellow("This was a dry run. Use --execute to apply changes."),
		);
		return;
	}

	// Confirm before executing
	const confirmed = await promptAutoConfirm(strategy, pairs.length);
	if (!confirmed) {
		console.log(chalk.gray("Cancelled."));
		return;
	}

	// Already resolved in dry-run pass with backup enabled, just report
	const successCount = results.filter((r) => r.success).length;
	const failCount = results.filter((r) => !r.success).length;

	console.log("");
	console.log(
		chalk.green(
			`✓ Resolved ${successCount} conflicts.`,
		),
	);
	if (failCount > 0) {
		console.log(
			chalk.red(
				`✗ Failed ${failCount}:`,
			),
		);
		for (const r of results.filter((r) => !r.success)) {
			console.log(`  ${r.pair.meta.originalName}: ${r.error}`);
		}
	}
}
