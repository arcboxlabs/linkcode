//! Env-gated diagnostic logging for the private-framework layer.
//!
//! The private paths cross undocumented CoreSimulator/SimulatorKit surfaces, so keep a way to trace
//! them without shipping noise. Set `LINKCODE_SIM_DEBUG=1` to print to stderr; off by default.

use std::sync::OnceLock;

pub fn enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| {
        std::env::var("LINKCODE_SIM_DEBUG").is_ok_and(|v| v != "0" && !v.is_empty())
    })
}

/// Print a diagnostic line to stderr when `LINKCODE_SIM_DEBUG` is set.
macro_rules! dbg_log {
    ($($arg:tt)*) => {
        if $crate::private::debug::enabled() {
            eprintln!("[sim] {}", format!($($arg)*));
        }
    };
}

pub(crate) use dbg_log;
