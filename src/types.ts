export interface ConflictItem {
  index: number;
  original_name: string;
  original_path: string;
  conflict_path: string;
  device_id: string;
  conflict_date: string;
  conflict_size: number;
  original_size: number;
  resolved: boolean;
}
