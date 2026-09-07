export interface TranscriptRecordProps {
  title: string;
  error?: boolean;
  entries: Array<{ id: string; label: string; value?: string }>;
}
