/**
 * Diff generation for conflict file comparison.
 */

import { readFileSync, statSync } from "node:fs";
import * as Diff from "diff";

export interface DiffResult {
	/** Whether the files are identical */
	identical: boolean;
	/** Number of lines added */
	added: number;
	/** Number of lines removed */
	removed: number;
	/** Formatted diff string for terminal display */
	formatted: string;
}

export interface FileInfo {
	path: string;
	size: number;
	isText: boolean;
}

/**
 * Check if a file appears to be text-based by extension.
 */
function isTextFile(path: string): boolean {
	const textExtensions = new Set([
		".txt", ".md", ".json", ".yaml", ".yml", ".xml", ".csv", ".tsv",
		".html", ".css", ".js", ".ts", ".jsx", ".tsx", ".py", ".rb",
		".go", ".rs", ".java", ".c", ".cpp", ".h", ".sh", ".bash",
		".zsh", ".toml", ".ini", ".cfg", ".conf", ".log", ".sql",
		".env", ".gitignore", ".editorconfig",
	]);
	const ext = path.substring(path.lastIndexOf(".")).toLowerCase();
	return textExtensions.has(ext);
}

/**
 * Generate a diff between two files.
 */
export function generateDiff(originalPath: string, conflictPath: string): DiffResult {
	const origIsText = isTextFile(originalPath);
	const confIsText = isTextFile(conflictPath);

	if (!origIsText || !confIsText) {
		return generateBinaryDiff(originalPath, conflictPath);
	}

	let originalContent: string;
	let conflictContent: string;

	try {
		originalContent = readFileSync(originalPath, "utf-8");
	} catch {
		return {
			identical: false,
			added: -1,
			removed: -1,
			formatted: "Error: Cannot read original file",
		};
	}

	try {
		conflictContent = readFileSync(conflictPath, "utf-8");
	} catch {
		return {
			identical: false,
			added: -1,
			removed: -1,
			formatted: "Error: Cannot read conflict file",
		};
	}

	if (originalContent === conflictContent) {
		return {
			identical: true,
			added: 0,
			removed: 0,
			formatted: "Files are identical.",
		};
	}

	const changes = Diff.diffLines(originalContent, conflictContent);

	let added = 0;
	let removed = 0;
	const lines: string[] = [];

	for (const change of changes) {
		if (change.added) {
			added += change.count ?? 0;
			for (const line of change.value.split("\n")) {
				if (line) lines.push(`\x1b[32m+ ${line}\x1b[0m`);
			}
		} else if (change.removed) {
			removed += change.count ?? 0;
			for (const line of change.value.split("\n")) {
				if (line) lines.push(`\x1b[31m- ${line}\x1b[0m`);
			}
		} else {
			for (const line of change.value.split("\n")) {
				if (line) lines.push(`  ${line}`);
			}
		}
	}

	return {
		identical: false,
		added,
		removed,
		formatted: lines.join("\n"),
	};
}

export interface SideBySideLine {
	/** Line number in original file (0 if added) */
	origLineNo: number;
	/** Line number in conflict file (0 if removed) */
	confLineNo: number;
	/** Original file line content */
	origContent: string;
	/** Conflict file line content */
	confContent: string;
	/** Diff status for this row */
	status: "equal" | "added" | "removed" | "modified";
}

export interface SideBySideDiffResult {
	/** Whether the files are identical */
	identical: boolean;
	/** Number of lines added */
	added: number;
	/** Number of lines removed */
	removed: number;
	/** Whether both files are text */
	isText: boolean;
	/** Side-by-side aligned lines */
	lines: SideBySideLine[];
}

/**
 * Generate a side-by-side diff between two files.
 */
export function generateSideBySideDiff(
	originalPath: string,
	conflictPath: string,
): SideBySideDiffResult {
	const origIsText = isTextFile(originalPath);
	const confIsText = isTextFile(conflictPath);

	if (!origIsText || !confIsText) {
		return { identical: false, added: 0, removed: 0, isText: false, lines: [] };
	}

	let originalContent: string;
	let conflictContent: string;

	try {
		originalContent = readFileSync(originalPath, "utf-8");
	} catch {
		return { identical: false, added: 0, removed: 0, isText: false, lines: [] };
	}

	try {
		conflictContent = readFileSync(conflictPath, "utf-8");
	} catch {
		return { identical: false, added: 0, removed: 0, isText: false, lines: [] };
	}

	if (originalContent === conflictContent) {
		const origLines = originalContent.split("\n");
		const lines: SideBySideLine[] = origLines.map((content, i) => ({
			origLineNo: i + 1,
			confLineNo: i + 1,
			origContent: content,
			confContent: content,
			status: "equal" as const,
		}));
		return { identical: true, added: 0, removed: 0, isText: true, lines };
	}

	const changes = Diff.diffLines(originalContent, conflictContent);
	const result: SideBySideLine[] = [];
	let added = 0;
	let removed = 0;
	let origLine = 1;
	let confLine = 1;

	for (const change of changes) {
		if (change.added) {
			added += change.count ?? 0;
			for (const content of change.value.split("\n")) {
				if (content === "" && change.value.endsWith("\n")) continue;
				result.push({
					origLineNo: 0,
					confLineNo: confLine++,
					origContent: "",
					confContent: content,
					status: "added",
				});
			}
		} else if (change.removed) {
			removed += change.count ?? 0;
			for (const content of change.value.split("\n")) {
				if (content === "" && change.value.endsWith("\n")) continue;
				result.push({
					origLineNo: origLine++,
					confLineNo: 0,
					origContent: content,
					confContent: "",
					status: "removed",
				});
			}
		} else {
			const origLines = change.value.split("\n");
			for (const content of origLines) {
				if (content === "" && change.value.endsWith("\n")) continue;
				result.push({
					origLineNo: origLine++,
					confLineNo: confLine++,
					origContent: content,
					confContent: content,
					status: "equal",
				});
			}
		}
	}

	return { identical: false, added, removed, isText: true, lines: result };
}

export interface MergedResult {
	/** Whether merge is possible (text files only) */
	canMerge: boolean;
	/** Merged content with conflict markers */
	content: string;
	/** Number of conflict markers in the result */
	conflictCount: number;
}

/**
 * Generate a merged file with conflict markers.
 * Non-conflicting parts are auto-merged; conflicting parts
 * are marked with <<<<<<< / ======= / >>>>>>> for manual resolution.
 */
export function generateMergedContent(
	originalPath: string,
	conflictPath: string,
): MergedResult {
	if (!isTextFile(originalPath) || !isTextFile(conflictPath)) {
		return { canMerge: false, content: "", conflictCount: 0 };
	}

	let originalContent: string;
	let conflictContent: string;

	try {
		originalContent = readFileSync(originalPath, "utf-8");
	} catch {
		return { canMerge: false, content: "", conflictCount: 0 };
	}
	try {
		conflictContent = readFileSync(conflictPath, "utf-8");
	} catch {
		return { canMerge: false, content: "", conflictCount: 0 };
	}

	if (originalContent === conflictContent) {
		return { canMerge: true, content: originalContent, conflictCount: 0 };
	}

	const changes = Diff.diffLines(originalContent, conflictContent);
	const parts: string[] = [];
	let conflictCount = 0;

	for (let i = 0; i < changes.length; i++) {
		const change = changes[i]!;

		if (change.removed) {
			const removedValue = change.value;
			const next = changes[i + 1];

			if (next?.added) {
				// Consecutive removed + added = a conflict block
				parts.push(
					`<<<<<<< original\n${removedValue}=======\n${next.value}>>>>>>> conflict`,
				);
				conflictCount++;
				i++; // Skip the next 'added' change
			} else {
				// Pure removal: original has it, conflict doesn't
				parts.push(
					`<<<<<<< original\n${removedValue}=======\n>>>>>>> conflict`,
				);
				conflictCount++;
			}
		} else if (change.added) {
			// Pure addition: conflict has it, original doesn't
			parts.push(
				`<<<<<<< original\n=======\n${change.value}>>>>>>> conflict`,
			);
			conflictCount++;
		} else {
			// Common lines — auto-merge
			parts.push(change.value);
		}
	}

	return { canMerge: true, content: parts.join(""), conflictCount };
}

/**
 * Check if content still contains conflict markers.
 */
export function hasConflictMarkers(content: string): boolean {
	return content.includes("<<<<<<<") && content.includes(">>>>>>>");
}

/**
 * Generate a metadata-only diff for binary files.
 */
function generateBinaryDiff(originalPath: string, conflictPath: string): DiffResult {
	let origSize = 0;
	let confSize = 0;
	let origMtime = "";
	let confMtime = "";

	try {
		const origStat = statSync(originalPath);
		origSize = origStat.size;
		origMtime = origStat.mtime.toISOString();
	} catch {
		origMtime = "(file not found)";
	}

	try {
		const confStat = statSync(conflictPath);
		confSize = confStat.size;
		confMtime = confStat.mtime.toISOString();
	} catch {
		confMtime = "(file not found)";
	}

	return {
		identical: false,
		added: 0,
		removed: 0,
		formatted: [
			"Binary file comparison:",
			`  Original: ${origSize} bytes  modified ${origMtime}`,
			`  Conflict: ${confSize} bytes  modified ${confMtime}`,
		].join("\n"),
	};
}
