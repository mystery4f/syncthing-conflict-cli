import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import ConflictList from "./components/ConflictList";
import type { ConflictItem } from "./types";
import DiffViewer from "./components/DiffViewer";
import MergeEditor from "./components/MergeEditor";
import Toolbar from "./components/Toolbar";

export type ViewMode = "list" | "diff" | "merge";

function App() {
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [directory, setDirectory] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ resolved: 0, total: 0 });

  const scanDirectory = useCallback(async (dir: string) => {
    setLoading(true);
    try {
      const result = await invoke<ConflictItem[]>("scan_conflicts", { directory: dir });
      setConflicts(result);
      setProgress({ resolved: 0, total: result.length });
      setSelectedIndex(null);
      setViewMode("list");
    } catch (e) {
      console.error("Scan failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const resolveConflict = useCallback(async (index: number, choice: string, mergedContent?: string) => {
    try {
      await invoke("resolve_conflict", { index, choice, mergedContent });
      const result = await invoke<ConflictItem[]>("scan_conflicts", { directory });
      setConflicts(result);
      setProgress((p) => ({ ...p, resolved: p.resolved + 1 }));

      // Navigate to next conflict or back to list
      const remaining = result.filter((c) => !c.resolved);
      if (remaining.length > 0) {
        const nextIdx = result.indexOf(remaining[0]);
        setSelectedIndex(nextIdx);
      } else {
        setSelectedIndex(null);
        setViewMode("list");
      }
    } catch (e) {
      console.error("Resolve failed:", e);
    }
  }, [directory]);

  const selectFolder = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected) {
        const dir = typeof selected === "string" ? selected : selected;
        setDirectory(dir as string);
        scanDirectory(dir as string);
      }
    } catch (e) {
      console.error("Pick directory failed:", e);
    }
  }, [scanDirectory]);

  const handleSelectConflict = (index: number) => {
    setSelectedIndex(index);
    setViewMode("diff");
  };

  const handleViewMerge = (index: number) => {
    setSelectedIndex(index);
    setViewMode("merge");
  };

  const handleBackToList = () => {
    setViewMode("list");
    setSelectedIndex(null);
  };

  const handleResolve = (choice: string, mergedContent?: string) => {
    if (selectedIndex !== null) {
      resolveConflict(selectedIndex, choice, mergedContent);
    }
  };

  const selectedConflict = selectedIndex !== null ? conflicts[selectedIndex] : null;

  return (
    <div className="app">
      <Toolbar
        directory={directory}
        progress={progress}
        viewMode={viewMode}
        onSelectFolder={selectFolder}
        onRefresh={() => scanDirectory(directory)}
        onBackToList={handleBackToList}
        loading={loading}
      />
      <main className="main-content">
        {viewMode === "list" && (
          <ConflictList
            conflicts={conflicts}
            onSelect={handleSelectConflict}
            onMerge={handleViewMerge}
            loading={loading}
            directory={directory}
            onSelectFolder={selectFolder}
          />
        )}
        {viewMode === "diff" && selectedConflict && (
          <DiffViewer
            conflict={selectedConflict}
            onResolve={handleResolve}
            onMerge={() => handleViewMerge(selectedIndex!)}
            onBack={handleBackToList}
          />
        )}
        {viewMode === "merge" && selectedConflict && (
          <MergeEditor
            conflict={selectedConflict}
            totalConflicts={conflicts.length}
            onResolve={handleResolve}
            onBack={handleBackToList}
          />
        )}
      </main>
    </div>
  );
}

export default App;
