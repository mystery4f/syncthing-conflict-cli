import { describe, it, expect } from "vitest";
import { isConflictFile, parseConflictPath } from "../utils/parser.js";

describe("parser", () => {
	describe("isConflictFile", () => {
		it("identifies conflict files", () => {
			expect(isConflictFile("readme.sync-conflict-20240115-093000-ABCDEF.md")).toBe(true);
			expect(isConflictFile("data.sync-conflict-20240320-120000-LMNOP.json")).toBe(true);
		});

		it("rejects non-conflict files", () => {
			expect(isConflictFile("readme.md")).toBe(false);
			expect(isConflictFile("notes.txt")).toBe(false);
			expect(isConflictFile(".sync-conflict-temp")).toBe(false);
		});
	});

	describe("parseConflictPath", () => {
		it("parses a conflict filename correctly", () => {
			const result = parseConflictPath("readme.sync-conflict-20240115-093000-ABCDEF.md");
			expect(result).not.toBeNull();
			expect(result!.originalName).toBe("readme.md");
			expect(result!.deviceId).toBe("ABCDEF");
			expect(result!.conflictDate.getFullYear()).toBe(2024);
			expect(result!.conflictDate.getMonth()).toBe(0); // January
			expect(result!.conflictDate.getDate()).toBe(15);
			expect(result!.conflictDate.getHours()).toBe(9);
			expect(result!.conflictDate.getMinutes()).toBe(30);
		});

		it("handles settings.json conflict", () => {
			const result = parseConflictPath("settings.sync-conflict-20260529-184609-B2CA6OC.json");
			expect(result).not.toBeNull();
			expect(result!.originalName).toBe("settings.json");
			expect(result!.deviceId).toBe("B2CA6OC");
		});

		it("handles paths with directories", () => {
			const result = parseConflictPath("notes/readme.sync-conflict-20240115-093000-ABCDEF.md");
			expect(result).not.toBeNull();
			expect(result!.originalPath).toBe("notes/readme.md");
			expect(result!.originalName).toBe("readme.md");
		});

		it("handles Windows-style paths", () => {
			const result = parseConflictPath("notes\\readme.sync-conflict-20240115-093000-ABCDEF.md");
			expect(result).not.toBeNull();
			expect(result!.originalName).toBe("readme.md");
		});

		it("returns null for non-conflict filenames", () => {
			expect(parseConflictPath("readme.md")).toBeNull();
			expect(parseConflictPath("notes.txt")).toBeNull();
		});

		it("handles multiple dots in filename", () => {
			const result = parseConflictPath("my.config.sync-conflict-20240601-120000-XYZ.yaml");
			expect(result).not.toBeNull();
			expect(result!.originalName).toBe("my.config.yaml");
		});
	});
});
