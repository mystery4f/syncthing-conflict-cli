import type { ConflictItem } from "../types";

interface ConflictListProps {
  conflicts: ConflictItem[];
  onSelect: (index: number) => void;
  onMerge: (index: number) => void;
  loading: boolean;
  directory: string;
  onSelectFolder: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export default function ConflictList({
  conflicts,
  onSelect,
  onMerge,
  loading,
  directory,
  onSelectFolder,
}: ConflictListProps) {
  if (!directory) {
    return (
      <div className="empty-state">
        <div className="empty-icon">📂</div>
        <h2>No folder selected</h2>
        <p>Choose a directory to scan for Syncthing conflict files</p>
        <button className="btn btn-primary btn-lg" onClick={onSelectFolder}>
          Choose Folder
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🔍</div>
        <h2>Scanning...</h2>
        <p>{directory}</p>
      </div>
    );
  }

  const active = conflicts.filter((c) => !c.resolved);

  if (active.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">✅</div>
        <h2>All conflicts resolved</h2>
        {conflicts.length > 0 && (
          <p>{conflicts.length} conflict{conflicts.length > 1 ? "s" : ""} resolved</p>
        )}
        <button className="btn btn-secondary" onClick={onSelectFolder}>
          Scan another folder
        </button>
      </div>
    );
  }

  return (
    <div className="conflict-list">
      <div className="list-header">
        <span className="list-count">{active.length} conflict{active.length > 1 ? "s" : ""} found</span>
      </div>
      <div className="list-items">
        {active.map((item) => (
          <div key={item.index} className="conflict-card">
            <div className="card-info">
              <div className="card-name" title={item.original_path}>
                {item.original_name}
              </div>
              <div className="card-meta">
                <span className="card-device" title={item.device_id}>
                  {item.device_id}
                </span>
                <span className="card-date">{formatDate(item.conflict_date)}</span>
                <span className="card-size">
                  original: {formatSize(item.original_size)} / conflict: {formatSize(item.conflict_size)}
                </span>
              </div>
            </div>
            <div className="card-actions">
              <button
                className="btn btn-primary btn-sm"
                onClick={() => onMerge(item.index)}
              >
                Merge
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => onSelect(item.index)}
              >
                View Diff
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
