/**
 * Simple readline-based interactive prompts for conflict resolution.
 * No inquirer dependency — works in all terminals.
 */

import { createInterface } from "node:readline";
import type { GroupTarget, ResolveChoice } from "../core/resolver.js";
import type { ConflictPair } from "../core/scanner.js";

export interface PromptAction {
	choice: ResolveChoice;
	viewDiff?: boolean;
	viewDiffConflictIndex?: number;
	ideaMerge?: boolean;
	quit?: boolean;
}

export interface GroupPromptAction {
	target: GroupTarget;
	viewDiff?: boolean;
	viewDiffConflictIndex?: number;
	mergeConflictIndex?: number;
	ideaMergeConflictIndex?: number;
	quit?: boolean;
}

/**
 * Ask the user to pick from numbered choices.
 * Returns the value of the selected choice, or null if quit.
 */
async function numberedPrompt(
	choices: Array<{ name: string; value: string }>,
): Promise<string | null> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });

	return new Promise((resolve) => {
		for (let i = 0; i < choices.length; i++) {
			const choice = choices[i];
			if (choice) console.log(`  ${i + 1}) ${choice.name}`);
		}
		console.log("");

		rl.question(`  Enter number (1-${choices.length}): `, (answer) => {
			rl.close();
			const num = Number.parseInt(answer.trim(), 10);
			if (num >= 1 && num <= choices.length) {
				const selected = choices[num - 1];
				resolve(selected?.value ?? "skip");
			} else {
				console.log("  Invalid choice. Skipping.");
				resolve("skip");
			}
		});
	});
}

/**
 * Prompt the user to choose an action for a group of conflicts sharing the same original.
 */
export async function promptGroupAction(
	pairs: ConflictPair[],
	groupIndex: number,
	totalGroups: number,
	ideaMerge = false,
): Promise<GroupPromptAction> {
	const firstPair = pairs[0];
	if (!firstPair) return { target: { type: "skip" }, quit: true };
	const { meta, originalExists, originalSize, originalMtime } = firstPair;

	console.log("");
	console.log("═".repeat(60));
	console.log(`Conflict group ${groupIndex + 1}/${totalGroups}: ${meta.originalName}`);
	console.log(`  ${pairs.length} conflict version${pairs.length > 1 ? "s" : ""}`);
	if (!originalExists) {
		console.log("  ⚠ Original file missing (orphan conflict)");
	}
	console.log("");

	if (originalExists) {
		console.log(
			`  [O] Original   ${formatSize(originalSize)}  modified ${formatDate(originalMtime)}`,
		);
	}
	for (let i = 0; i < pairs.length; i++) {
		const p = pairs[i];
		if (!p) continue;
		console.log(
			`  [${i + 1}] ${p.meta.deviceId}  ${formatSize(p.conflictSize)}  modified ${formatDate(p.conflictMtime)}`,
		);
	}
	console.log("═".repeat(60));

	// Step 1: Choose operation (keeps menu small regardless of conflict count)
	const mainChoices: Array<{ name: string; value: string }> = [];

	if (originalExists) {
		mainChoices.push({ name: "View diff (pick version next)", value: "act:diff" });
		mainChoices.push({ name: "Keep original", value: "original" });
		mainChoices.push({ name: "Keep a conflict version (pick next)", value: "act:keep" });
		if (ideaMerge) {
			mainChoices.push({ name: "Merge in IDEA (pick version next)", value: "act:idea-merge" });
		}
		mainChoices.push({
			name: "Merge via browser GUI (pick first version next)",
			value: "act:merge",
		});
	} else {
		// Orphan: only keep options
		for (let i = 0; i < pairs.length; i++) {
			const p = pairs[i];
			if (!p) continue;
			mainChoices.push({
				name: `Keep conflict #${i + 1} (${p.meta.deviceId})`,
				value: `conflict:${i}`,
			});
		}
	}
	mainChoices.push({ name: "Skip", value: "skip" });
	mainChoices.push({ name: "Quit", value: "quit" });

	const action = await numberedPrompt(mainChoices);
	if (!action) return { target: { type: "skip" }, quit: true };

	if (action === "quit") return { target: { type: "skip" }, quit: true };
	if (action === "skip") return { target: { type: "skip" } };
	if (action === "original") return { target: { type: "original" } };
	if (action.startsWith("conflict:")) {
		return { target: { type: "conflict", conflictIndex: Number(action.split(":")[1]) } };
	}

	// Step 2: Pick which conflict version
	if (action === "act:diff" || action === "act:keep" || action === "act:merge" || action === "act:idea-merge") {
		const versionChoices: Array<{ name: string; value: string }> = [];
		for (let i = 0; i < pairs.length; i++) {
			const p = pairs[i];
			if (!p) continue;
			versionChoices.push({
				name: `#${i + 1} ${p.meta.deviceId}  ${formatSize(p.conflictSize)}  ${formatDate(p.conflictMtime)}`,
				value: `v:${i}`,
			});
		}
		versionChoices.push({ name: "Cancel", value: "skip" });

		const choice = await numberedPrompt(versionChoices);
		if (!choice || choice === "skip") return { target: { type: "skip" } };

		const idx = Number(choice.split(":")[1]);
		if (action === "act:diff") {
			return { target: { type: "skip" }, viewDiff: true, viewDiffConflictIndex: idx };
		}
		if (action === "act:keep") {
			return { target: { type: "conflict", conflictIndex: idx } };
		}
		if (action === "act:merge") {
			return { target: { type: "skip" }, mergeConflictIndex: idx };
		}
		if (action === "act:idea-merge") {
			return { target: { type: "skip" }, ideaMergeConflictIndex: idx };
		}
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
	ideaMerge = false,
): Promise<PromptAction> {
	const { meta, originalSize, conflictSize, originalMtime, conflictMtime, originalExists } = pair;

	console.log("");
	console.log("═".repeat(60));
	console.log(`Conflict: ${meta.originalName} (${index + 1}/${total})`);
	if (!originalExists) {
		console.log("  ⚠ Original file missing (orphan conflict)");
	}
	console.log(`  Original:  ${formatSize(originalSize)}  modified ${formatDate(originalMtime)}`);
	console.log(`  Conflict:  ${formatSize(conflictSize)}  modified ${formatDate(conflictMtime)}`);
	console.log("═".repeat(60));

	const choices: Array<{ name: string; value: string }> = [];

	if (originalExists) {
		choices.push({ name: "View diff", value: "diff" });
		choices.push({ name: "Keep original", value: "original" });
	}

	choices.push({
		name: originalExists ? "Keep conflict version" : "Rename conflict to original",
		value: "conflict",
	});

	if (originalExists) {
		choices.push({ name: "Keep both", value: "both" });
		if (ideaMerge) choices.push({ name: "Merge in IDEA", value: "idea-merge" });
		choices.push({ name: "Merge via browser GUI", value: "merge" });
	}

	choices.push({ name: "Delete conflict file", value: "delete" });
	choices.push({ name: "Skip", value: "skip" });
	choices.push({ name: "Quit", value: "quit" });

	const action = await numberedPrompt(choices);
	if (!action) return { choice: "skip", quit: true };

	if (action === "diff") return { choice: "skip", viewDiff: true };
	if (action === "quit") return { choice: "skip", quit: true };
	if (action === "delete") return { choice: "delete" as ResolveChoice };
	if (action === "merge") return { choice: "merge" as ResolveChoice };
	if (action === "idea-merge") return { choice: "skip", ideaMerge: true };

	return { choice: action as ResolveChoice };
}

/**
 * Prompt for auto-resolve strategy confirmation.
 */
export async function promptAutoConfirm(strategy: string, count: number): Promise<boolean> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });

	return new Promise((resolve) => {
		rl.question(
			`Auto-resolve ${count} conflict group${count > 1 ? "s" : ""} using "${strategy}" strategy? (y/N): `,
			(answer) => {
				rl.close();
				resolve(answer.trim().toLowerCase() === "y");
			},
		);
	});
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
