import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyMergedPair, resolveConflict, resolveGroup, autoResolveGroup } from "../core/resolver.js";
import type { ConflictPair } from "../core/scanner.js";
import type { ConflictMeta } from "../utils/parser.js";

const TMP_BASE = join(import.meta.dirname, "__tmp_resolver_test__");
let TMP_DIR: string;
let testCounter = 0;

function makePair(
	dir: string,
	filename: string,
	deviceId = "ABCDEF",
	conflictDate = new Date(2024, 0, 15, 9, 30, 0),
): ConflictPair {
	const dotIdx = filename.lastIndexOf(".");
	const base = dotIdx >= 0 ? filename.substring(0, dotIdx) : filename;
	const ext = dotIdx >= 0 ? filename.substring(dotIdx) : "";
	const conflictName = `${base}.sync-conflict-${formatDateForFilename(conflictDate)}-${deviceId}${ext}`;
	const conflictPath = join(dir, conflictName);
	const originalPath = join(dir, filename);

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
		originalSize: 100,
		conflictSize: 200,
		originalMtime: new Date("2024-01-15T08:00:00"),
		conflictMtime: new Date("2024-01-15T09:30:00"),
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

describe("resolver", () => {
	beforeEach(() => {
		testCounter++;
		TMP_DIR = join(TMP_BASE, `test-${testCounter}`);
		mkdirSync(TMP_DIR, { recursive: true });
	});

	afterEach(() => {
		rmSync(TMP_DIR, { recursive: true, force: true });
	});

	// === Simple 1v1 tests ===

	it("keeps original and deletes conflict", () => {
		const pair = makePair(TMP_DIR, "readme.md");
		writeFileSync(pair.meta.originalPath, "original", "utf-8");
		writeFileSync(pair.meta.conflictPath, "conflict", "utf-8");

		const result = resolveConflict(pair, "original", { backup: false });
		expect(result.success).toBe(true);
		expect(result.choice).toBe("original");
		expect(existsSync(pair.meta.conflictPath)).toBe(false);
		expect(existsSync(pair.meta.originalPath)).toBe(true);
	});

	it("keeps conflict and renames to original name", () => {
		const pair = makePair(TMP_DIR, "readme.md");
		writeFileSync(pair.meta.originalPath, "original", "utf-8");
		writeFileSync(pair.meta.conflictPath, "conflict version", "utf-8");

		const result = resolveConflict(pair, "conflict", { backup: false });
		expect(result.success).toBe(true);
		expect(existsSync(pair.meta.originalPath)).toBe(true);
		expect(readFileSync(pair.meta.originalPath, "utf-8")).toBe("conflict version");
		expect(existsSync(pair.meta.conflictPath)).toBe(false);
	});

	it("keeps both files", () => {
		const pair = makePair(TMP_DIR, "readme.md");
		writeFileSync(pair.meta.originalPath, "original", "utf-8");
		writeFileSync(pair.meta.conflictPath, "conflict", "utf-8");

		const result = resolveConflict(pair, "both", { backup: false });
		expect(result.success).toBe(true);
		expect(existsSync(pair.meta.originalPath)).toBe(true);
		expect(existsSync(pair.meta.conflictPath)).toBe(false);
	});

	it("skips without modifying files", () => {
		const pair = makePair(TMP_DIR, "readme.md");
		writeFileSync(pair.meta.originalPath, "original", "utf-8");
		writeFileSync(pair.meta.conflictPath, "conflict", "utf-8");

		const result = resolveConflict(pair, "skip", { backup: false });
		expect(result.success).toBe(true);
		expect(existsSync(pair.meta.originalPath)).toBe(true);
		expect(existsSync(pair.meta.conflictPath)).toBe(true);
	});

	// === Group resolution tests (multi-conflict) ===

	describe("resolveGroup", () => {
		it("resolves 4 conflicts by keeping original", () => {
			const pairs = [
				makePair(TMP_DIR, "readme.md", "DEV1", new Date(2024, 0, 15, 9, 0, 0)),
				makePair(TMP_DIR, "readme.md", "DEV2", new Date(2024, 0, 15, 10, 0, 0)),
				makePair(TMP_DIR, "readme.md", "DEV3", new Date(2024, 0, 15, 11, 0, 0)),
				makePair(TMP_DIR, "readme.md", "DEV4", new Date(2024, 0, 15, 12, 0, 0)),
			];

			writeFileSync(pairs[0]!.meta.originalPath, "original", "utf-8");
			for (const p of pairs) {
				writeFileSync(p.meta.conflictPath, `from-${p.meta.deviceId}`, "utf-8");
			}

			const result = resolveGroup(pairs, { type: "original" }, { backup: false });
			expect(result.success).toBe(true);
			expect(result.kept).toBe(1);

			// Original survives
			expect(existsSync(pairs[0]!.meta.originalPath)).toBe(true);
			expect(readFileSync(pairs[0]!.meta.originalPath, "utf-8")).toBe("original");

			// All conflicts deleted
			for (const p of pairs) {
				expect(existsSync(p.meta.conflictPath)).toBe(false);
			}
		});

		it("resolves 4 conflicts by keeping one conflict version", () => {
			const pairs = [
				makePair(TMP_DIR, "readme.md", "DEV1", new Date(2024, 0, 15, 9, 0, 0)),
				makePair(TMP_DIR, "readme.md", "DEV2", new Date(2024, 0, 15, 10, 0, 0)),
				makePair(TMP_DIR, "readme.md", "DEV3", new Date(2024, 0, 15, 11, 0, 0)),
				makePair(TMP_DIR, "readme.md", "DEV4", new Date(2024, 0, 15, 12, 0, 0)),
			];

			writeFileSync(pairs[0]!.meta.originalPath, "original", "utf-8");
			for (const p of pairs) {
				writeFileSync(p.meta.conflictPath, `from-${p.meta.deviceId}`, "utf-8");
			}

			// Keep conflict #2 (DEV3)
			const result = resolveGroup(pairs, { type: "conflict", conflictIndex: 2 }, { backup: false });
			expect(result.success).toBe(true);

			// The winner replaces the original
			expect(existsSync(pairs[0]!.meta.originalPath)).toBe(true);
			expect(readFileSync(pairs[0]!.meta.originalPath, "utf-8")).toBe("from-DEV3");

			// All other conflicts deleted
			for (let i = 0; i < pairs.length; i++) {
				expect(existsSync(pairs[i]!.meta.conflictPath)).toBe(false);
			}
		});

		it("skips group without touching files", () => {
			const pairs = [
				makePair(TMP_DIR, "readme.md", "DEV1"),
				makePair(TMP_DIR, "readme.md", "DEV2"),
			];

			writeFileSync(pairs[0]!.meta.originalPath, "original", "utf-8");
			for (const p of pairs) {
				writeFileSync(p.meta.conflictPath, `from-${p.meta.deviceId}`, "utf-8");
			}

			const result = resolveGroup(pairs, { type: "skip" }, { backup: false });
			expect(result.success).toBe(true);

			expect(existsSync(pairs[0]!.meta.originalPath)).toBe(true);
			for (const p of pairs) {
				expect(existsSync(p.meta.conflictPath)).toBe(true);
			}
		});
	});

	// === Auto-resolve group tests ===

	describe("autoResolveGroup", () => {
		it("picks the newest among 4 versions including original", () => {
			const pairs = [
				makePair(TMP_DIR, "data.json", "DEV1", new Date(2024, 0, 15, 9, 0, 0)),
				makePair(TMP_DIR, "data.json", "DEV2", new Date(2024, 0, 15, 14, 0, 0)),
				makePair(TMP_DIR, "data.json", "DEV3", new Date(2024, 0, 15, 11, 0, 0)),
				makePair(TMP_DIR, "data.json", "DEV4", new Date(2024, 0, 15, 7, 0, 0)),
			];

			writeFileSync(pairs[0]!.meta.originalPath, "original", "utf-8");
			for (const p of pairs) {
				writeFileSync(p.meta.conflictPath, `from-${p.meta.deviceId}`, "utf-8");
			}
			// Override mtime to match conflictDate
			pairs[0]!.originalMtime = new Date(2024, 0, 15, 8, 0, 0);
			pairs[0]!.conflictMtime = new Date(2024, 0, 15, 9, 0, 0);
			pairs[1]!.conflictMtime = new Date(2024, 0, 15, 14, 0, 0);
			pairs[2]!.conflictMtime = new Date(2024, 0, 15, 11, 0, 0);
			pairs[3]!.conflictMtime = new Date(2024, 0, 15, 7, 0, 0);

			const result = autoResolveGroup(pairs, "newest", { backup: false });
			expect(result.success).toBe(true);

			// DEV2 (14:00) is newest, should become the original
			expect(readFileSync(pairs[0]!.meta.originalPath, "utf-8")).toBe("from-DEV2");
			for (const p of pairs) {
				expect(existsSync(p.meta.conflictPath)).toBe(false);
			}
		});

		it("picks original when it's the newest", () => {
			const pairs = [
				makePair(TMP_DIR, "data.json", "DEV1", new Date(2024, 0, 15, 9, 0, 0)),
				makePair(TMP_DIR, "data.json", "DEV2", new Date(2024, 0, 15, 10, 0, 0)),
			];

			writeFileSync(pairs[0]!.meta.originalPath, "original content", "utf-8");
			for (const p of pairs) {
				writeFileSync(p.meta.conflictPath, `from-${p.meta.deviceId}`, "utf-8");
			}
			// Original is newest
			pairs[0]!.originalMtime = new Date(2024, 0, 15, 15, 0, 0);

			const result = autoResolveGroup(pairs, "newest", { backup: false });
			expect(result.success).toBe(true);
			expect(readFileSync(pairs[0]!.meta.originalPath, "utf-8")).toBe("original content");
		});

		it("strategy=conflict always picks a conflict version", () => {
			const pairs = [
				makePair(TMP_DIR, "data.json", "DEV1", new Date(2024, 0, 15, 9, 0, 0)),
				makePair(TMP_DIR, "data.json", "DEV2", new Date(2024, 0, 15, 10, 0, 0)),
			];

			writeFileSync(pairs[0]!.meta.originalPath, "original", "utf-8");
			for (const p of pairs) {
				writeFileSync(p.meta.conflictPath, `from-${p.meta.deviceId}`, "utf-8");
			}

			const result = autoResolveGroup(pairs, "conflict", { backup: false });
			expect(result.success).toBe(true);
			// Should have replaced original with a conflict version
			const content = readFileSync(pairs[0]!.meta.originalPath, "utf-8");
			expect(content.startsWith("from-DEV")).toBe(true);
		});

		it("strategy=original always keeps original", () => {
			const pairs = [
				makePair(TMP_DIR, "data.json", "DEV1", new Date(2024, 0, 15, 9, 0, 0)),
				makePair(TMP_DIR, "data.json", "DEV2", new Date(2024, 0, 15, 10, 0, 0)),
			];

			writeFileSync(pairs[0]!.meta.originalPath, "original", "utf-8");
			for (const p of pairs) {
				writeFileSync(p.meta.conflictPath, `from-${p.meta.deviceId}`, "utf-8");
			}

			const result = autoResolveGroup(pairs, "original", { backup: false });
			expect(result.success).toBe(true);
			expect(readFileSync(pairs[0]!.meta.originalPath, "utf-8")).toBe("original");
			for (const p of pairs) {
				expect(existsSync(p.meta.conflictPath)).toBe(false);
			}
		});
	});

	describe("applyMergedPair", () => {
		it("writes merged content to original and removes the conflict file", () => {
			const dir = join(TMP_BASE, `merged-${++testCounter}`);
			mkdirSync(dir, { recursive: true });
			const pair = makePair(dir, "notes.md");
			writeFileSync(pair.meta.originalPath, "original", "utf-8");
			writeFileSync(pair.meta.conflictPath, "conflict", "utf-8");
			const mergedPath = join(dir, "notes.merged.md");
			writeFileSync(mergedPath, "merged result", "utf-8");

			const result = applyMergedPair(pair, mergedPath);

			expect(result.success).toBe(true);
			expect(readFileSync(pair.meta.originalPath, "utf-8")).toBe("merged result");
			expect(existsSync(pair.meta.conflictPath)).toBe(false);
			expect(existsSync(mergedPath)).toBe(true); // caller cleans up the temp file
		});

		it("backs up the original before overwriting", () => {
			const dir = join(TMP_BASE, `merged-${++testCounter}`);
			mkdirSync(dir, { recursive: true });
			const pair = makePair(dir, "notes.md");
			writeFileSync(pair.meta.originalPath, "original", "utf-8");
			writeFileSync(pair.meta.conflictPath, "conflict", "utf-8");
			const mergedPath = join(dir, "notes.merged.md");
			writeFileSync(mergedPath, "merged result", "utf-8");

			applyMergedPair(pair, mergedPath);

			const backupDir = join(dir, ".stc-backup");
			expect(existsSync(join(backupDir, "notes.md"))).toBe(true);
		});
	});
});
