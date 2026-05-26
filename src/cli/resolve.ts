/**
 * `stc resolve` command — interactively resolve conflicts.
 */

import type { Command } from "commander";
import chalk from "chalk";
import { scanConflicts, type ScanOptions } from "../core/scanner.js";
import { resolveConflict } from "../core/resolver.js";
import { promptConflictAction } from "../ui/prompts.js";
import { viewDiff } from "../ui/diff-viewer.js";

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

	console.log(
		chalk.bold(`Found ${pairs.length} conflict${pairs.length > 1 ? "s" : ""}. Starting interactive resolution...`),
	);

	let resolved = 0;
	let skipped = 0;

	for (let i = 0; i < pairs.length; i++) {
		const pair = pairs[i];

		// eslint-disable-next-line no-constant-condition
		while (true) {
			const action = await promptConflictAction(pair, i, pairs.length);

			if (action.quit) {
				console.log(
					chalk.yellow(`\nQuit. Resolved ${resolved}, skipped ${skipped}, remaining ${pairs.length - i - 1}.`),
				);
				return;
			}

			if (action.viewDiff) {
				if (options.diffTool) {
					const { viewDiffExternal } = await import("../ui/diff-viewer.js");
					viewDiffExternal(
						pair.meta.originalPath,
						pair.meta.conflictPath,
						options.diffTool,
					);
				} else {
					viewDiff(pair.meta.originalPath, pair.meta.conflictPath);
				}
				continue; // Re-prompt after viewing diff
			}

			if (action.choice === "skip") {
				skipped++;
				console.log(chalk.gray("Skipped."));
				break;
			}

			const result = resolveConflict(pair, action.choice);
			if (result.success) {
				resolved++;
				console.log(
					chalk.green(`✓ Resolved: kept ${action.choice}`),
				);
			} else {
				console.log(
					chalk.red(`✗ Failed: ${result.error}`),
				);
			}
			break;
		}
	}

	console.log(
		chalk.bold(
			`\nDone! Resolved ${resolved}, skipped ${skipped}.`,
		),
	);
}
