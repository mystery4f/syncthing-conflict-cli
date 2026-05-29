/**
 * Parse Syncthing conflict file names.
 *
 * Conflict file format:
 *   <basename>.sync-conflict-<YYYYMMDD>-<HHMMSS>-<device-id>.<ext>
 *
 * The conflict suffix is inserted between the base name and the extension.
 * Example: readme.md → readme.sync-conflict-20240115-093000-ABCDEF.md
 *          settings.json → settings.sync-conflict-20260529-184609-B2CA6OC.json
 *          my.config.yaml → my.config.sync-conflict-20240601-120000-XYZ.yaml
 */

export interface ConflictMeta {
	/** Path to the original (non-conflict) file */
	originalPath: string;
	/** Path to the conflict file itself */
	conflictPath: string;
	/** Conflict date parsed from filename */
	conflictDate: Date;
	/** Device ID that produced the conflict */
	deviceId: string;
	/** The original filename without the conflict suffix */
	originalName: string;
}

// Match: <anything>.sync-conflict-<8digits>-<6digits>-<alphanum>.<ext>
const CONFLICT_PATTERN = /^(.+)\.sync-conflict-(\d{8})-(\d{6})-([A-Za-z0-9]+)(\.[^.]+)$/;

/**
 * Check if a filename looks like a Syncthing conflict file.
 */
export function isConflictFile(filename: string): boolean {
	const basename = extractBasename(filename);
	return CONFLICT_PATTERN.test(basename);
}

/**
 * Parse a conflict file path and extract metadata.
 *
 * @param conflictPath - Full path to the conflict file
 * @returns Parsed metadata, or null if not a valid conflict file
 */
export function parseConflictPath(conflictPath: string): ConflictMeta | null {
	const basename = extractBasename(conflictPath);
	const match = basename.match(CONFLICT_PATTERN);
	if (!match) return null;

	const [, nameWithExt, dateStr, timeStr, deviceId, ext] = match;

	const originalName = nameWithExt + ext;

	// Construct original path
	const dir = extractDir(conflictPath);
	const originalPath = dir ? `${dir}/${originalName}` : originalName;

	// Parse date
	const year = Number.parseInt(dateStr.substring(0, 4), 10);
	const month = Number.parseInt(dateStr.substring(4, 6), 10) - 1;
	const day = Number.parseInt(dateStr.substring(6, 8), 10);
	const hour = Number.parseInt(timeStr.substring(0, 2), 10);
	const minute = Number.parseInt(timeStr.substring(2, 4), 10);
	const second = Number.parseInt(timeStr.substring(4, 6), 10);
	const conflictDate = new Date(year, month, day, hour, minute, second);

	return {
		originalPath,
		conflictPath,
		conflictDate,
		deviceId,
		originalName,
	};
}

function extractBasename(filepath: string): string {
	if (filepath.includes("/") || filepath.includes("\\")) {
		const sep = filepath.includes("/") ? "/" : "\\";
		return filepath.split(sep).pop()!;
	}
	return filepath;
}

function extractDir(filepath: string): string {
	const slashIdx = filepath.lastIndexOf("/");
	const backslashIdx = filepath.lastIndexOf("\\");
	const sepIdx = Math.max(slashIdx, backslashIdx);
	if (sepIdx === -1) return "";
	return filepath.substring(0, sepIdx);
}
