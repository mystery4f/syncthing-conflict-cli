/**
 * Conflict resolution logic.
 */

import { copyFileSync, mkdirSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ConflictPair } from "./scanner.js";

export type ResolveChoice = "original" | "conflict" | "both" | "skip";

export interface ResolveResult {
	/** The conflict pair that was resolved */
	pair: ConflictPair;
	/** The choice made */
	choice: ResolveChoice;
	/** Whether the resolution succeeded */
	success: boolean;
	/** Error message if failed */
	error?: string;
}

export interface ResolveOptions {
	/** Whether to create backups before resolving */
	backup?: boolean;
	/** Directory for backups (default: .stc-backup in the scan directory) */
	backupDir?: string;
}

const DEFAULT_BACKUP_DIR = ".stc-backup";

/**
 * Resolve a single conflict pair.
 */
export function resolveConflict(
	pair: ConflictPair,
	choice: ResolveChoice,
	options: ResolveOptions = {},
): ResolveResult {
	const { backup = true, backupDir } = options;

	try {
		switch (choice) {
			case "original":
				return keepOriginal(pair, backup, backupDir);
			case "conflict":
				return keepConflict(pair, backup, backupDir);
			case "both":
				return keepBoth(pair);
			case "skip":
				return { pair, choice, success: true };
		}
	} catch (err) {
		return {
			pair,
			choice,
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Keep the original file, delete the conflict file.
 */
function keepOriginal(
	pair: ConflictPair,
	backup: boolean,
	backupDir?: string,
): ResolveResult {
	const conflictPath = pair.meta.conflictPath;

	if (backup) {
		backupFile(conflictPath, backupDir);
	}

	unlinkSync(conflictPath);

	return { pair, choice: "original", success: true };
}

/**
 * Keep the conflict file (rename to original name), delete the original.
 */
function keepConflict(
	pair: ConflictPair,
	backup: boolean,
	backupDir?: string,
): ResolveResult {
	const { originalPath, conflictPath } = pair.meta;

	// Backup original if it exists
	if (pair.originalExists && backup) {
		backupFile(originalPath, backupDir);
	}

	// If original exists, remove it
	if (pair.originalExists) {
		unlinkSync(originalPath);
	}

	// Rename conflict to original
	renameSync(conflictPath, originalPath);

	return { pair, choice: "conflict", success: true };
}

/**
 * Keep both files — rename conflict file to a descriptive name.
 */
function keepBoth(pair: ConflictPair): ResolveResult {
	const { originalPath, conflictPath, conflictDate } = pair.meta;

	// Generate a descriptive name for the conflict file
	const ext = originalPath.substring(originalPath.lastIndexOf("."));
	const base = originalPath.substring(0, originalPath.lastIndexOf("."));
	const dateStr = formatDate(conflictDate);
	const newPath = `${base}.conflict-${dateStr}${ext}`;

	// Only rename if the new path differs
	if (conflictPath !== newPath) {
		renameSync(conflictPath, newPath);
	}

	return { pair, choice: "both", success: true };
}

/**
 * Auto-resolve a conflict using the specified strategy.
 */
export function autoResolve(
	pair: ConflictPair,
	strategy: AutoStrategy,
	options: ResolveOptions = {},
): ResolveResult {
	const choice = getChoiceForStrategy(pair, strategy);
	return resolveConflict(pair, choice, options);
}

export type AutoStrategy =
	| "newest"
	| "oldest"
	| "largest"
	| "smallest"
	| "conflict"
	| "original";

function getChoiceForStrategy(pair: ConflictPair, strategy: AutoStrategy): ResolveChoice {
	switch (strategy) {
		case "conflict":
			return "conflict";
		case "original":
			return "original";
		case "newest":
		case "oldest": {
			if (!pair.originalMtime || !pair.conflictMtime) return "conflict";
			const origNewer = pair.originalMtime > pair.conflictMtime;
			return strategy === "newest"
				? (origNewer ? "original" : "conflict")
				: (origNewer ? "conflict" : "original");
		}
		case "largest":
		case "smallest": {
			const origLarger = pair.originalSize > pair.conflictSize;
			return strategy === "largest"
				? (origLarger ? "original" : "conflict")
				: (origLarger ? "conflict" : "original");
		}
	}
}

function backupFile(filePath: string, backupDir?: string): void {
	if (!existsSync(filePath)) return;

	const dir = backupDir ?? DEFAULT_BACKUP_DIR;
	const destDir = join(dirname(filePath), dir);

	mkdirSync(destDir, { recursive: true });

	const basename = filePath.split(/[/\\]/).pop()!;
	const dest = join(destDir, basename);

	// Avoid overwriting — append number if needed
	let finalDest = dest;
	let counter = 1;
	while (existsSync(finalDest)) {
		const ext = dest.substring(dest.lastIndexOf("."));
		const base = dest.substring(0, dest.lastIndexOf("."));
		finalDest = `${base}-${counter}${ext}`;
		counter++;
	}

	copyFileSync(filePath, finalDest);
}

function formatDate(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}${m}${d}`;
}
