//! The hand-rolled Objective-C block ABI the private frameworks are handed callbacks through.
//!
//! block2's `RcBlock` is not usable against these APIs — it crashes the CoreSimulator callback path
//! (see `screen.rs`) — so every block this crate hands out is built by hand: a **global** block
//! carrying a signature, which is what the callees accept.
//!
//! Two consequences of `BLOCK_IS_GLOBAL` govern how callers must own these:
//!
//! * `Block_copy` returns the same pointer rather than copying, so the callee holds exactly the
//!   allocation the caller handed it — a block built on the stack is a use-after-free waiting for a
//!   late callback.
//! * `Block_release` still *reads* the block to discover it is global, and that read can happen
//!   after the callback has already run. So a block whose callback releases the waiter must not be
//!   freed by the woken thread; leak it, or keep it alive for the process.
//!
//! `screen.rs` keeps a separate, narrower layout: ROCK's XPC delivery zeroes a pointer captured in
//! the block body, so its callbacks carry no context word at all and reach state through a
//! process-global instead.

use std::ffi::{c_ulong, c_void};

unsafe extern "C" {
    static _NSConcreteGlobalBlock: c_void;
}

const BLOCK_IS_GLOBAL: i32 = 1 << 28;
const BLOCK_HAS_SIGNATURE: i32 = 1 << 30;

/// A block's descriptor: its size and the Objective-C type encoding of its signature. The callees
/// read the signature, so a signature-less block is rejected.
#[repr(C)]
pub struct BlockDescriptor {
    reserved: c_ulong,
    size: c_ulong,
    signature: *const i8,
}

// SAFETY: descriptors are immutable and each signature points at a static NUL-terminated string.
unsafe impl Sync for BlockDescriptor {}

/// A global block carrying one captured word. Callbacks that need no context set it to null.
#[repr(C)]
pub struct CaptureBlock {
    isa: *const c_void,
    flags: i32,
    reserved: i32,
    /// The invoke fn, stored type-erased; the descriptor's signature tells the runtime the real ABI.
    invoke: *const c_void,
    descriptor: *const BlockDescriptor,
    /// The one captured word.
    pub context: *mut c_void,
}

/// Build a descriptor for `signature`, which must be a static NUL-terminated type encoding.
pub const fn descriptor(signature: &'static [u8]) -> BlockDescriptor {
    BlockDescriptor {
        reserved: 0,
        size: size_of::<CaptureBlock>() as c_ulong,
        signature: signature.as_ptr().cast::<i8>(),
    }
}

/// Build a block invoking `invoke` with `context` as its captured word. See the module docs for who
/// may free the result — usually nobody.
pub fn capture_block(
    invoke: *const c_void,
    descriptor: *const BlockDescriptor,
    context: *mut c_void,
) -> CaptureBlock {
    CaptureBlock {
        isa: (&raw const _NSConcreteGlobalBlock).cast::<c_void>(),
        flags: BLOCK_IS_GLOBAL | BLOCK_HAS_SIGNATURE,
        reserved: 0,
        invoke,
        descriptor,
        context,
    }
}
