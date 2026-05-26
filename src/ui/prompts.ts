/**
 * Inquirer-based interactive prompts for conflict resolution.
 */

import inquirer from "inquirer";
import type { ConflictPair } from "../core/scanner.js";
import type { ResolveChoice, GroupTarget } from "../core/resolver.js";

export interface PromptAction {
	choice: ResolveChoice;
	viewDiff?: boolean;
	viewDiffConflictIndex?: number;
	quit?: boolean;
}

export interface GroupPromptAction {
	target: GroupTarget;
	viewDiff?: boolean;
	viewDiffConflictIndex?: number;
	quit?: boolean;
}

/**
 * Prompt the user to choose an action for a group of conflicts sharing the same original.
 */
export async function promptGroupAction(
	pairs: ConflictPair[],
	groupIndex: number,
	totalGroups: number,
): Promise<GroupPromptAction> {
	const firstPair = pairs[0]!;
	const { meta, originalExists, originalSize, originalMtime } = firstPair;

	console.log("");
	console.log("═".repeat(60));
	console.log(
		`Conflict group ${groupIndex + 1}/${totalGroups}: ${meta.originalName}`,
	);
	console.log(`  ${pairs.length} conflict version${pairs.length > 1 ? "s" : ""}`);
	if (!originalExists) {
		console.log("  ⚠ Original file missing (orphan conflict)");
	}
	console.log("");

	// List all versions
	if (originalExists) {
		console.log(
			`  [O] Original   ${formatSize(originalSize)}  modified ${formatDate(originalMtime)}`,
		);
	}
	for (let i = 0; i < pairs.length; i++) {
		const p = pairs[i]!;
		console.log(
			`  [${i + 1}] ${p.meta.deviceId}  ${formatSize(p.conflictSize)}  modified ${formatDate(p.conflictMtime)}`,
		);
	}
	console.log("═".repeat(60));

	const choices: Array<{ name: string; value: string }> = [];

	// View diff options
	if (originalExists) {
		for (let i = 0; i < pairs.length; i++) {
			choices.push({
				name: `Diff: original vs conflict #${i + 1} (${pairs[i]!.meta.deviceId})`,
				value: `diff:${i}`,
			});
		}
	}
	if (pairs.length > 1) {
		choices.push({
			name: "Diff: conflict #1 vs conflict #2",
			value: "diff:0vs1",
		});
	}

	// Keep options
	if (originalExists) {
		choices.push({ name: "Keep original", value: "original" });
	}
	for (let i = 0; i < pairs.length; i++) {
		choices.push({
			name: `Keep conflict #${i + 1} (${pairs[i]!.meta.deviceId})`,
			value: `conflict:${i}`,
		});
	}

	choices.push({ name: "Skip", value: "skip" });
	choices.push({ name: "Quit", value: "quit" });

	const { action } = await inquirer.prompt<{
		action: string;
	}>([
		{
			type: "list",
			name: "action",
			message: "Choose action:",
			choices,
		},
	]);

	if (action === "quit") {
		return { target: { type: "skip" }, quit: true };
	}
	if (action === "skip") {
		return { target: { type: "skip" } };
	}
	if (action === "original") {
		return { target: { type: "original" } };
	}
	if (action.startsWith("conflict:")) {
		const idx = Number.parseInt(action.split(":")[1]!, 10);
		return { target: { type: "conflict", conflictIndex: idx } };
	}
	if (action.startsWith("diff:")) {
		const diffArg = action.split(":")[1]!;
		if (diffArg.includes("vs")) {
			// diff between two conflict files
			const [a, b] = diffArg.split("vs").map(Number);
			return {
				target: { type: "skip" },
				viewDiff: true,
				viewDiffConflictIndex: a,
			};
		}
		const idx = Number.parseInt(diffArg, 10);
		return {
			target: { type: "skip" },
			viewDiff: true,
			viewDiffConflictIndex: idx,
		};
	}

	return { target: { type: "skip" } };
}

/**
 * Prompt the user to choose an action for a single conflict pair (simple 1v1).
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
			message: `Auto-resolve ${count} conflict group${count > 1 ? "s" : ""} using "${strategy}" strategy?`,
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
