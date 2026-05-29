import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { scanConflicts, groupByDirectory } from "../core/scanner.js";

const TMP_BASE = join(import.meta.dirname, "__tmp_scanner_test__");
let TMP_DIR: string;
let testCounter = 0;

function createTestFile(dir: string, name: string, content: string) {
	const fullPath = join(dir, name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(fullPath, content, "utf-8");
	return fullPath;
}

/**
 * Generate a Syncthing-style conflict filename.
 * Format: <basename>.sync-conflict-<YYYYMMDD>-<HHMMSS>-<device>.<ext>
 * E.g., "readme.md" → "readme.sync-conflict-20240115-093000-ABCDEF.md"
 */
function conflictName(filename: string, date: string, device: string): string {
	const dotIdx = filename.lastIndexOf(".");
	const base = dotIdx >= 0 ? filename.substring(0, dotIdx) : filename;
	const ext = dotIdx >= 0 ? filename.substring(dotIdx) : "";
	return `${base}.sync-conflict-${date}-${device}${ext}`;
}

describe("scanner", () => {
	beforeEach(() => {
		testCounter++;
		TMP_DIR = join(TMP_BASE, `test-${testCounter}`);
		mkdirSync(TMP_DIR, { recursive: true });
	});

	afterEach(() => {
		rmSync(TMP_DIR, { recursive: true, force: true });
	});

	it("finds conflict files and pairs with originals", async () => {
		createTestFile(TMP_DIR, "readme.md", "original content");
		createTestFile(
			TMP_DIR,
			conflictName("readme.md", "20240115-093000", "ABCDEF"),
			"conflict content",
		);

		const pairs = await scanConflicts({ directory: TMP_DIR });
		expect(pairs.length).toBe(1);
		expect(pairs[0]!.originalExists).toBe(true);
		expect(pairs[0]!.meta.originalName).toBe("readme.md");
		expect(pairs[0]!.meta.deviceId).toBe("ABCDEF");
	});

	it("detects orphan conflicts (no original)", async () => {
		createTestFile(
			TMP_DIR,
			conflictName("notes.txt", "20240320-120000", "LMNOP"),
			"orphan conflict",
		);

		const pairs = await scanConflicts({ directory: TMP_DIR });
		expect(pairs.length).toBe(1);
		expect(pairs[0]!.originalExists).toBe(false);
	});

	it("finds multiple conflicts for same original", async () => {
		createTestFile(TMP_DIR, "data.json", "{}");
		createTestFile(
			TMP_DIR,
			conflictName("data.json", "20240101-100000", "AAA"),
			"v1",
		);
		createTestFile(
			TMP_DIR,
			conflictName("data.json", "20240102-100000", "BBB"),
			"v2",
		);

		const pairs = await scanConflicts({ directory: TMP_DIR });
		expect(pairs.length).toBe(2);
		for (const p of pairs) {
			expect(p.meta.originalName).toBe("data.json");
		}
	});

	it("respects exclude patterns", async () => {
		const sub = join(TMP_DIR, "node_modules");
		createTestFile(sub, "readme.md", "original");
		createTestFile(
			sub,
			conflictName("readme.md", "20240115-093000", "ABCDEF"),
			"conflict",
		);

		const pairs = await scanConflicts({
			directory: TMP_DIR,
			exclude: ["node_modules"],
		});
		expect(pairs.length).toBe(0);
	});

	it("sorts by name", async () => {
		createTestFile(TMP_DIR, "a.txt", "a");
		createTestFile(TMP_DIR, conflictName("a.txt", "20240102-100000", "AAA"), "ac");
		createTestFile(TMP_DIR, "b.txt", "b");
		createTestFile(TMP_DIR, conflictName("b.txt", "20240101-100000", "BBB"), "bc");

		const pairs = await scanConflicts({ directory: TMP_DIR, sort: "name" });
		expect(pairs.length).toBe(2);
		expect(pairs[0]!.meta.originalName).toBe("a.txt");
		expect(pairs[1]!.meta.originalName).toBe("b.txt");
	});
});

describe("groupByDirectory", () => {
	beforeEach(() => {
		testCounter++;
		TMP_DIR = join(TMP_BASE, `test-${testCounter}`);
		mkdirSync(TMP_DIR, { recursive: true });
	});

	afterEach(() => {
		rmSync(TMP_DIR, { recursive: true, force: true });
	});

	it("groups pairs by directory", async () => {
		const sub1 = join(TMP_DIR, "dir1");
		const sub2 = join(TMP_DIR, "dir2");
		createTestFile(sub1, "f1.txt", "orig1");
		createTestFile(sub1, conflictName("f1.txt", "20240101-100000", "AAA"), "c1");
		createTestFile(sub2, "f2.txt", "orig2");
		createTestFile(sub2, conflictName("f2.txt", "20240102-100000", "BBB"), "c2");

		const pairs = await scanConflicts({ directory: TMP_DIR });
		const groups = groupByDirectory(pairs);

		expect(groups.size).toBe(2);
	});
});
