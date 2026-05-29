/**
 * Terminal diff viewer with color highlighting.
 */

import { execSync } from "node:child_process";
import chalk from "chalk";
import { generateDiff, generateSideBySideDiff } from "../core/differ.js";

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

/**
 * Display a side-by-side diff between two files in the terminal.
 *
 * Layout:
 *   ┌──────────────────┐ ┌──────────────────┐
 *   │ Original (lineno) │ │ Conflict (lineno) │
 *   ├──────────────────┤ ├──────────────────┤
 *   │ ...              │ │ ...              │
 *   └──────────────────┘ └──────────────────┘
 */
export function viewSideBySideDiff(originalPath: string, conflictPath: string): void {
	const result = generateSideBySideDiff(originalPath, conflictPath);

	if (!result.isText) {
		viewDiff(originalPath, conflictPath);
		return;
	}

	const termWidth = process.stdout.columns || 80;
	const separator = " │ ";
	const sepWidth = separator.length;
	// Each side: line number (4) + space + content
	const lineNoWidth = 4;
	const gutterWidth = lineNoWidth + 1; // "  1 "
	// Split remaining width equally after removing gutters and separator
	const availableWidth = termWidth - gutterWidth * 2 - sepWidth;
	const contentWidth = Math.max(20, Math.floor(availableWidth / 2));

	const truncate = (s: string, maxLen: number): string => {
		if (s.length <= maxLen) return s.padEnd(maxLen);
		return `${s.substring(0, maxLen - 1)}…`;
	};

	const leftHeader = truncate("Original", contentWidth);
	const rightHeader = truncate("Conflict", contentWidth);
	const headerLineNo = "".padStart(lineNoWidth);

	// Header
	const headerBar = "─".repeat(gutterWidth + contentWidth);
	console.log("");
	console.log(
		chalk.dim("  "),
		chalk.bold.bgRgb(30, 30, 50)(` ${headerLineNo} ${leftHeader} `),
		chalk.dim(separator),
		chalk.bold.bgRgb(30, 30, 50)(` ${headerLineNo} ${rightHeader} `),
	);
	console.log(
		chalk.dim("  "),
		chalk.dim(headerBar),
		chalk.dim("─"),
		chalk.dim(headerBar),
	);

	// Stats line
	if (!result.identical) {
		const stats = `${chalk.green(`+${result.added}`)} ${chalk.red(`-${result.removed}`)}`;
		console.log(chalk.dim(`  ${stats} lines changed`));
		console.log("");
	}

	// Determine max line number for display
	const allLines = result.lines;
	if (allLines.length === 0) {
		console.log(chalk.dim("  (empty files)"));
		console.log("");
		return;
	}

	// Render lines, limit display if too many
	const MAX_DISPLAY_LINES = 40;
	const showLines = allLines.length > MAX_DISPLAY_LINES
		? [...allLines.slice(0, MAX_DISPLAY_LINES - 5), null, ...allLines.slice(-4)]
		: allLines;

	for (const line of showLines) {
		if (line === null) {
			// Omission indicator
			const omitted = allLines.length - MAX_DISPLAY_LINES + 5;
			const dots = ` ... ${omitted} lines omitted ...`.padEnd(contentWidth);
			console.log(
				chalk.dim("  "),
				chalk.dim(`${"".padStart(lineNoWidth)} ${dots}`),
				chalk.dim(separator),
				chalk.dim(`${"".padStart(lineNoWidth)} ${dots}`),
			);
			continue;
		}

		const origNo = line.origLineNo > 0 ? String(line.origLineNo).padStart(lineNoWidth) : "".padStart(lineNoWidth);
		const confNo = line.confLineNo > 0 ? String(line.confLineNo).padStart(lineNoWidth) : "".padStart(lineNoWidth);
		const origContent = truncate(line.origContent, contentWidth);
		const confContent = truncate(line.confContent, contentWidth);

		let leftStr: string;
		let rightStr: string;
		let sepStr: string;

		switch (line.status) {
			case "removed":
				leftStr = chalk.red(`${origNo} ${origContent}`);
				rightStr = chalk.dim(`${confNo} ${"".padEnd(contentWidth)}`);
				sepStr = chalk.red(separator);
				break;
			case "added":
				leftStr = chalk.dim(`${origNo} ${"".padEnd(contentWidth)}`);
				rightStr = chalk.green(`${confNo} ${confContent}`);
				sepStr = chalk.green(separator);
				break;
			case "equal":
			default:
				leftStr = chalk.dim(`${origNo} `) + origContent;
				rightStr = chalk.dim(`${confNo} `) + confContent;
				sepStr = chalk.dim(separator);
				break;
		}

		console.log("  ", leftStr, sepStr, rightStr);
	}

	console.log(
		chalk.dim("  "),
		chalk.dim(headerBar),
		chalk.dim("─"),
		chalk.dim(headerBar),
	);
	console.log("");
}
