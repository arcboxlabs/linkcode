// A string literal union instead of a TS enum: it erases at compile time (no
// runtime object in the bundle), narrows cleanly, and matches the wire format
// backends expect verbatim.
export type SortDirection = 'asc' | 'desc';

export interface SortState {
  id: string;
  direction: SortDirection;
}
