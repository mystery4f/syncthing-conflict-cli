import { describe, it, expect, afterAll } from "vitest";
import { generateDiff } from "../core/differ.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const TMP_DIR = join(import.meta.dirname, "__tmp_differ_test__");

describe("differ", () => {
	// Setup temp dir once for all tests
	mkdirSync(TMP_DIR, { recursive: true });

	afterAll(() => {
		rmSync(TMP_DIR, { recursive: true, force: true });
	});

	it("detects identical files", () => {
		const origPath = join(TMP_DIR, "same.txt");
		const confPath = join(TMP_DIR, "same2.txt");

		writeFileSync(origPath, "hello world\n", "utf-8");
		writeFileSync(confPath, "hello world\n", "utf-8");

		const result = generateDiff(origPath, confPath);
		expect(result.identical).toBe(true);
	});

	it("detects text differences", () => {
		const origPath = join(TMP_DIR, "orig.txt");
		const confPath = join(TMP_DIR, "conf.txt");

		writeFileSync(origPath, "line1\nline2\nline3\n", "utf-8");
		writeFileSync(confPath, "line1\nmodified\nline3\n", "utf-8");

		const result = generateDiff(origPath, confPath);
		expect(result.identical).toBe(false);
		expect(result.removed).toBeGreaterThan(0);
		expect(result.added).toBeGreaterThan(0);
		expect(result.formatted).toContain("modified");
	});

	it("handles missing original file", () => {
		const origPath = join(TMP_DIR, "nonexistent.txt");
		const confPath = join(TMP_DIR, "conf2.txt");
		writeFileSync(confPath, "content\n", "utf-8");

		const result = generateDiff(origPath, confPath);
		expect(result.formatted).toContain("Error");
	});

	it("handles binary files", () => {
		const origPath = join(TMP_DIR, "image.png");
		const confPath = join(TMP_DIR, "image.png.conflict");

		writeFileSync(origPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
		writeFileSync(confPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]));

		const result = generateDiff(origPath, confPath);
		expect(result.formatted).toContain("Binary file comparison");
	});
});
