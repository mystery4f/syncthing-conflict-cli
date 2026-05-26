/**
 * `stc resolve` command — interactively resolve conflicts.
 *
 * Groups conflicts by original file, so multiple conflicts
 * for the same file are resolved together atomically.
 */

import type { Command } from "commander";
import chalk from "chalk";
import { scanConflicts, groupByOriginal, type ScanOptions, type ConflictPair } from "../core/scanner.js";
import { resolveConflict, resolveGroup } from "../core/resolver.js";
import { promptConflictAction, promptGroupAction } from "../ui/prompts.js";
import { viewDiff, viewDiffExternal } from "../ui/diff-viewer.js";

export function registerResolveCommand(program: Command): void {
	program
		.command("resolve [dir]")
		.description("Interactively resolve Syncthing conflicts")
		.option("--sort <field>", "Sort by: time, size, name", "time")
		.option("--exclude <patterns>", "Comma-separated exclude patterns")
		.option("--depth <n>", "Max recursion depth", Number.parseInt)
		.option("--diff-tool <command>", "External diff tool command")
		.action(async (dir: string, options: ResolveCommandOptions) => {
			const directory = dir || ".";
			await runResolve(directory, options);
		});
}

interface ResolveCommandOptions {
	sort?: string;
	exclude?: string;
	depth?: number;
	diffTool?: string;
}

async function runResolve(
	directory: string,
	options: ResolveCommandOptions,
): Promise<void> {
	const scanOptions: ScanOptions = {
		directory,
		sort: (options.sort as ScanOptions["sort"]) ?? "time",
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
			`Found ${pairs.length} conflict file${pairs.length > 1 ? "s" : ""} in ${groupEntries.length} group${groupEntries.length > 1 ? "s" : ""}. Starting interactive resolution...`,
		),
	);

	let resolved = 0;
	let skipped = 0;

	for (let gi = 0; gi < groupEntries.length; gi++) {
		const [, groupPairs] = groupEntries[gi]!;

		let result: "resolved" | "skipped" | "quit";

		if (groupPairs.length === 1) {
			result = await handleSinglePair(groupPairs[0]!, gi, groupEntries.length, options);
		} else {
			result = await handleGroup(groupPairs, gi, groupEntries.length, options);
		}

		if (result === "quit") break;
		if (result === "resolved") resolved += groupPairs.length;
		else skipped += groupPairs.length;
	}

	console.log(chalk.bold(`\nDone! Resolved ${resolved}, skipped ${skipped}.`));
}

async function handleSinglePair(
	pair: ConflictPair,
	groupIndex: number,
	totalGroups: number,
	options: ResolveCommandOptions,
): Promise<"resolved" | "skipped" | "quit"> {
	for (;;) {
		const action = await promptConflictAction(pair, groupIndex, totalGroups);

		if (action.quit) return "quit";

		if (action.viewDiff) {
			showDiff(pair.meta.originalPath, pair.meta.conflictPath, options.diffTool);
			continue;
		}

		if (action.choice === "skip") {
			console.log(chalk.gray("Skipped."));
			return "skipped";
		}

		const result = resolveConflict(pair, action.choice);
		if (result.success) {
			console.log(chalk.green(`✓ Resolved: kept ${action.choice}`));
			return "resolved";
		}
		console.log(chalk.red(`✗ Failed: ${result.error}`));
		return "skipped";
	}
}

async function handleGroup(
	pairs: ConflictPair[],
	groupIndex: number,
	totalGroups: number,
	options: ResolveCommandOptions,
): Promise<"resolved" | "skipped" | "quit"> {
	for (;;) {
		const action = await promptGroupAction(pairs, groupIndex, totalGroups);

		if (action.quit) return "quit";

		if (action.viewDiff) {
			const idx = action.viewDiffConflictIndex ?? 0;
			const conflictPair = pairs[idx];
			if (conflictPair) {
				showDiff(conflictPair.meta.originalPath, conflictPair.meta.conflictPath, options.diffTool);
			}
			continue;
		}

		if (action.target.type === "skip") {
			console.log(chalk.gray("Skipped."));
			return "skipped";
		}

		const result = resolveGroup(pairs, action.target);
		if (result.success) {
			const desc = action.target.type === "original"
				? "original"
				: `conflict #${action.target.conflictIndex + 1}`;
			console.log(chalk.green(`✓ Resolved ${pairs.length} conflicts: kept ${desc}`));
			return "resolved";
		}
		console.log(chalk.red(`✗ Failed: ${result.error}`));
		return "skipped";
	}
}

function showDiff(originalPath: string, conflictPath: string, diffTool?: string): void {
	if (diffTool) {
		viewDiffExternal(originalPath, conflictPath, diffTool);
	} else {
		viewDiff(originalPath, conflictPath);
	}
}
