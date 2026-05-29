interface ToolbarProps {
  directory: string;
  progress: { resolved: number; total: number };
  viewMode: string;
  onSelectFolder: () => void;
  onRefresh: () => void;
  onBackToList: () => void;
  loading: boolean;
}

export default function Toolbar({
  directory,
  progress,
  viewMode,
  onSelectFolder,
  onRefresh,
  onBackToList,
  loading,
}: ToolbarProps) {
  const isEmpty = progress.total === 0;

  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <h1 className="toolbar-title">Syncthing Conflict Resolver</h1>
        {directory && (
          <span className="toolbar-dir" title={directory}>
            {directory}
          </span>
        )}
      </div>
      <div className="toolbar-center">
        {progress.total > 0 && (
          <span className="toolbar-progress">
            {progress.resolved}/{progress.total} resolved
          </span>
        )}
        {loading && <span className="toolbar-spinner">Scanning...</span>}
      </div>
      <div className="toolbar-right">
        {viewMode !== "list" && (
          <button className="btn btn-secondary" onClick={onBackToList}>
            ← Back to list
          </button>
        )}
        {directory && (
          <button className="btn btn-secondary" onClick={onRefresh} disabled={loading}>
            Refresh
          </button>
        )}
        <button className="btn btn-primary" onClick={onSelectFolder}>
          {isEmpty ? "Choose Folder" : "Change Folder"}
        </button>
      </div>
    </header>
  );
}
