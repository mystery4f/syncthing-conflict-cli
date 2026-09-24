/**
 * Conflict resolution logic.
 */

import { copyFileSync, mkdirSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ConflictPair } from "./scanner.js";

export type ResolveChoice = "original" | "conflict" | "both" | "skip" | "delete" | "merge";

/**
 * When multiple conflicts exist for the same original,
 * user picks one version to keep. Others are deleted (or kept).
 */
export type GroupTarget =
	| { type: "original" }
	| { type: "conflict"; conflictIndex: number }
	| { type: "skip" };

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

export interface GroupResolveResult {
	/** Number of files deleted */
	deleted: number;
	/** Number of files kept (renamed) */
	kept: number;
	/** Whether all operations succeeded */
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
 * Resolve a group of conflicts for the same original file atomically.
 *
 * @param pairs - All conflict pairs sharing the same original
 * @param target - Which version to keep
 * @param options - Resolve options
 */
export function resolveGroup(
	pairs: ConflictPair[],
	target: GroupTarget,
	options: ResolveOptions = {},
): GroupResolveResult {
	const { backup = true, backupDir } = options;

	if (pairs.length === 0) {
		return { deleted: 0, kept: 0, success: true };
	}

	const originalPath = pairs[0]!.meta.originalPath;
	const originalExists = pairs[0]!.originalExists;

	try {
		if (target.type === "skip") {
			return { deleted: 0, kept: 0, success: true };
		}

		// Determine which file becomes the "winner"
		let winnerPath: string;
		if (target.type === "original") {
			if (!originalExists) {
				return {
					deleted: 0,
					kept: 0,
					success: false,
					error: "Original file does not exist",
				};
			}
			winnerPath = originalPath;
		} else {
			const conflictPair = pairs[target.conflictIndex];
			if (!conflictPair) {
				return {
					deleted: 0,
					kept: 0,
					success: false,
					error: `Conflict index ${target.conflictIndex} out of range`,
				};
			}
			winnerPath = conflictPair.meta.conflictPath;
		}

		// Backup all files before any mutations
		if (backup) {
			if (originalExists) {
				backupFile(originalPath, backupDir);
			}
			for (const pair of pairs) {
				backupFile(pair.meta.conflictPath, backupDir);
			}
		}

		// Delete all conflict files
		for (const pair of pairs) {
			if (pair.meta.conflictPath !== winnerPath) {
				unlinkSync(pair.meta.conflictPath);
			}
		}

		// If winner is a conflict file, replace the original
		if (target.type === "conflict") {
			if (originalExists) {
				unlinkSync(originalPath);
			}
			renameSync(winnerPath, originalPath);
		}

		const deletedCount = pairs.length - (target.type === "conflict" ? 1 : 0) + (target.type === "conflict" && originalExists ? 1 : 0);
		return { deleted: deletedCount, kept: 1, success: true };
	} catch (err) {
		return {
			deleted: 0,
			kept: 0,
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Resolve a single conflict pair (simple 1v1 case).
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
			case "delete":
				return deleteConflict(pair, backup, backupDir);
			case "merge":
				return { pair, choice: "merge", success: true };
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

function keepConflict(
	pair: ConflictPair,
	backup: boolean,
	backupDir?: string,
): ResolveResult {
	const { originalPath, conflictPath } = pair.meta;

	if (pair.originalExists && backup) {
		backupFile(originalPath, backupDir);
	}

	if (pair.originalExists) {
		unlinkSync(originalPath);
	}

	renameSync(conflictPath, originalPath);

	return { pair, choice: "conflict", success: true };
}

function keepBoth(pair: ConflictPair): ResolveResult {
	const { originalPath, conflictPath, conflictDate, deviceId } = pair.meta;

	const ext = originalPath.substring(originalPath.lastIndexOf("."));
	const base = originalPath.substring(0, originalPath.lastIndexOf("."));
	const dateStr = formatDate(conflictDate);
	// Include device ID to avoid name collision when multiple conflicts share same date
	const newPath = `${base}.conflict-${dateStr}-${deviceId}${ext}`;

	if (conflictPath !== newPath) {
		renameSync(conflictPath, newPath);
	}

	return { pair, choice: "both", success: true };
}

function deleteConflict(
	pair: ConflictPair,
	backup: boolean,
	backupDir?: string,
): ResolveResult {
	const conflictPath = pair.meta.conflictPath;

	if (backup) {
		backupFile(conflictPath, backupDir);
	}

	unlinkSync(conflictPath);

	return { pair, choice: "delete", success: true };
}

/**
 * Auto-resolve a group of conflicts for the same original file.
 */
/**
 * Apply an externally merged result: write merged content to the original path
 * and remove the conflict file it was merged with. Other conflicts of the same
 * original are left untouched.
 */
export function applyMergedPair(
	pair: ConflictPair,
	mergedPath: string,
	options: ResolveOptions = {},
): ResolveResult {
	const { backup = true, backupDir } = options;
	const { originalPath, conflictPath } = pair.meta;

	try {
		if (pair.originalExists && backup) backupFile(originalPath, backupDir);
		copyFileSync(mergedPath, originalPath);
		if (backup) backupFile(conflictPath, backupDir);
		unlinkSync(conflictPath);
		return { pair, choice: "original", success: true };
	} catch (err) {
		return {
			pair,
			choice: "original",
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

export function autoResolveGroup(
	pairs: ConflictPair[],
	strategy: AutoStrategy,
	options: ResolveOptions = {},
): GroupResolveResult {
	if (pairs.length === 0) {
		return { deleted: 0, kept: 0, success: true };
	}

	const target = getGroupTarget(pairs, strategy);
	return resolveGroup(pairs, target, options);
}

/**
 * Auto-resolve a single conflict pair.
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

/**
 * Determine which version to keep for a group of conflicts.
 */
function getGroupTarget(pairs: ConflictPair[], strategy: AutoStrategy): GroupTarget {
	if (strategy === "original") {
		return { type: "original" };
	}
	if (strategy === "conflict") {
		// Pick the newest conflict version
		let newestIdx = 0;
		let newestTime = pairs[0]!.meta.conflictDate.getTime();
		for (let i = 1; i < pairs.length; i++) {
			const t = pairs[i]!.meta.conflictDate.getTime();
			if (t > newestTime) {
				newestTime = t;
				newestIdx = i;
			}
		}
		return { type: "conflict", conflictIndex: newestIdx };
	}

	// For time/size strategies, compare original against ALL conflict versions
	const firstPair = pairs[0]!;

	// Build a flat list: [{ kind: "original" | "conflict", index, mtime, size }]
	const candidates: Array<{
		kind: "original" | "conflict";
		index: number;
		mtime: Date | null;
		size: number;
	}> = [];

	if (firstPair.originalExists && firstPair.originalMtime) {
		candidates.push({
			kind: "original",
			index: -1,
			mtime: firstPair.originalMtime,
			size: firstPair.originalSize,
		});
	}

	for (let i = 0; i < pairs.length; i++) {
		candidates.push({
			kind: "conflict",
			index: i,
			mtime: pairs[i]!.conflictMtime,
			size: pairs[i]!.conflictSize,
		});
	}

	if (candidates.length === 0) {
		return { type: "conflict", conflictIndex: 0 };
	}

	let winnerIdx = 0;
	for (let i = 1; i < candidates.length; i++) {
		const curr = candidates[winnerIdx]!;
		const chall = candidates[i]!;

		const wins = (() => {
			switch (strategy) {
				case "newest":
					return (chall.mtime?.getTime() ?? 0) > (curr.mtime?.getTime() ?? 0);
				case "oldest":
					return (chall.mtime?.getTime() ?? Infinity) < (curr.mtime?.getTime() ?? Infinity);
				case "largest":
					return chall.size > curr.size;
				case "smallest":
					return chall.size < curr.size;
				default:
					return false;
			}
		})();

		if (wins) {
			winnerIdx = i;
		}
	}

	const winner = candidates[winnerIdx]!;
	if (winner.kind === "original") {
		return { type: "original" };
	}
	return { type: "conflict", conflictIndex: winner.index };
}

function backupFile(filePath: string, backupDir?: string): void {
	if (!existsSync(filePath)) return;

	const dir = backupDir ?? DEFAULT_BACKUP_DIR;
	const destDir = join(dirname(filePath), dir);

	mkdirSync(destDir, { recursive: true });

	const basename = filePath.split(/[/\\]/).pop()!;
	const dest = join(destDir, basename);

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
