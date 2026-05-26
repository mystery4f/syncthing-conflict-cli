/**
 * Terminal diff viewer with color highlighting.
 */

import { execSync } from "node:child_process";
import chalk from "chalk";
import { generateDiff } from "../core/differ.js";

/**
 * Display a diff between two files in the terminal.
 */
export function viewDiff(originalPath: string, conflictPath: string): void {
	const result = generateDiff(originalPath, conflictPath);

	console.log("");
	console.log(chalk.bold("--- Diff ---"));
	console.log(chalk.cyan(`  Original: ${originalPath}`));
	console.log(chalk.cyan(`  Conflict: ${conflictPath}`));
	console.log("");

	if (result.identical) {
		console.log(chalk.green("Files are identical."));
		return;
	}

	if (result.added >= 0 && result.removed >= 0) {
		console.log(
			chalk.green(`+${result.added} lines added`),
			chalk.red(`-${result.removed} lines removed`),
		);
	}

	console.log("");
	console.log(result.formatted);
	console.log("");
}

/**
 * View diff using an external tool.
 */
export function viewDiffExternal(
	originalPath: string,
	conflictPath: string,
	tool: string,
): void {
	const cmd = `${tool} "${originalPath}" "${conflictPath}"`;
	try {
		execSync(cmd, { stdio: "inherit" });
	} catch (err) {
		console.error(`Failed to launch diff tool: ${tool}`);
		console.error(err);
	}
}
