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
