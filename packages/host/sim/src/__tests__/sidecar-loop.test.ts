import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { SimSidecarClient } from '../client';

/**
 * The CODE-393 acceptance loop, SDK-driven against the real sidecar and a real simulator:
 * boot → install (fixture app compiled on the fly) → launch → screenshot. Opt-in — it needs a
 * Mac with full Xcode and boots a device:
 *
 *   LINKCODE_SIM_E2E=1 pnpm exec vitest run packages/host/sim
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const sidecarPath =
  process.env.LINKCODE_SIM_SIDECAR_PATH ?? join(repoRoot, 'target', 'release', 'linkcode-sim');
const enabled =
  process.env.LINKCODE_SIM_E2E === '1' && process.platform === 'darwin' && existsSync(sidecarPath);

const FIXTURE_BUNDLE_ID = 'ai.linkcode.sim.sdkfixture';

const FIXTURE_MAIN_M = `
#import <UIKit/UIKit.h>
@interface AppDelegate : UIResponder <UIApplicationDelegate>
@property (strong, nonatomic) UIWindow *window;
@end
@implementation AppDelegate
- (BOOL)application:(UIApplication *)application
    didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {
  self.window = [[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];
  self.window.backgroundColor = UIColor.systemGreenColor;
  [self.window makeKeyAndVisible];
  return YES;
}
@end
int main(int argc, char *argv[]) {
  return UIApplicationMain(argc, argv, nil, NSStringFromClass(AppDelegate.class));
}
`;

const FIXTURE_INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>Fixture</string>
  <key>CFBundleIdentifier</key><string>${FIXTURE_BUNDLE_ID}</string>
  <key>CFBundleName</key><string>LinkCodeSimSdkFixture</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>UIDeviceFamily</key><array><integer>1</integer></array>
</dict>
</plist>
`;

/** `/usr/bin/xcrun` + a clean SDK env: a foreign DEVELOPER_DIR/SDKROOT (devenv's nix apple-sdk)
 * breaks `-sdk iphonesimulator` resolution even through the real xcrun. */
function buildFixtureApp(root: string): string {
  const app = join(root, 'Fixture.app');
  mkdirSync(app, { recursive: true });
  writeFileSync(join(root, 'main.m'), FIXTURE_MAIN_M);
  writeFileSync(join(app, 'Info.plist'), FIXTURE_INFO_PLIST);
  const env = { ...process.env };
  delete env.DEVELOPER_DIR;
  delete env.SDKROOT;
  const target =
    process.arch === 'arm64' ? 'arm64-apple-ios15.0-simulator' : 'x86_64-apple-ios15.0-simulator';
  execFileSync(
    '/usr/bin/xcrun',
    [
      '-sdk',
      'iphonesimulator',
      'clang',
      '-fobjc-arc',
      '-target',
      target,
      join(root, 'main.m'),
      '-framework',
      'UIKit',
      '-framework',
      'Foundation',
      '-o',
      join(app, 'Fixture'),
    ],
    { env },
  );
  return app;
}

describe.runIf(enabled)('sidecar loop (real simulator)', () => {
  const fixtureRoot = join(tmpdir(), `linkcode-sim-sdk-${process.pid}`);
  const client = new SimSidecarClient(sidecarPath);

  afterAll(() => {
    client.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('drives boot → install → launch → screenshot end to end', { timeout: 600000 }, async () => {
    await client.probe();
    const devices = await client.list();
    const booted = devices.find((device) => device.state === 'Booted');
    const target =
      booted ??
      devices.find((device) => device.name.includes('iPhone') && device.runtime.includes('iOS'));
    expect(target, 'no available iPhone simulator').toBeDefined();
    const udid = target!.udid;

    if (!booted) await client.boot(udid);
    await client.install(udid, buildFixtureApp(fixtureRoot));
    const pid = await client.launch(udid, FIXTURE_BUNDLE_ID);
    expect(pid).toBeGreaterThan(0);

    const image = await client.screenshot(udid);
    expect(image.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(image.length).toBeGreaterThan(10000);

    await client.terminate(udid, FIXTURE_BUNDLE_ID);
    if (!booted) await client.shutdownDevice(udid);
  });
});
