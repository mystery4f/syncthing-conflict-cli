import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveConflict, autoResolve } from "../core/resolver.js";
import type { ConflictPair } from "../core/scanner.js";
import type { ConflictMeta } from "../utils/parser.js";

const TMP_DIR = join(import.meta.dirname, "__tmp_resolver_test__");

function makePair(dir: string, filename: string): ConflictPair {
	const conflictName = `${filename}.sync-conflict-20240115-093000-ABCDEF${filename.substring(filename.lastIndexOf("."))}`;
	const conflictPath = join(dir, conflictName);
	const originalPath = join(dir, filename);

	const meta: ConflictMeta = {
		originalPath,
		conflictPath,
		conflictDate: new Date(2024, 0, 15, 9, 30, 0),
		deviceId: "ABCDEF",
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

describe("resolver", () => {
	beforeEach(() => {
		mkdirSync(TMP_DIR, { recursive: true });
	});

	afterEach(() => {
		rmSync(TMP_DIR, { recursive: true, force: true });
	});

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
		// Conflict file should be renamed
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

	describe("autoResolve", () => {
		it("resolves with newest strategy", () => {
			const pair = makePair(TMP_DIR, "readme.md");
			writeFileSync(pair.meta.originalPath, "original", "utf-8");
			writeFileSync(pair.meta.conflictPath, "newer", "utf-8");

			// conflictMtime is newer (09:30 vs 08:00)
			const result = autoResolve(pair, "newest", { backup: false });
			expect(result.success).toBe(true);
			expect(result.choice).toBe("conflict");
		});

		it("resolves with oldest strategy", () => {
			const pair = makePair(TMP_DIR, "readme.md");
			writeFileSync(pair.meta.originalPath, "original", "utf-8");
			writeFileSync(pair.meta.conflictPath, "newer", "utf-8");

			const result = autoResolve(pair, "oldest", { backup: false });
			expect(result.success).toBe(true);
			expect(result.choice).toBe("original");
		});

		it("resolves with largest strategy", () => {
			const pair = makePair(TMP_DIR, "readme.md");
			writeFileSync(pair.meta.originalPath, "short", "utf-8");
			writeFileSync(pair.meta.conflictPath, "longer content here", "utf-8");

			// conflictSize (200) > originalSize (100)
			const result = autoResolve(pair, "largest", { backup: false });
			expect(result.choice).toBe("conflict");
		});
	});
});
