/**
 * `stc resolve` command — interactively resolve conflicts.
 *
 * Groups conflicts by original file, so multiple conflicts
 * for the same file are resolved together atomically.
 */

import { createInterface } from "node:readline";
import { copyFileSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import chalk from "chalk";
import type { Command } from "commander";
import { generateSideBySideDiff } from "../core/differ.js";
import { applyMergedPair, resolveConflict, resolveGroup } from "../core/resolver.js";
import {
	type ConflictPair,
	groupByOriginal,
	type ScanOptions,
	scanConflicts,
} from "../core/scanner.js";
import { mergeWithIdea, mergeWithStcMerge, resolveIdeaCommand, resolveStcMergeCommand, viewDiffExternal } from "../ui/diff-viewer.js";
import { promptConflictAction, promptGroupAction } from "../ui/prompts.js";

export function registerResolveCommand(program: Command): void {
	program
		.command("resolve [dir]")
		.description("Interactively resolve Syncthing conflicts")
		.option("--sort <field>", "Sort by: time, size, name", "time")
		.option("--exclude <patterns>", "Comma-separated exclude patterns")
		.option("--depth <n>", "Max recursion depth", Number.parseInt)
		.option("--diff-tool <command>", "External diff tool command (e.g. code --diff, idea)")
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
	/** Native stc-merge dialog detected */
	stcMerge?: boolean;
	/** Set once before the interactive loop: IDEA CLI detected */
	ideaMerge?: boolean;
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

	// IDEA merge available whenever the IDEA CLI launcher is detected (no flag needed)
	options.ideaMerge = resolveIdeaCommand() !== null;
	options.stcMerge = resolveStcMergeCommand() !== null;

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

const MERGE_PENDING = "<<< stc: accept a side or edit below, then click Apply >>>\n";

/**
 * IDEA merge session: walk through pairs one by one. Each pair opens a merge
 * window pre-seeded with the original; when the user clicks Apply (mtime bump
 * — even if the result equals the original, e.g. accept-left) the merged
 * content is written back and the conflict removed. Enter in the terminal
 * skips the current pair; closing the window without applying waits for a
 * decision, with a 10-minute cap per pair.
 */
async function mergeIdeaSession(
	pairs: ConflictPair[],
	tool: "idea" | "stc",
): Promise<{ resolved: number; skipped: number }> {
	let resolved = 0;
	let skipped = 0;

	for (let i = 0; i < pairs.length; i++) {
		const pair = pairs[i];
		if (!pair?.originalExists) {
			skipped++;
			continue;
		}
		console.log(chalk.bold(`\nMerging ${i + 1}/${pairs.length}: ${pair.meta.originalName}`));
		const applied = await mergeIdeaPair(pair, tool);
		if (applied) resolved++;
		else skipped++;
	}
	return { resolved, skipped };
}

async function mergeIdeaPair(pair: ConflictPair, tool: "idea" | "stc"): Promise<boolean> {
	const mergedPath = `${pair.meta.originalPath}.stc-merged`;
	writeFileSync(mergedPath, MERGE_PENDING);

	console.log(
		chalk.gray(
			"中间结果栏首行是 stc 占位标记：接受任一侧或编辑掉它 → 点「应用」保存；Enter = 跳过此文件。",
		),
	);

	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const skipSignal = new Promise<string>((resolve) => {
		rl.question("(Enter = skip this file) ", () => {
			rl.close();
			resolve("skip");
		});
	});

	const mergeSignal = (async (): Promise<string | null> => {
		if (tool === "idea") {
			await mergeWithIdea(pair.meta.originalPath, pair.meta.conflictPath, mergedPath);
		} else {
			await mergeWithStcMerge(pair.meta.originalPath, pair.meta.conflictPath, mergedPath);
		}
		// IDEA skips writing when the result document is unmodified (e.g. accept-left
		// on an output seeded with the original), so seed a marker instead: any
		// Apply must write something different from it.
		for (let i = 0; i < 1200; i++) {
			try {
				const content = readFileSync(mergedPath, "utf8");
				if (content !== MERGE_PENDING) {
					rl.close();
					return content;
				}
			} catch {
				// briefly locked mid-write — keep polling
			}
			await new Promise((resolve) => setTimeout(resolve, 400));
		}
		rl.close();
		return null;
	})();

	const outcome = await Promise.race([
		mergeSignal.then((content) => ({ kind: "applied" as const, content })),
		skipSignal.then(() => ({ kind: "skip" as const, content: null })),
	]);

	rl.close();
	let applied = false;
	if (outcome.kind === "applied" && outcome.content !== null) {
		const result = applyMergedPair(pair, mergedPath);
		if (result.success) {
			applied = true;
			const keptOriginal = readFileSync(pair.meta.originalPath, "utf8") === outcome.content;
			console.log(
				chalk.green(
					keptOriginal
						? "✓ Resolved: kept original content (accept-left), conflict file removed"
						: "✓ Resolved: merged content saved, conflict file removed",
				),
			);
		} else {
			console.log(chalk.red(`✗ Failed to apply merge: ${result.error}`));
		}
	} else {
		console.log(chalk.gray("Skipped — conflict kept."));
	}
	try {
		unlinkSync(mergedPath);
	} catch {
		// cleanup best-effort
	}
	return applied;
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
		const action = await promptConflictAction(
			pair,
			groupIndex,
			totalGroups,
			options.ideaMerge === true,
			options.stcMerge === true,
		);

		if (action.quit) return { status: "quit" };

		if (action.viewDiff) {
			showDiff(pair.meta.originalPath, pair.meta.conflictPath, options.diffTool);
			await pressEnterToContinue();
			continue;
		}

		if (action.ideaMerge) {
			const sessionPairs = orderPairsForGuiSession(remainingPairs, pair);
			const mergeResult = await mergeIdeaSession(sessionPairs, "idea");
			console.log(
				chalk.green(
					`✓ IDEA merge session ended: resolved ${mergeResult.resolved}, skipped ${mergeResult.skipped}`,
				),
			);
			return { status: "gui", resolved: mergeResult.resolved, skipped: mergeResult.skipped };
		}

		if (action.stcMerge) {
			const sessionPairs = orderPairsForGuiSession(remainingPairs, pair);
			const mergeResult = await mergeIdeaSession(sessionPairs, "stc");
			console.log(
				chalk.green(
					`✓ stc-merge session ended: resolved ${mergeResult.resolved}, skipped ${mergeResult.skipped}`,
				),
			);
			return { status: "gui", resolved: mergeResult.resolved, skipped: mergeResult.skipped };
		}

		if (action.choice === "skip") {
			console.log(chalk.gray("Skipped."));
			return { status: "skipped" };
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
		const action = await promptGroupAction(
			pairs,
			groupIndex,
			totalGroups,
			options.ideaMerge === true,
			options.stcMerge === true,
		);

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

		if (action.ideaMergeConflictIndex !== undefined) {
			const ideaPair = pairs[action.ideaMergeConflictIndex];
			if (ideaPair) {
				const sessionPairs = orderPairsForGuiSession(remainingPairs, ideaPair);
				const mergeResult = await mergeIdeaSession(sessionPairs, "idea");
				console.log(
					chalk.green(
						`✓ IDEA merge session ended: resolved ${mergeResult.resolved}, skipped ${mergeResult.skipped}`,
					),
				);
				return {
					status: "gui",
					resolved: mergeResult.resolved,
					skipped: mergeResult.skipped,
				};
			}
			continue;
		}

		if (action.stcMergeConflictIndex !== undefined) {
			const stcPair = pairs[action.stcMergeConflictIndex];
			if (stcPair) {
				const sessionPairs = orderPairsForGuiSession(remainingPairs, stcPair);
				const mergeResult = await mergeIdeaSession(sessionPairs, "stc");
				console.log(
					chalk.green(
						`✓ stc-merge session ended: resolved ${mergeResult.resolved}, skipped ${mergeResult.skipped}`,
					),
				);
				return {
					status: "gui",
					resolved: mergeResult.resolved,
					skipped: mergeResult.skipped,
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
