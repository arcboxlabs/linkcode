import { z } from 'zod';

/**
 * System IPC carries only system / UI capabilities and never carries business data (PLAN §2.3 / §4.5).
 * SystemContext is the injection point for the implementation of these capabilities: the Electron main
 * process provides the real implementation, while the shared contract stays business-free.
 */
export interface SystemContext {
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    isMaximized(): boolean;
  };
  dialog: {
    pickFile(opts?: PickFileOptions): Promise<string | null>;
  };
  app: {
    getVersion(): string;
    getPlatform(): NodeJS.Platform;
  };
}

export const PickFileOptionsSchema = z.object({
  title: z.string().optional(),
  /** Whether to select a directory rather than a file. */
  directory: z.boolean().optional(),
});
export type PickFileOptions = z.infer<typeof PickFileOptionsSchema>;
