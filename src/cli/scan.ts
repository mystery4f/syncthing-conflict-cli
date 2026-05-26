/**
 * `stc scan` command — scan for Syncthing conflict files.
 */

import type { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { scanConflicts, groupByDirectory, type ScanOptions } from "../core/scanner.js";

export function registerScanCommand(program: Command): void {
	program
		.command("scan [dir]")
		.description("Scan for Syncthing conflict files")
		.option("--sort <field>", "Sort by: time, size, name", "time")
		.option("--no-group", "Don't group by directory")
		.option("--exclude <patterns>", "Comma-separated exclude patterns")
		.option("--depth <n>", "Max recursion depth", Number.parseInt)
		.option("--json", "Output as JSON")
		.action(async (dir: string, options: ScanCommandOptions) => {
			const directory = dir || ".";
			await runScan(directory, options);
		});
}

interface ScanCommandOptions {
	sort?: string;
	group?: boolean;
	exclude?: string;
	depth?: number;
	json?: boolean;
}

async function runScan(directory: string, options: ScanCommandOptions): Promise<void> {
	const scanOptions: ScanOptions = {
		directory,
		sort: (options.sort as ScanOptions["sort"]) ?? "time",
		exclude: options.exclude?.split(","),
		depth: options.depth,
	};

	const pairs = await scanConflicts(scanOptions);

	if (options.json) {
		console.log(JSON.stringify(pairs, null, 2));
		return;
	}

	if (pairs.length === 0) {
		console.log(chalk.green("No conflict files found."));
		return;
	}

	console.log(
		chalk.bold(`Found ${pairs.length} conflict${pairs.length > 1 ? "s" : ""}`),
	);

	if (options.group !== false) {
		const groups = groupByDirectory(pairs);
		for (const [dir, groupPairs] of groups) {
			console.log("");
			console.log(chalk.cyan(`${dir || "."}/`));

			// Sub-group by original file
			const byOriginal = new Map<string, typeof groupPairs>();
			for (const p of groupPairs) {
				const existing = byOriginal.get(p.meta.originalName) ?? [];
				existing.push(p);
				byOriginal.set(p.meta.originalName, existing);
			}

			for (const [name, filePairs] of byOriginal) {
				console.log(`  ├── ${chalk.bold(name)} (${filePairs.length} conflict${filePairs.length > 1 ? "s" : ""})`);
				for (const fp of filePairs) {
					const size = formatSize(fp.conflictSize);
					const date = fp.meta.conflictDate.toISOString().substring(0, 10);
					const orphan = !fp.originalExists ? chalk.yellow(" [orphan]") : "";
					console.log(`  │   ├── ${fp.meta.conflictPath.split(/[/\\]/).pop()}  ${size}  ${date}${orphan}`);
				}
			}
		}
	} else {
		// Table output
		const table = new Table({
			head: ["File", "Conflict", "Size", "Date", "Status"],
			style: { head: ["cyan"] },
		});

		for (const pair of pairs) {
			table.push([
				pair.meta.originalName,
				pair.meta.conflictPath.split(/[/\\]/).pop(),
				formatSize(pair.conflictSize),
				pair.meta.conflictDate.toISOString().substring(0, 10),
				pair.originalExists ? "paired" : chalk.yellow("orphan"),
			]);
		}
		console.log(table.toString());
	}

	console.log("");
	console.log(chalk.gray('Use "stc resolve" to resolve interactively'));
}

function formatSize(bytes: number): string {
	if (bytes === 0) return "0B";
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
