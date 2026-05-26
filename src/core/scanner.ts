/**
 * Scanner: find and pair Syncthing conflict files with their originals.
 */

import fg from "fast-glob";
import { stat } from "node:fs/promises";
import { parseConflictPath, type ConflictMeta } from "../utils/parser.js";

export interface ConflictPair {
	/** Metadata parsed from the conflict filename */
	meta: ConflictMeta;
	/** Whether the original file exists on disk */
	originalExists: boolean;
	/** Size of the original file in bytes (0 if missing) */
	originalSize: number;
	/** Size of the conflict file in bytes */
	conflictSize: number;
	/** Modification time of the original file */
	originalMtime: Date | null;
	/** Modification time of the conflict file */
	conflictMtime: Date | null;
}

export interface ScanOptions {
	/** Directory to scan */
	directory: string;
	/** Glob patterns to exclude */
	exclude?: string[];
	/** Max recursion depth */
	depth?: number;
	/** Sort field: time | size | name */
	sort?: "time" | "size" | "name";
}

/**
 * Scan a directory for Syncthing conflict files and pair them with originals.
 */
export async function scanConflicts(options: ScanOptions): Promise<ConflictPair[]> {
	const { directory, exclude, depth, sort = "time" } = options;

	const globPatterns = ["**/*.sync-conflict-*"];

	const fgOptions: fg.Options = {
		cwd: directory,
		absolute: true,
		onlyFiles: true,
		ignore: exclude?.map((p) => `**/${p}/**`) ?? [],
		deep: depth ?? Infinity,
	};

	const conflictPaths = await fg(globPatterns, fgOptions);

	const pairs: ConflictPair[] = [];

	for (const conflictPath of conflictPaths) {
		const meta = parseConflictPath(conflictPath);
		if (!meta) continue;

		// Normalize path separators
		const normalizedOriginal = meta.originalPath.replace(/\\/g, "/");

		let originalExists = false;
		let originalSize = 0;
		let originalMtime: Date | null = null;

		try {
			const originalStat = await stat(normalizedOriginal);
			originalExists = true;
			originalSize = originalStat.size;
			originalMtime = originalStat.mtime;
		} catch {
			// Original file doesn't exist — orphan conflict
		}

		const conflictStat = await stat(conflictPath);

		pairs.push({
			meta,
			originalExists,
			originalSize,
			conflictSize: conflictStat.size,
			originalMtime,
			conflictMtime: conflictStat.mtime,
		});
	}

	// Sort
	pairs.sort((a, b) => {
		switch (sort) {
			case "name":
				return a.meta.originalName.localeCompare(b.meta.originalName);
			case "size": {
				const diff = a.conflictSize - b.conflictSize;
				return diff;
			}
			case "time":
			default:
				return b.meta.conflictDate.getTime() - a.meta.conflictDate.getTime();
		}
	});

	return pairs;
}

/**
 * Group conflict pairs by their directory.
 */
export function groupByDirectory(pairs: ConflictPair[]): Map<string, ConflictPair[]> {
	const groups = new Map<string, ConflictPair[]>();

	for (const pair of pairs) {
		const dir = pair.meta.originalPath
			.split(/[/\\]/)
			.slice(0, -1)
			.join("/");
		const group = groups.get(dir) ?? [];
		group.push(pair);
		groups.set(dir, group);
	}

	return groups;
}

/**
 * Group conflict pairs by their original file path.
 * Multiple conflict files pointing to the same original are grouped together.
 */
export function groupByOriginal(pairs: ConflictPair[]): Map<string, ConflictPair[]> {
	const groups = new Map<string, ConflictPair[]>();

	for (const pair of pairs) {
		const key = pair.meta.originalPath;
		const group = groups.get(key) ?? [];
		group.push(pair);
		groups.set(key, group);
	}

	return groups;
}
