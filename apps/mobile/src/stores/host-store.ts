import { zodPersist } from '@linkcode/common/zustand';
import Storage from 'expo-sqlite/kv-store';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { create } from 'zustand';
import { createJSONStorage } from 'zustand/middleware';

const HOST_URL_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:']);

/** http(s) dials the daemon's Socket.IO listener; ws(s) dials a raw WebSocket listener. */
export const HostUrlSchema = z.string().refine((value) => {
  try {
    return HOST_URL_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
});

const HostProfileBase = {
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
};

/** A host reached directly on the local network by URL. */
export const DirectHostProfileSchema = z.object({ ...HostProfileBase, url: HostUrlSchema });
export type DirectHostProfile = z.infer<typeof DirectHostProfileSchema>;

/** A host reached through the cloud tunnel; the id is the daemon's registered device id. */
export const TunnelHostProfileSchema = z.object({
  ...HostProfileBase,
  tunnelHostId: z.string().min(1),
});
export type TunnelHostProfile = z.infer<typeof TunnelHostProfileSchema>;

/** Direct entries predate tunnel ones, so persisted v1 data parses unchanged. */
export const HostProfileSchema = z.union([DirectHostProfileSchema, TunnelHostProfileSchema]);
export type HostProfile = z.infer<typeof HostProfileSchema>;

/** Persisted subset — every field optional so partial/stale storage merges over the defaults. */
const PersistedHostRegistrySchema = z
  .object({
    hosts: z.array(HostProfileSchema),
    lastActiveHostId: z.string().nullable(),
  })
  .partial();
type PersistedHostRegistry = z.infer<typeof PersistedHostRegistrySchema>;

export interface HostRegistryState {
  hosts: HostProfile[];
  /** Startup-redirect hint only; screens always resolve their host from the route param. */
  lastActiveHostId: string | null;
  addHost: (input: { name: string; url: string }) => HostProfile;
  /** Upserts by tunnel host id — re-discovering a known host reuses its entry. */
  addTunnelHost: (input: { name: string; tunnelHostId: string }) => HostProfile;
  removeHost: (id: string) => void;
  setLastActiveHostId: (id: string | null) => void;
}

function createHostId(): string {
  return `host-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useHostRegistryStore = create<HostRegistryState>()(
  zodPersist<HostRegistryState, [], [], PersistedHostRegistry, PersistedHostRegistry>(
    (set, get) => ({
      hosts: [],
      lastActiveHostId: null,
      addHost(input) {
        const profile: HostProfile = {
          id: createHostId(),
          name: input.name,
          url: input.url,
          createdAt: Date.now(),
        };
        set((state) => ({ hosts: [...state.hosts, profile] }));
        return profile;
      },
      addTunnelHost(input) {
        const existing = get().hosts.find(
          (host) => 'tunnelHostId' in host && host.tunnelHostId === input.tunnelHostId,
        );
        if (existing) {
          if (existing.name === input.name) return existing;
          const renamed = { ...existing, name: input.name };
          set((state) => ({
            hosts: state.hosts.map((host) => (host.id === existing.id ? renamed : host)),
          }));
          return renamed;
        }
        const profile: HostProfile = {
          id: createHostId(),
          name: input.name,
          tunnelHostId: input.tunnelHostId,
          createdAt: Date.now(),
        };
        set((state) => ({ hosts: [...state.hosts, profile] }));
        return profile;
      },
      removeHost: (id) =>
        set((state) => ({
          hosts: state.hosts.filter((host) => host.id !== id),
          lastActiveHostId: state.lastActiveHostId === id ? null : state.lastActiveHostId,
        })),
      setLastActiveHostId: (id) => set({ lastActiveHostId: id }),
    }),
    {
      name: 'linkcode.mobile.hosts:v1',
      schema: PersistedHostRegistrySchema,
      storage: createJSONStorage(() => Storage),
      partialize: (state) => ({
        hosts: state.hosts,
        lastActiveHostId: state.lastActiveHostId,
      }),
    },
  ),
);

/** True once the persisted registry has loaded; gate startup redirects on it to avoid flashing the empty state. */
export function useHostRegistryHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useHostRegistryStore.persist.hasHydrated());
  useEffect(() => useHostRegistryStore.persist.onFinishHydration(() => setHydrated(true)), []);
  return hydrated;
}
