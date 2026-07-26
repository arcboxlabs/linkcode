import { zodPersist } from '@linkcode/common/zustand';
import type { SimulatorStreamCodec } from '@linkcode/schema';
import { z } from 'zod';
import { create } from 'zustand';

/** Frame-rate choices offered in the panel; 60 is the stream default. */
export const STREAM_FPS_OPTIONS = [60, 30, 15] as const;
/** Downscale-before-encode choices as a fraction of native resolution; 1 = native. */
export const STREAM_SCALE_OPTIONS = [1, 0.75, 0.5, 0.25] as const;
/** Stream encodings offered; a host without H.264 falls back to JPEG regardless of the choice. */
export const STREAM_CODEC_OPTIONS = [
  'h264',
  'jpeg',
] as const satisfies readonly SimulatorStreamCodec[];

const PersistedStreamSettingsSchema = z
  .object({
    fps: z.number(),
    scale: z.number(),
    codec: z.enum(['h264', 'jpeg']),
    showFps: z.boolean(),
  })
  .partial();
type PersistedStreamSettings = z.infer<typeof PersistedStreamSettingsSchema>;

export interface SimulatorStreamSettingsState {
  /** Target capture frame rate (fps). */
  fps: number;
  /** Downscale factor before encode (0..1; 1 = native). */
  scale: number;
  /** Stream encoding; a host without H.264 falls back to JPEG regardless. */
  codec: SimulatorStreamCodec;
  /** Whether the received frame-rate readout is shown. */
  showFps: boolean;
  setFps: (fps: number) => void;
  setScale: (scale: number) => void;
  setCodec: (codec: SimulatorStreamCodec) => void;
  toggleShowFps: () => void;
}

/**
 * Panel-wide simulator stream tuning, shared across devices and persisted. Defaults mirror the
 * previously hardcoded stream options (60 fps, native scale, H.264), so a first run streams exactly
 * as before; changing a value restarts the running stream in place (see `stream-registry`).
 */
export const useSimulatorStreamSettings = create<SimulatorStreamSettingsState>()(
  zodPersist<
    SimulatorStreamSettingsState,
    [],
    [],
    PersistedStreamSettings,
    PersistedStreamSettings
  >(
    (set) => ({
      fps: 60,
      scale: 1,
      codec: 'h264',
      showFps: false,
      setFps: (fps) => set({ fps }),
      setScale: (scale) => set({ scale }),
      setCodec: (codec) => set({ codec }),
      toggleShowFps: () => set((state) => ({ showFps: !state.showFps })),
    }),
    {
      name: 'linkcode.simulator.stream:v1',
      schema: PersistedStreamSettingsSchema,
      partialize: (state) => ({
        fps: state.fps,
        scale: state.scale,
        codec: state.codec,
        showFps: state.showFps,
      }),
    },
  ),
);
