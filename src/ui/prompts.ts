/**
 * Inquirer-based interactive prompts for conflict resolution.
 */

import inquirer from "inquirer";
import type { ConflictPair } from "../core/scanner.js";
import type { ResolveChoice } from "../core/resolver.js";

export interface PromptAction {
	choice: ResolveChoice;
	viewDiff?: boolean;
	quit?: boolean;
}

/**
 * Prompt the user to choose an action for a conflict pair.
 */
export async function promptConflictAction(
	pair: ConflictPair,
	index: number,
	total: number,
): Promise<PromptAction> {
	const { meta, originalSize, conflictSize, originalMtime, conflictMtime, originalExists } = pair;

	console.log("");
	console.log("═".repeat(60));
	console.log(
		`Conflict: ${meta.originalName} (${index + 1}/${total})`,
	);
	if (!originalExists) {
		console.log("  ⚠ Original file missing (orphan conflict)");
	}
	console.log(
		`  Original:  ${formatSize(originalSize)}  modified ${formatDate(originalMtime)}`,
	);
	console.log(
		`  Conflict:  ${formatSize(conflictSize)}  modified ${formatDate(conflictMtime)}`,
	);
	console.log("═".repeat(60));

	const { action } = await inquirer.prompt<{
		action: string;
	}>([
		{
			type: "list",
			name: "action",
			message: "Choose action:",
			choices: [
				{ name: "View diff", value: "diff" },
				{ name: "Keep original", value: "original" },
				{ name: "Keep conflict version", value: "conflict" },
				{ name: "Keep both", value: "both" },
				{ name: "Skip", value: "skip" },
				{ name: "Quit", value: "quit" },
			],
		},
	]);

	if (action === "diff") {
		return { choice: "skip", viewDiff: true };
	}
	if (action === "quit") {
		return { choice: "skip", quit: true };
	}

	return { choice: action as ResolveChoice };
}

/**
 * Prompt for auto-resolve strategy confirmation.
 */
export async function promptAutoConfirm(
	strategy: string,
	count: number,
): Promise<boolean> {
	const { confirm } = await inquirer.prompt<{
		confirm: boolean;
	}>([
		{
			type: "confirm",
			name: "confirm",
			message: `Auto-resolve ${count} conflicts using "${strategy}" strategy?`,
			default: false,
		},
	]);
	return confirm;
}

function formatSize(bytes: number): string {
	if (bytes === 0) return "0B";
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDate(date: Date | null): string {
	if (!date) return "N/A";
	return date.toISOString().replace("T", " ").substring(0, 19);
}
