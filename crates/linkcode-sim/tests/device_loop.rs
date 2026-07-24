//! The full CODE-392 acceptance loop against a real simulator: boot → install (a fixture app
//! compiled on the fly) → launch → screenshot → terminate → shutdown.
//!
//! Ignored by default: it needs a Mac with full Xcode (iOS SDK + at least one iPhone simulator)
//! and boots a device, which takes minutes. Run explicitly with
//! `cargo test -p linkcode-sim --test device_loop -- --ignored`.
#![cfg(target_os = "macos")]

use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;

const REQUEST: u8 = 0x01;
const RESULT: u8 = 0x81;
const SCREENSHOT: u8 = 0x82;

const FIXTURE_BUNDLE_ID: &str = "ai.linkcode.sim.fixture";

/// A minimal real UIKit app: install/launch/terminate behave exactly like a user app's.
const FIXTURE_MAIN_M: &str = r#"
#import <UIKit/UIKit.h>
@interface AppDelegate : UIResponder <UIApplicationDelegate>
@property (strong, nonatomic) UIWindow *window;
@end
@implementation AppDelegate
- (BOOL)application:(UIApplication *)application
    didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {
  self.window = [[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];
  self.window.backgroundColor = UIColor.systemBlueColor;
  [self.window makeKeyAndVisible];
  return YES;
}
@end
int main(int argc, char *argv[]) {
  return UIApplicationMain(argc, argv, nil, NSStringFromClass(AppDelegate.class));
}
"#;

const FIXTURE_INFO_PLIST: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>Fixture</string>
  <key>CFBundleIdentifier</key><string>ai.linkcode.sim.fixture</string>
  <key>CFBundleName</key><string>LinkCodeSimFixture</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>UIDeviceFamily</key><array><integer>1</integer></array>
</dict>
</plist>
"#;

fn write_frame(w: &mut impl Write, type_byte: u8, body: &[u8]) {
    let total = (1 + body.len()) as u32;
    w.write_all(&total.to_le_bytes()).unwrap();
    w.write_all(&[type_byte]).unwrap();
    w.write_all(body).unwrap();
    w.flush().unwrap();
}

fn read_frame(r: &mut impl Read) -> Option<(u8, Vec<u8>)> {
    let mut len = [0u8; 4];
    r.read_exact(&mut len).ok()?;
    let total = u32::from_le_bytes(len) as usize;
    let mut type_byte = [0u8; 1];
    r.read_exact(&mut type_byte).ok()?;
    let mut body = vec![0u8; total - 1];
    r.read_exact(&mut body).ok()?;
    Some((type_byte[0], body))
}

fn spawn_sidecar() -> (Child, ChildStdin, ChildStdout) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_linkcode-sim"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn sidecar");
    let stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    (child, stdin, stdout)
}

fn request(stdin: &mut impl Write, request_id: &str, op: Value) {
    let body = serde_json::json!({ "requestId": request_id, "op": op });
    write_frame(stdin, REQUEST, &serde_json::to_vec(&body).unwrap());
}

/// Wait for this request's RESULT and assert it succeeded; returns its `result` value.
fn expect_ok(stdout: &mut impl Read, request_id: &str, secs: u64) -> Value {
    let deadline = Instant::now() + Duration::from_secs(secs);
    while Instant::now() < deadline {
        let Some((type_byte, body)) = read_frame(stdout) else {
            break;
        };
        if type_byte != RESULT {
            continue;
        }
        let mut value: Value = serde_json::from_slice(&body).unwrap();
        if value["requestId"] != request_id {
            continue;
        }
        assert_eq!(value["ok"], true, "{request_id} failed: {value}");
        return value["result"].take();
    }
    panic!("no RESULT for {request_id} within {secs}s");
}

/// Wait for a SCREENSHOT frame for this request; returns the raw image bytes.
fn expect_screenshot(stdout: &mut impl Read, request_id: &str, secs: u64) -> Vec<u8> {
    let deadline = Instant::now() + Duration::from_secs(secs);
    while Instant::now() < deadline {
        let Some((type_byte, body)) = read_frame(stdout) else {
            break;
        };
        match type_byte {
            SCREENSHOT => {
                let id_len = u16::from_le_bytes([body[0], body[1]]) as usize;
                let id = String::from_utf8_lossy(&body[2..2 + id_len]).into_owned();
                assert_eq!(id, request_id);
                return body[2 + id_len..].to_vec();
            }
            RESULT => {
                let value: Value = serde_json::from_slice(&body).unwrap();
                if value["requestId"] == request_id {
                    panic!("screenshot failed: {value}");
                }
            }
            _ => {}
        }
    }
    panic!("no SCREENSHOT for {request_id} within {secs}s");
}

/// Compile the fixture `.app` with the iphonesimulator SDK; panics if the SDK is unavailable.
fn build_fixture_app() -> PathBuf {
    let root = std::env::temp_dir().join(format!("linkcode-sim-fixture-{}", std::process::id()));
    let app = root.join("Fixture.app");
    std::fs::create_dir_all(&app).unwrap();
    std::fs::write(root.join("main.m"), FIXTURE_MAIN_M).unwrap();
    std::fs::write(app.join("Info.plist"), FIXTURE_INFO_PLIST).unwrap();

    let arch = if cfg!(target_arch = "aarch64") {
        "arm64-apple-ios15.0-simulator"
    } else {
        "x86_64-apple-ios15.0-simulator"
    };
    // `/usr/bin/xcrun` for the same reason as the sidecar itself, plus a clean SDK environment:
    // a foreign `DEVELOPER_DIR`/`SDKROOT` (e.g. devenv's nix apple-sdk) breaks `-sdk
    // iphonesimulator` resolution even through the real xcrun.
    let output = Command::new("/usr/bin/xcrun")
        .env_remove("DEVELOPER_DIR")
        .env_remove("SDKROOT")
        .args([
            "-sdk",
            "iphonesimulator",
            "clang",
            "-fobjc-arc",
            "-target",
            arch,
        ])
        .arg(root.join("main.m"))
        .args(["-framework", "UIKit", "-framework", "Foundation", "-o"])
        .arg(app.join("Fixture"))
        .output()
        .expect("xcrun clang");
    assert!(
        output.status.success(),
        "fixture build failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    app
}

/// Pick a target device from `list`: a booted one if present, else the first available iPhone.
/// Returns `(udid, already_booted)`.
fn pick_device(devices: &Value) -> (String, bool) {
    let devices = devices["devices"].as_array().expect("devices array");
    assert!(
        !devices.is_empty(),
        "no available simulators; create one in Xcode first"
    );
    if let Some(booted) = devices.iter().find(|d| d["state"] == "Booted") {
        return (booted["udid"].as_str().unwrap().to_owned(), true);
    }
    let iphone = devices
        .iter()
        .find(|d| {
            d["name"].as_str().unwrap_or("").contains("iPhone")
                && d["runtime"].as_str().unwrap_or("").contains("iOS")
        })
        .expect("no available iPhone simulator");
    (iphone["udid"].as_str().unwrap().to_owned(), false)
}

#[test]
#[ignore = "boots a real simulator; needs full Xcode — run with --ignored"]
fn boot_install_launch_screenshot_loop() {
    let (mut child, mut stdin, mut stdout) = spawn_sidecar();

    request(&mut stdin, "probe", serde_json::json!({ "type": "probe" }));
    expect_ok(&mut stdout, "probe", 60);

    request(&mut stdin, "list", serde_json::json!({ "type": "list" }));
    let devices = expect_ok(&mut stdout, "list", 60);
    let (udid, already_booted) = pick_device(&devices);

    if !already_booted {
        request(
            &mut stdin,
            "boot",
            serde_json::json!({ "type": "boot", "udid": udid }),
        );
        expect_ok(&mut stdout, "boot", 240);
    }

    let app = build_fixture_app();
    request(
        &mut stdin,
        "install",
        serde_json::json!({ "type": "install", "udid": udid, "appPath": app.to_str().unwrap() }),
    );
    expect_ok(&mut stdout, "install", 120);

    request(
        &mut stdin,
        "launch",
        serde_json::json!({ "type": "launch", "udid": udid, "bundleId": FIXTURE_BUNDLE_ID }),
    );
    let launch = expect_ok(&mut stdout, "launch", 60);
    assert!(launch["pid"].as_u64().is_some(), "launch pid: {launch}");

    request(
        &mut stdin,
        "shot",
        serde_json::json!({ "type": "screenshot", "udid": udid }),
    );
    let image = expect_screenshot(&mut stdout, "shot", 60);
    assert!(
        image.starts_with(&[0xFF, 0xD8]),
        "expected JPEG magic, got {:?}",
        &image[..4.min(image.len())]
    );
    assert!(image.len() > 10_000, "suspiciously small: {}", image.len());

    request(
        &mut stdin,
        "term",
        serde_json::json!({ "type": "terminate", "udid": udid, "bundleId": FIXTURE_BUNDLE_ID }),
    );
    expect_ok(&mut stdout, "term", 60);

    // Only shut down a device this test booted; a developer's own session stays up.
    if !already_booted {
        request(
            &mut stdin,
            "shutdown",
            serde_json::json!({ "type": "shutdown", "udid": udid }),
        );
        expect_ok(&mut stdout, "shutdown", 120);
    }

    drop(stdin);
    let _ = child.wait();
}
