// String literal union, not a TS enum: erases at compile time and matches the
// wire format backends expect verbatim.
export type SortDirection = 'asc' | 'desc';

export interface SortState {
  id: string;
  direction: SortDirection;
}
