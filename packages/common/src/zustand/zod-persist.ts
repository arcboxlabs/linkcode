import type { z } from 'zod';
import type { PersistOptions, PersistStorage } from 'zustand/middleware';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { StateCreator, StoreMutatorIdentifier } from 'zustand/vanilla';

type ZodPersistOptions<State, PersistedState, ParsedState extends Partial<State>> = Omit<
  PersistOptions<State, PersistedState>,
  'merge'
> & {
  schema: z.ZodType<ParsedState>;
  merge?: (parsedState: ParsedState, currentState: State) => State;
};

export function zodPersist<
  State,
  MutatorsBefore extends Array<[StoreMutatorIdentifier, unknown]> = [],
  MutatorsAfter extends Array<[StoreMutatorIdentifier, unknown]> = [],
  PersistedState = State,
  ParsedState extends Partial<State> = Partial<State>,
>(
  initializer: StateCreator<
    State,
    [...MutatorsBefore, ['zustand/persist', unknown]],
    MutatorsAfter
  >,
  options: ZodPersistOptions<State, PersistedState, ParsedState>,
): StateCreator<State, MutatorsBefore, [['zustand/persist', PersistedState], ...MutatorsAfter]> {
  const { schema, merge: customMerge, ...persistOptions } = options;

  return persist<State, MutatorsBefore, MutatorsAfter, PersistedState>(initializer, {
    storage: createSafeJSONStorage<PersistedState>(),
    ...persistOptions,
    merge(persistedState, currentState) {
      const parsed = schema.safeParse(persistedState);
      if (!parsed.success) return currentState;

      if (customMerge) return customMerge(parsed.data, currentState);
      return { ...currentState, ...parsed.data };
    },
  });
}

function createSafeJSONStorage<State>(): PersistStorage<State> | undefined {
  // eslint-disable-next-line sukka/react-prefer-foxact-persistent -- This is the Zustand persistence adapter itself; callers should not access localStorage directly.
  const storage = createJSONStorage<State>(() => localStorage);
  if (!storage) return undefined;

  return {
    ...storage,
    getItem(name) {
      try {
        return storage.getItem(name);
      } catch {
        return null;
      }
    },
  };
}
