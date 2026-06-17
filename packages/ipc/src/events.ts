import { defineInvokeEventa } from '@moeru/eventa';
import type { PickFileOptions } from './context';

export const systemIpcEvents = {
  windowMinimize: defineInvokeEventa<void>('linkcode.system.window.minimize'),
  windowToggleMaximize: defineInvokeEventa<void>('linkcode.system.window.toggleMaximize'),
  windowClose: defineInvokeEventa<void>('linkcode.system.window.close'),
  windowIsMaximized: defineInvokeEventa<boolean>('linkcode.system.window.isMaximized'),
  fsPickFile: defineInvokeEventa<string | null, PickFileOptions | undefined>(
    'linkcode.system.fs.pickFile',
  ),
  appVersion: defineInvokeEventa<string>('linkcode.system.app.version'),
  appPlatform: defineInvokeEventa<string>('linkcode.system.app.platform'),
};
