import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  template: [] as Electron.MenuItemConstructorOptions[],
}));

vi.mock('electron', () => ({
  app: {
    commandLine: {
      getSwitchValue: () => '',
      hasSwitch: () => false,
    },
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: () => [],
    getFocusedWindow: () => ({ close: mocks.close }),
  },
  dialog: { showErrorBox: vi.fn() },
  Menu: {
    buildFromTemplate(template: Electron.MenuItemConstructorOptions[]) {
      mocks.template = template;
      return {};
    },
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
  mocks.close.mockReset();
  mocks.template = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('desktop app menu', () => {
  it('leaves Cmd+W to the renderer', async () => {
    const { buildAppMenu } = await import('../menu');

    buildAppMenu();

    const fileMenu = mocks.template.find((item) => item.label === 'File');
    const closeItem = Array.isArray(fileMenu?.submenu) ? fileMenu.submenu[0] : undefined;
    expect(closeItem).toMatchObject({ label: 'Close Window' });
    expect(closeItem).not.toHaveProperty('accelerator');

    if (typeof closeItem === 'object' && 'click' in closeItem && closeItem.click) {
      Reflect.apply(closeItem.click, undefined, []);
    }
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
