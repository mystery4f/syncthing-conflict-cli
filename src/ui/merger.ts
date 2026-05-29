import { execSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import chalk from "chalk";
import * as Diff from "diff";
import type { ConflictPair } from "../core/scanner.js";

export interface MergeResult {
	success: boolean;
	error?: string;
}

export interface MergeSessionResult {
	success: boolean;
	resolved: number;
	skipped: number;
	error?: string;
}

type DiffBlock = { type: "equal" | "removed" | "added"; lines: string[] };

interface MergeSessionSnapshot {
	done: boolean;
	message?: string;
	result: MergeSessionResult;
	item?: {
		index: number;
		total: number;
		originalName: string;
		originalPath: string;
		conflictPath: string;
		deviceId: string;
		conflictMtime: string | null;
		conflictSize: number;
		blocks: DiffBlock[];
	};
}

function computeDiffBlocks(originalContent: string, conflictContent: string): DiffBlock[] {
	if (originalContent === conflictContent) {
		return originalContent ? [{ type: "equal", lines: originalContent.split("\n") }] : [];
	}
	const changes = Diff.diffLines(originalContent || "", conflictContent || "");
	const blocks: DiffBlock[] = [];
	for (const change of changes) {
		const lines = change.value.split("\n");
		if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
		blocks.push({ type: change.added ? "added" : change.removed ? "removed" : "equal", lines });
	}
	return blocks;
}

function escHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

export function createMergeSessionState(pairs: ConflictPair[]) {
	let index = 0;
	let resolved = 0;
	let skipped = 0;
	let stopped = false;
	let lastError: string | undefined;

	function result(): MergeSessionResult {
		return {
			success: lastError === undefined,
			resolved,
			skipped,
			error: lastError,
		};
	}

	function current(): MergeSessionSnapshot {
		if (stopped) {
			return { done: true, message: "Session stopped.", result: result() };
		}
		if (index >= pairs.length) {
			return { done: true, message: "All conflicts processed.", result: result() };
		}

		const pair = pairs[index];
		if (!pair) {
			return { done: true, message: "All conflicts processed.", result: result() };
		}
		try {
			const originalContent =
				pair.originalExists && existsSync(pair.meta.originalPath)
					? readFileSync(pair.meta.originalPath, "utf-8")
					: "";
			const conflictContent = readFileSync(pair.meta.conflictPath, "utf-8");
			return {
				done: false,
				result: result(),
				item: {
					index: index + 1,
					total: pairs.length,
					originalName: pair.meta.originalName,
					originalPath: pair.meta.originalPath,
					conflictPath: pair.meta.conflictPath,
					deviceId: pair.meta.deviceId,
					conflictMtime: pair.conflictMtime?.toISOString() ?? null,
					conflictSize: pair.conflictSize,
					blocks: computeDiffBlocks(originalContent, conflictContent),
				},
			};
		} catch (err) {
			lastError = err instanceof Error ? err.message : String(err);
			return { done: true, message: "Failed to load current conflict.", result: result() };
		}
	}

	function saveCurrent(content: string): MergeResult {
		const pair = pairs[index];
		if (!pair) return { success: false, error: "No current conflict" };
		const applyResult = applyMergedContent(pair, content);
		if (!applyResult.success) {
			lastError = applyResult.error ?? "Unknown save error";
			return applyResult;
		}
		resolved++;
		index++;
		return { success: true };
	}

	function skipCurrent(): MergeResult {
		if (index >= pairs.length) return { success: false, error: "No current conflict" };
		skipped++;
		index++;
		return { success: true };
	}

	function quit(): MergeSessionResult {
		stopped = true;
		return result();
	}

	return { current, saveCurrent, skipCurrent, quit, result };
}

export async function mergeGui(pair: ConflictPair): Promise<MergeResult> {
	const result = await mergeGuiSession([pair]);
	return result.resolved > 0
		? { success: true }
		: { success: false, error: result.error ?? "Merge was not saved" };
}

export async function mergeGuiSession(pairs: ConflictPair[]): Promise<MergeSessionResult> {
	const mergeablePairs = pairs.filter((pair) => pair.originalExists);
	if (mergeablePairs.length === 0) {
		return {
			success: false,
			resolved: 0,
			skipped: 0,
			error: "No mergeable conflicts with an original file",
		};
	}

	const state = createMergeSessionState(mergeablePairs);
	const htmlPath = new URL("merge.html", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
	const html = readFileSync(htmlPath, "utf-8").replace(/__TITLE__/g, escHtml("Merge Conflicts"));

	const server = createServer((req: IncomingMessage, res: ServerResponse) => {
		if (req.method === "GET" && req.url === "/") {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(html);
			return;
		}

		if (req.method === "GET" && req.url === "/state") {
			const snapshot = state.current();
			writeJson(res, snapshot);
			if (snapshot.done) closeSoon(server);
			return;
		}

		if (req.method === "POST" && req.url === "/save") {
			readRequestBody(req, (body) => {
				const saveResult = state.saveCurrent(body);
				const snapshot = state.current();
				writeJson(res, { action: saveResult, ...snapshot });
				if (snapshot.done) closeSoon(server);
			});
			return;
		}

		if (req.method === "POST" && req.url === "/skip") {
			const skipResult = state.skipCurrent();
			const snapshot = state.current();
			writeJson(res, { action: skipResult, ...snapshot });
			if (snapshot.done) closeSoon(server);
			return;
		}

		if (req.method === "POST" && req.url === "/quit") {
			const result = state.quit();
			writeJson(res, { done: true, message: "Session stopped.", result });
			closeSoon(server);
			return;
		}

		res.writeHead(404);
		res.end("Not found");
	});

	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address() as AddressInfo;
	const url = `http://127.0.0.1:${address.port}`;

	console.log(chalk.cyan("\nOpening merge session in browser..."));
	console.log(chalk.dim(`  ${url}`));
	console.log(
		chalk.dim(
			"  Resolve conflicts with Save & Next. The terminal will wait until the browser session ends.",
		),
	);
	console.log("");

	openBrowser(url);
	await new Promise<void>((resolve) => {
		server.on("close", resolve);
	});
	return state.result();
}

function readRequestBody(req: IncomingMessage, onEnd: (body: string) => void): void {
	let body = "";
	req.on("data", (chunk: Buffer) => {
		body += chunk.toString();
	});
	req.on("end", () => onEnd(body));
}

function writeJson(res: ServerResponse, value: unknown): void {
	res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(value));
}

function closeSoon(server: ReturnType<typeof createServer>): void {
	setTimeout(() => server.close(), 50);
}

function applyMergedContent(pair: ConflictPair, content: string): MergeResult {
	const { originalPath, conflictPath, originalName } = pair.meta;
	try {
		if (pair.originalExists && existsSync(originalPath)) {
			const sep = Math.max(originalPath.lastIndexOf("/"), originalPath.lastIndexOf("\\"));
			const dir = join(originalPath.substring(0, sep), ".stc-backup");
			mkdirSync(dir, { recursive: true });
			copyFileSync(originalPath, join(dir, originalName));
		}
		if (existsSync(conflictPath)) {
			const sep = Math.max(conflictPath.lastIndexOf("/"), conflictPath.lastIndexOf("\\"));
			const name = conflictPath.substring(sep + 1);
			const dir = join(conflictPath.substring(0, sep), ".stc-backup");
			mkdirSync(dir, { recursive: true });
			copyFileSync(conflictPath, join(dir, name));
		}
		writeFileSync(originalPath, content, "utf-8");
		if (existsSync(conflictPath)) unlinkSync(conflictPath);
		return { success: true };
	} catch (err) {
		return { success: false, error: String(err) };
	}
}

function openBrowser(url: string): void {
	try {
		if (process.platform === "win32") execSync(`start "" "${url}"`, { stdio: "ignore" });
		else if (process.platform === "darwin") execSync(`open "${url}"`, { stdio: "ignore" });
		else execSync(`xdg-open "${url}"`, { stdio: "ignore" });
	} catch {
		console.log(chalk.yellow(`  Could not open browser. Please open: ${url}`));
	}
}
