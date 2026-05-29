/**
 * `stc resolve` command — interactively resolve conflicts.
 *
 * Groups conflicts by original file, so multiple conflicts
 * for the same file are resolved together atomically.
 */

import { createInterface } from "node:readline";
import chalk from "chalk";
import type { Command } from "commander";
import { generateSideBySideDiff } from "../core/differ.js";
import { resolveConflict, resolveGroup } from "../core/resolver.js";
import {
	type ConflictPair,
	groupByOriginal,
	type ScanOptions,
	scanConflicts,
} from "../core/scanner.js";
import { viewDiffExternal } from "../ui/diff-viewer.js";
import { mergeGuiSession } from "../ui/merger.js";
import { promptConflictAction, promptGroupAction } from "../ui/prompts.js";

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

type HandleResult =
	| { status: "resolved" | "skipped" | "quit" }
	| { status: "gui"; resolved: number; skipped: number; error?: string };

async function runResolve(directory: string, options: ResolveCommandOptions): Promise<void> {
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
		const entry = groupEntries[gi];
		if (!entry) continue;
		const [, groupPairs] = entry;
		const remainingPairs = groupEntries.slice(gi).flatMap(([, pairs]) => pairs);
		const firstPair = groupPairs[0];
		if (!firstPair) continue;

		let result: HandleResult;

		if (groupPairs.length === 1) {
			result = await handleSinglePair(firstPair, gi, groupEntries.length, options, remainingPairs);
		} else {
			result = await handleGroup(groupPairs, gi, groupEntries.length, options, remainingPairs);
		}

		if (result.status === "quit") break;
		if (result.status === "gui") {
			resolved += result.resolved;
			skipped += result.skipped;
			if (result.error) console.log(chalk.red(`✗ GUI session failed: ${result.error}`));
			break;
		}
		if (result.status === "resolved") resolved += groupPairs.length;
		else skipped += groupPairs.length;
	}

	console.log(chalk.bold(`\nDone! Resolved ${resolved}, skipped ${skipped}.`));
}

async function handleSinglePair(
	pair: ConflictPair,
	groupIndex: number,
	totalGroups: number,
	options: ResolveCommandOptions,
	remainingPairs: ConflictPair[],
): Promise<HandleResult> {
	// Show diff summary
	if (pair.originalExists) {
		showDiffSummary(pair.meta.originalPath, pair.meta.conflictPath);
	}

	for (;;) {
		const action = await promptConflictAction(pair, groupIndex, totalGroups);

		if (action.quit) return { status: "quit" };

		if (action.viewDiff) {
			showDiff(pair.meta.originalPath, pair.meta.conflictPath, options.diffTool);
			await pressEnterToContinue();
			continue;
		}

		if (action.choice === "skip") {
			console.log(chalk.gray("Skipped."));
			return { status: "skipped" };
		}

		if (action.choice === "merge") {
			const sessionPairs = orderPairsForGuiSession(remainingPairs, pair);
			const mergeResult = await mergeGuiSession(sessionPairs);
			console.log(
				chalk.green(
					`✓ GUI session ended: resolved ${mergeResult.resolved}, skipped ${mergeResult.skipped}`,
				),
			);
			return {
				status: "gui",
				resolved: mergeResult.resolved,
				skipped: mergeResult.skipped,
				error: mergeResult.error,
			};
		}

		const result = resolveConflict(pair, action.choice);
		if (result.success) {
			console.log(chalk.green(`✓ Resolved: kept ${action.choice}`));
			return { status: "resolved" };
		}
		console.log(chalk.red(`✗ Failed: ${result.error}`));
		return { status: "skipped" };
	}
}

async function handleGroup(
	pairs: ConflictPair[],
	groupIndex: number,
	totalGroups: number,
	options: ResolveCommandOptions,
	remainingPairs: ConflictPair[],
): Promise<HandleResult> {
	// Show diff summary of the first conflict
	const firstPair = pairs[0];
	if (firstPair?.originalExists) {
		showDiffSummary(firstPair.meta.originalPath, firstPair.meta.conflictPath);
	}

	for (;;) {
		const action = await promptGroupAction(pairs, groupIndex, totalGroups);

		if (action.quit) return { status: "quit" };

		if (action.viewDiff) {
			const idx = action.viewDiffConflictIndex ?? 0;
			const conflictPair = pairs[idx];
			if (conflictPair) {
				showDiff(conflictPair.meta.originalPath, conflictPair.meta.conflictPath, options.diffTool);
				await pressEnterToContinue();
			}
			continue;
		}

		if (action.mergeConflictIndex !== undefined) {
			const mergePair = pairs[action.mergeConflictIndex];
			if (mergePair) {
				const sessionPairs = orderPairsForGuiSession(remainingPairs, mergePair);
				const mergeResult = await mergeGuiSession(sessionPairs);
				console.log(
					chalk.green(
						`✓ GUI session ended: resolved ${mergeResult.resolved}, skipped ${mergeResult.skipped}`,
					),
				);
				return {
					status: "gui",
					resolved: mergeResult.resolved,
					skipped: mergeResult.skipped,
					error: mergeResult.error,
				};
			}
			continue;
		}

		if (action.target.type === "skip") {
			console.log(chalk.gray("Skipped."));
			return { status: "skipped" };
		}

		const result = resolveGroup(pairs, action.target);
		if (result.success) {
			const desc =
				action.target.type === "original"
					? "original"
					: `conflict #${action.target.conflictIndex + 1}`;
			console.log(chalk.green(`✓ Resolved ${pairs.length} conflicts: kept ${desc}`));
			return { status: "resolved" };
		}
		console.log(chalk.red(`✗ Failed: ${result.error}`));
		return { status: "skipped" };
	}
}

function orderPairsForGuiSession(pairs: ConflictPair[], firstPair: ConflictPair): ConflictPair[] {
	return [
		firstPair,
		...pairs.filter((pair) => pair.meta.conflictPath !== firstPair.meta.conflictPath),
	];
}

function showDiff(originalPath: string, conflictPath: string, diffTool?: string): void {
	// Use VS Code diff by default; fallback to terminal side-by-side
	if (diffTool) {
		viewDiffExternal(originalPath, conflictPath, diffTool);
	} else {
		viewDiffExternal(originalPath, conflictPath, "code --diff");
	}
}

function showDiffSummary(originalPath: string, conflictPath: string): void {
	const result = generateSideBySideDiff(originalPath, conflictPath);
	if (result.isText && !result.identical) {
		console.log(
			chalk.dim(
				`  Diff: ${chalk.green(`+${result.added}`)} ${chalk.red(`-${result.removed}`)} lines changed`,
			),
		);
	}
}

function pressEnterToContinue(): Promise<void> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(chalk.dim("  Press Enter to continue..."), () => {
			rl.close();
			resolve();
		});
	});
}
