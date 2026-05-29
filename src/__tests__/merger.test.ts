import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConflictPair } from "../core/scanner.js";
import { createMergeSessionState } from "../ui/merger.js";
import type { ConflictMeta } from "../utils/parser.js";

const TMP_BASE = join(import.meta.dirname, "__tmp_merger_test__");
let TMP_DIR: string;
let testCounter = 0;

function makePair(
	dir: string,
	filename: string,
	deviceId: string,
	conflictContent: string,
): ConflictPair {
	const dotIdx = filename.lastIndexOf(".");
	const base = dotIdx >= 0 ? filename.substring(0, dotIdx) : filename;
	const ext = dotIdx >= 0 ? filename.substring(dotIdx) : "";
	const conflictDate = new Date(2024, 0, 15, 9 + testCounter, 30, 0);
	const conflictName = `${base}.sync-conflict-${formatDateForFilename(conflictDate)}-${deviceId}${ext}`;
	const conflictPath = join(dir, conflictName);
	const originalPath = join(dir, filename);
	writeFileSync(conflictPath, conflictContent, "utf-8");

	const meta: ConflictMeta = {
		originalPath,
		conflictPath,
		conflictDate,
		deviceId,
		originalName: filename,
	};

	return {
		meta,
		originalExists: true,
		originalSize: existsSync(originalPath) ? readFileSync(originalPath).byteLength : 0,
		conflictSize: Buffer.byteLength(conflictContent),
		originalMtime: new Date("2024-01-15T08:00:00"),
		conflictMtime: conflictDate,
	};
}

function formatDateForFilename(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	const hh = String(date.getHours()).padStart(2, "0");
	const mm = String(date.getMinutes()).padStart(2, "0");
	const ss = String(date.getSeconds()).padStart(2, "0");
	return `${y}${m}${d}-${hh}${mm}${ss}`;
}

describe("merge GUI session state", () => {
	beforeEach(() => {
		testCounter++;
		TMP_DIR = join(TMP_BASE, `test-${testCounter}`);
		mkdirSync(TMP_DIR, { recursive: true });
	});

	afterEach(() => {
		rmSync(TMP_DIR, { recursive: true, force: true });
	});

	it("saves current merge, deletes that conflict, and advances to the next conflict", () => {
		const originalPath = join(TMP_DIR, "notes.md");
		writeFileSync(originalPath, "base\n", "utf-8");
		const first = makePair(TMP_DIR, "notes.md", "DEV1", "base\nfrom dev1\n");
		const second = makePair(TMP_DIR, "notes.md", "DEV2", "base\nfrom dev2\n");

		const session = createMergeSessionState([first, second]);

		expect(session.current().done).toBe(false);
		expect(session.current().item?.deviceId).toBe("DEV1");

		const saveResult = session.saveCurrent("base\nfrom dev1\n");

		expect(saveResult.success).toBe(true);
		expect(readFileSync(originalPath, "utf-8")).toBe("base\nfrom dev1\n");
		expect(existsSync(first.meta.conflictPath)).toBe(false);
		expect(existsSync(second.meta.conflictPath)).toBe(true);
		expect(session.current().item?.deviceId).toBe("DEV2");
		expect(session.result().resolved).toBe(1);
	});

	it("skips current conflict and keeps its files untouched", () => {
		const originalPath = join(TMP_DIR, "notes.md");
		writeFileSync(originalPath, "base\n", "utf-8");
		const first = makePair(TMP_DIR, "notes.md", "DEV1", "from dev1\n");
		const second = makePair(TMP_DIR, "notes.md", "DEV2", "from dev2\n");

		const session = createMergeSessionState([first, second]);
		const skipResult = session.skipCurrent();

		expect(skipResult.success).toBe(true);
		expect(readFileSync(originalPath, "utf-8")).toBe("base\n");
		expect(existsSync(first.meta.conflictPath)).toBe(true);
		expect(session.current().item?.deviceId).toBe("DEV2");
		expect(session.result().skipped).toBe(1);
	});
});
