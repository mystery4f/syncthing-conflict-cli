import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ConflictItem } from "../types";

interface MergeEditorProps {
  conflict: ConflictItem;
  totalConflicts: number;
  onResolve: (choice: string, mergedContent?: string) => void;
  onBack: () => void;
}

interface MergeBlock {
  block_index: number;
  type: "equal" | "removed" | "added";
  lines: string[];
}

interface MergeData {
  original_content: string;
  conflict_content: string;
  blocks: MergeBlock[];
  conflict_index: number;
  total_conflicts: number;
}

type SideChoice = "left" | "right" | null;

interface MergeRow {
  blockIdx: number;
  lineIdx: number;
  type: "equal" | "removed" | "added" | "conflict";
  leftLine: string;
  rightLine: string;
  origLineNum: number;
  confLineNum: number;
  isGroupStart: boolean; // first line of a conflict block
}

/** Flatten blocks into aligned rows for side-by-side rendering */
function buildRows(blocks: MergeBlock[]): MergeRow[] {
  const rows: MergeRow[] = [];
  let origLine = 1;
  let confLine = 1;

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];

    if (block.type === "equal") {
      for (let li = 0; li < block.lines.length; li++) {
        rows.push({
          blockIdx: bi, lineIdx: li, type: "equal",
          leftLine: block.lines[li], rightLine: block.lines[li],
          origLineNum: origLine++, confLineNum: confLine++,
          isGroupStart: false,
        });
      }
    } else if (block.type === "removed") {
      const nextBlock = blocks[bi + 1];
      const hasRight = nextBlock?.type === "added";
      const rightLines = hasRight ? nextBlock.lines : [];
      const maxLen = Math.max(block.lines.length, rightLines.length);

      for (let li = 0; li < maxLen; li++) {
        rows.push({
          blockIdx: bi, lineIdx: li, type: "conflict",
          leftLine: block.lines[li] ?? "",
          rightLine: rightLines[li] ?? "",
          origLineNum: block.lines[li] != null ? origLine++ : 0,
          confLineNum: rightLines[li] != null ? confLine++ : 0,
          isGroupStart: li === 0,
        });
      }
      if (hasRight) bi++;
    } else if (block.type === "added") {
      for (let li = 0; li < block.lines.length; li++) {
        rows.push({
          blockIdx: bi, lineIdx: li, type: "conflict",
          leftLine: "", rightLine: block.lines[li],
          origLineNum: 0, confLineNum: confLine++,
          isGroupStart: li === 0,
        });
      }
    }
  }
  return rows;
}

export default function MergeEditor({ conflict, onResolve, onBack }: MergeEditorProps) {
  const [mergeData, setMergeData] = useState<MergeData | null>(null);
  const [choices, setChoices] = useState<SideChoice[]>([]);
  const [edits, setEdits] = useState<Record<number, Record<number, string>>>({});
  const [loading, setLoading] = useState(true);

  const leftRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const result = await invoke<MergeData>("get_merge_data", {
          originalPath: conflict.original_path,
          conflictPath: conflict.conflict_path,
        });
        setMergeData(result);
        const defaults: SideChoice[] = result.blocks.map((b) => {
          if (b.type === "removed") return "left";
          if (b.type === "added") return "right";
          return null;
        });
        setChoices(defaults);
        setEdits({});
      } catch (e) {
        console.error("Failed to load merge data:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [conflict]);

  const rows = useMemo(() => {
    if (!mergeData) return [];
    return buildRows(mergeData.blocks);
  }, [mergeData]);

  const setChoice = useCallback((blockIdx: number, side: SideChoice) => {
    setChoices((prev) => {
      const next = [...prev];
      next[blockIdx] = side;
      return next;
    });
  }, []);

  const setEdit = useCallback((blockIdx: number, lineIdx: number, value: string) => {
    setEdits((prev) => ({
      ...prev,
      [blockIdx]: { ...prev[blockIdx], [lineIdx]: value },
    }));
  }, []);

  const acceptAllLeft = () => {
    if (!mergeData) return;
    setChoices(mergeData.blocks.map((b) => (b.type === "equal" ? null : "left")));
  };

  const acceptAllRight = () => {
    if (!mergeData) return;
    setChoices(mergeData.blocks.map((b) => (b.type === "equal" ? null : "right")));
  };

  const buildMerged = useCallback(() => {
    if (!mergeData) return "";
    const result: string[] = [];
    for (let bi = 0; bi < mergeData.blocks.length; bi++) {
      const block = mergeData.blocks[bi];
      const choice = choices[bi];
      if (block.type === "equal") {
        for (let li = 0; li < block.lines.length; li++) {
          result.push(edits[bi]?.[li] ?? block.lines[li]);
        }
      } else if (block.type === "removed") {
        const nextBlock = mergeData.blocks[bi + 1];
        const hasRight = nextBlock?.type === "added";
        const rightLines = hasRight ? nextBlock.lines : [];
        const maxLen = Math.max(block.lines.length, rightLines.length);
        for (let li = 0; li < maxLen; li++) {
          if (edits[bi]?.[li] !== undefined) {
            result.push(edits[bi][li]);
          } else if (choice === "left" && block.lines[li] != null) {
            result.push(block.lines[li]);
          } else if (choice === "right" && rightLines[li] != null) {
            result.push(rightLines[li]);
          } else {
            result.push(block.lines[li] ?? rightLines[li] ?? "");
          }
        }
        if (hasRight) bi++;
      } else if (block.type === "added") {
        if (choice === "right") {
          for (let li = 0; li < block.lines.length; li++) {
            result.push(edits[bi]?.[li] ?? block.lines[li]);
          }
        }
      }
    }
    return result.join("\n");
  }, [mergeData, choices, edits]);

  const handleSaveAndNext = () => {
    const merged = buildMerged();
    onResolve("merge", merged);
  };

  const resolvedCount = useMemo(() => {
    if (!mergeData) return 0;
    let count = 0;
    for (let i = 0; i < mergeData.blocks.length; i++) {
      if (mergeData.blocks[i].type !== "equal" && choices[i] !== null) count++;
    }
    return count;
  }, [mergeData, choices]);

  const totalBlocks = useMemo(() => {
    if (!mergeData) return 0;
    return mergeData.blocks.filter((b) => b.type !== "equal").length;
  }, [mergeData]);

  // Sync scrolling
  const syncScroll = (source: HTMLDivElement) => {
    const top = source.scrollTop;
    const left = source.scrollLeft;
    if (source !== leftRef.current) { leftRef.current!.scrollTop = top; leftRef.current!.scrollLeft = left; }
    if (source !== centerRef.current) { centerRef.current!.scrollTop = top; centerRef.current!.scrollLeft = left; }
    if (source !== rightRef.current) { rightRef.current!.scrollTop = top; rightRef.current!.scrollLeft = left; }
  };

  if (loading) {
    return <div className="empty-state">Loading merge editor...</div>;
  }

  if (!mergeData) {
    return <div className="empty-state">Failed to load content for merge.</div>;
  }

  return (
    <div className="merge-editor">
      <div className="merge-toolbar">
        <button className="btn btn-secondary" onClick={onBack}>Back</button>
        <span className="merge-title">
          {conflict.original_name} — {resolvedCount}/{totalBlocks} blocks resolved
        </span>
        <div className="merge-toolbar-actions">
          <button className="btn btn-secondary btn-sm" onClick={acceptAllLeft}>Accept All Original</button>
          <button className="btn btn-secondary btn-sm" onClick={acceptAllRight}>Accept All Conflict</button>
          <button className="btn btn-primary" onClick={handleSaveAndNext}>Save & Continue</button>
        </div>
      </div>

      <div className="merge-panels">
        {/* Left: Original */}
        <div
          className="merge-panel merge-panel-left"
          ref={leftRef}
          onScroll={(e) => syncScroll(e.currentTarget)}
        >
          <div className="merge-panel-title">Original</div>
          <div className="merge-panel-body">
            {rows.map((row, ri) => (
              <div
                key={`L-${ri}`}
                className={`merge-row ${row.type === "equal" ? "merge-row-equal" : "merge-row-removed"}`}
              >
                <span className="merge-gutter">{row.origLineNum || ""}</span>
                <span className="merge-line">{row.leftLine}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Center: Merged Result */}
        <div
          className="merge-panel merge-panel-center"
          ref={centerRef}
          onScroll={(e) => syncScroll(e.currentTarget)}
        >
          <div className="merge-panel-title merge-panel-title-center">Merged Result</div>
          <div className="merge-panel-body">
            {rows.map((row, ri) => (
              <div
                key={`C-${ri}`}
                className={`merge-row ${row.type === "equal" ? "merge-row-equal" : "merge-row-conflict"}`}
              >
                {row.isGroupStart && row.type === "conflict" && (
                  <div className="merge-accept-gutter">
                    <button
                      className={`merge-accept-btn ${choices[row.blockIdx] === "left" ? "active" : ""}`}
                      onClick={() => setChoice(row.blockIdx, "left")}
                      title="Accept original"
                    >
                      «
                    </button>
                    <button
                      className={`merge-accept-btn ${choices[row.blockIdx] === "right" ? "active" : ""}`}
                      onClick={() => setChoice(row.blockIdx, "right")}
                      title="Accept conflict"
                    >
                      »
                    </button>
                  </div>
                )}
                {row.type === "equal" ? (
                  <input
                    className="merge-input"
                    value={edits[row.blockIdx]?.[row.lineIdx] ?? row.leftLine}
                    onChange={(e) => setEdit(row.blockIdx, row.lineIdx, e.target.value)}
                  />
                ) : (
                  <input
                    className="merge-input"
                    value={
                      edits[row.blockIdx]?.[row.lineIdx] ?? (
                        (choices[row.blockIdx] === "left" ? row.leftLine : "") ||
                        (choices[row.blockIdx] === "right" ? row.rightLine : "") ||
                        (row.leftLine || row.rightLine)
                      )
                    }
                    onChange={(e) => setEdit(row.blockIdx, row.lineIdx, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right: Conflict */}
        <div
          className="merge-panel merge-panel-right"
          ref={rightRef}
          onScroll={(e) => syncScroll(e.currentTarget)}
        >
          <div className="merge-panel-title merge-panel-title-right">Conflict</div>
          <div className="merge-panel-body">
            {rows.map((row, ri) => (
              <div
                key={`R-${ri}`}
                className={`merge-row ${row.type === "equal" ? "merge-row-equal" : "merge-row-added"}`}
              >
                <span className="merge-gutter">{row.confLineNum || ""}</span>
                <span className="merge-line">{row.rightLine}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
