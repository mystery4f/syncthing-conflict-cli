import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ConflictItem } from "../types";

interface DiffViewerProps {
  conflict: ConflictItem;
  onResolve: (choice: string) => void;
  onMerge: () => void;
  onBack: () => void;
}

interface DiffData {
  lines: Array<{
    orig_line_no: number;
    conf_line_no: number;
    orig_content: string;
    conf_content: string;
    status: "equal" | "added" | "removed" | "modified";
  }>;
  added: number;
  removed: number;
  identical: boolean;
}

export default function DiffViewer({ conflict, onResolve, onMerge, onBack }: DiffViewerProps) {
  const [diff, setDiff] = useState<DiffData | null>(null);
  const [loading, setLoading] = useState(true);
  const [origContent, setOrigContent] = useState("");
  const [confContent, setConfContent] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const result = await invoke<DiffData>("get_diff", {
          originalPath: conflict.original_path,
          conflictPath: conflict.conflict_path,
        });
        setDiff(result);
        const orig = await invoke<string>("read_file", { path: conflict.original_path });
        const conf = await invoke<string>("read_file", { path: conflict.conflict_path });
        setOrigContent(orig);
        setConfContent(conf);
      } catch (e) {
        console.error("Failed to load diff:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [conflict]);

  if (loading) {
    return <div className="empty-state">Loading diff...</div>;
  }

  // Side-by-side view
  return (
    <div className="diff-viewer">
      <div className="diff-header">
        <h2>{conflict.original_name}</h2>
        <span className="diff-stats">
          <span className="diff-added">+{diff?.added ?? 0}</span>{" "}
          <span className="diff-removed">-{diff?.removed ?? 0}</span>
        </span>
      </div>

      <div className="diff-panels">
        <div className="diff-panel diff-panel-left">
          <div className="diff-panel-title">Original</div>
          <pre className="diff-content">{origContent}</pre>
        </div>
        <div className="diff-panel diff-panel-right">
          <div className="diff-panel-title">Conflict ({conflict.device_id})</div>
          <pre className="diff-content">{confContent}</pre>
        </div>
      </div>

      <div className="diff-actions">
        <button className="btn btn-secondary" onClick={onBack}>
          Back
        </button>
        <button className="btn btn-primary" onClick={onMerge}>
          Open Merge Editor
        </button>
        <button
          className="btn btn-success"
          onClick={() => onResolve("original")}
        >
          Keep Original
        </button>
        <button
          className="btn btn-success"
          onClick={() => onResolve("conflict")}
        >
          Keep {conflict.device_id}
        </button>
        <button
          className="btn btn-danger"
          onClick={() => onResolve("delete")}
        >
          Delete Conflict
        </button>
      </div>
    </div>
  );
}
