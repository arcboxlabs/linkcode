import type * as React from 'react';

/** Suppress Base UI's own handler for this event — e.g. an Autocomplete item press writing the
 * item's value into the input when the row's `onClick` fully owns the action. */
export function preventBaseUIHandler(event: React.SyntheticEvent): void {
  (event as React.SyntheticEvent & { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
}
