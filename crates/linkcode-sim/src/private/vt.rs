//! Hardware H.264 encoding via VideoToolbox (public framework).
//!
//! The capture worker feeds the retained framebuffer `IOSurface` straight into a
//! `VTCompressionSession` (wrapped in a `CVPixelBuffer` — zero-copy: the media engine reads the
//! surface, pixels never enter CPU memory). Output samples are converted from AVCC (length-prefixed
//! NALs) to Annex-B with SPS/PPS prepended on keyframes, which is what a WebCodecs `VideoDecoder`
//! configured without a `description` consumes.

use std::ffi::c_void;
use std::sync::Mutex;

use super::screen::CapturedSurface;

/// One encoded H.264 access unit in Annex-B form.
pub struct EncodedFrame {
    pub data: Vec<u8>,
    pub key: bool,
}

/// Frames the VT output callback has produced and the worker has not yet drained.
type OutputSink = Mutex<Vec<EncodedFrame>>;

/// A realtime, low-latency H.264 compression session for one stream.
pub struct VtEncoder {
    session: *mut c_void,
    /// Boxed so the address handed to the callback as refcon stays stable.
    sink: Box<OutputSink>,
    fps: i32,
    frame_index: i64,
}

// SAFETY: the session is only messaged from the worker's single encode thread; the sink is
// internally synchronized against the VT callback queue.
unsafe impl Send for VtEncoder {}

impl VtEncoder {
    /// Create a session for `width`×`height` at `fps`. `None` on any VideoToolbox failure.
    pub fn new(width: usize, height: usize, fps: u32) -> Option<VtEncoder> {
        let sink: Box<OutputSink> = Box::new(Mutex::new(Vec::new()));
        let refcon = (&raw const *sink).cast_mut().cast::<c_void>();
        let mut session: *mut c_void = std::ptr::null_mut();
        // SAFETY: plain session construction; the callback + refcon outlive the session because
        // the sink box lives in this struct and the session is invalidated on drop.
        let status = unsafe {
            VTCompressionSessionCreate(
                std::ptr::null(),
                width as i32,
                height as i32,
                CODEC_H264,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                output_callback as *const c_void,
                refcon,
                &mut session,
            )
        };
        if status != 0 || session.is_null() {
            return None;
        }
        let fps = fps.clamp(1, 60) as i32;
        // SAFETY: property setters on a live session with CF values released after use.
        unsafe {
            set_bool(session, kVTCompressionPropertyKey_RealTime, true);
            set_bool(
                session,
                kVTCompressionPropertyKey_AllowFrameReordering,
                false,
            );
            set_i32(session, kVTCompressionPropertyKey_AverageBitRate, BITRATE);
            set_i32(session, kVTCompressionPropertyKey_ExpectedFrameRate, fps);
            set_f64(
                session,
                kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration,
                KEYFRAME_INTERVAL_SECONDS,
            );
            VTCompressionSessionPrepareToEncodeFrames(session);
        }
        Some(VtEncoder {
            session,
            sink,
            fps,
            frame_index: 0,
        })
    }

    /// Encode one frame from the live surface; returns every access unit completed so far (the
    /// realtime session normally answers one-in-one-out with ~a frame of latency).
    pub fn encode(&mut self, surface: &CapturedSurface) -> Vec<EncodedFrame> {
        let mut pixel_buffer: *mut c_void = std::ptr::null_mut();
        // SAFETY: wraps the retained IOSurface without copying; the pixel buffer retains the
        // surface for as long as VideoToolbox needs it, and our reference is released below.
        let status = unsafe {
            CVPixelBufferCreateWithIOSurface(
                std::ptr::null(),
                surface.as_ptr(),
                std::ptr::null(),
                &mut pixel_buffer,
            )
        };
        if status == 0 && !pixel_buffer.is_null() {
            let pts = CMTime {
                value: self.frame_index,
                timescale: self.fps,
                flags: CMTIME_FLAGS_VALID,
                epoch: 0,
            };
            self.frame_index += 1;
            // SAFETY: encode on a live session; invalid duration is the documented "unknown".
            unsafe {
                VTCompressionSessionEncodeFrame(
                    self.session,
                    pixel_buffer,
                    pts,
                    CMTime {
                        value: 0,
                        timescale: 0,
                        flags: 0,
                        epoch: 0,
                    },
                    std::ptr::null(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                );
                CFRelease(pixel_buffer.cast_const());
            }
        }
        std::mem::take(&mut *self.sink.lock().expect("vt sink poisoned"))
    }
}

impl Drop for VtEncoder {
    fn drop(&mut self) {
        // SAFETY: invalidate stops the callback before the sink is freed, then release.
        unsafe {
            VTCompressionSessionInvalidate(self.session);
            CFRelease(self.session.cast_const());
        }
    }
}

/// VT output callback (VideoToolbox's queue): convert the sample to Annex-B and park it in the
/// sink for the worker's encode thread to drain.
unsafe extern "C" fn output_callback(
    refcon: *mut c_void,
    _source: *mut c_void,
    status: i32,
    _flags: u32,
    sample: *mut c_void,
) {
    if status != 0 || sample.is_null() || refcon.is_null() {
        return;
    }
    // SAFETY: refcon is the boxed sink owned by the live session (invalidated before drop).
    let sink = unsafe { &*refcon.cast::<OutputSink>() };
    // SAFETY: sample is a live CMSampleBuffer for the duration of this callback.
    if let Some(frame) = unsafe { annex_b_frame(sample) } {
        sink.lock().expect("vt sink poisoned").push(frame);
    }
}

/// Convert a CMSampleBuffer's AVCC payload to one Annex-B access unit (SPS/PPS prepended on
/// keyframes).
unsafe fn annex_b_frame(sample: *mut c_void) -> Option<EncodedFrame> {
    // SAFETY (whole body): read-only CoreMedia accessors on a live sample buffer; the block
    // buffer's bytes are copied out before returning.
    unsafe {
        let key = is_keyframe(sample);
        let block = CMSampleBufferGetDataBuffer(sample);
        if block.is_null() {
            return None;
        }
        let mut length: usize = 0;
        let mut data: *mut u8 = std::ptr::null_mut();
        if CMBlockBufferGetDataPointer(block, 0, std::ptr::null_mut(), &mut length, &mut data) != 0
            || data.is_null()
        {
            return None;
        }
        let avcc = std::slice::from_raw_parts(data, length);

        let mut out = Vec::with_capacity(length + 256);
        if key {
            let format = CMSampleBufferGetFormatDescription(sample);
            for index in 0..2 {
                let mut set: *const u8 = std::ptr::null();
                let mut set_len: usize = 0;
                if CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
                    format,
                    index,
                    &mut set,
                    &mut set_len,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                ) == 0
                    && !set.is_null()
                {
                    out.extend_from_slice(&START_CODE);
                    out.extend_from_slice(std::slice::from_raw_parts(set, set_len));
                }
            }
        }
        let mut offset = 0usize;
        while offset + 4 <= avcc.len() {
            let nal_len = u32::from_be_bytes([
                avcc[offset],
                avcc[offset + 1],
                avcc[offset + 2],
                avcc[offset + 3],
            ]) as usize;
            offset += 4;
            if nal_len == 0 || offset + nal_len > avcc.len() {
                break;
            }
            out.extend_from_slice(&START_CODE);
            out.extend_from_slice(&avcc[offset..offset + nal_len]);
            offset += nal_len;
        }
        (!out.is_empty()).then_some(EncodedFrame { data: out, key })
    }
}

/// A sample without the `NotSync` attachment is a sync (key) frame.
unsafe fn is_keyframe(sample: *mut c_void) -> bool {
    // SAFETY: read-only attachment introspection on a live sample buffer.
    unsafe {
        let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, false);
        if attachments.is_null() || CFArrayGetCount(attachments) == 0 {
            return true;
        }
        let first = CFArrayGetValueAtIndex(attachments, 0);
        let not_sync = CFDictionaryGetValue(first.cast(), kCMSampleAttachmentKey_NotSync.cast());
        not_sync.is_null() || !CFBooleanGetValue(not_sync)
    }
}

const START_CODE: [u8; 4] = [0, 0, 0, 1];
/// `'avc1'` as a FourCC.
const CODEC_H264: u32 = 0x6176_6331;
/// Streaming target; at simulator resolutions this lands well under a JPEG stream's bandwidth.
const BITRATE: i32 = 6_000_000;
const KEYFRAME_INTERVAL_SECONDS: f64 = 2.0;
const CMTIME_FLAGS_VALID: u32 = 1;

#[repr(C)]
struct CMTime {
    value: i64,
    timescale: i32,
    flags: u32,
    epoch: i64,
}

// SAFETY-adjacent helpers: each sets one CF-typed session property and releases the value.
unsafe fn set_bool(session: *mut c_void, key: *const c_void, value: bool) {
    // SAFETY: kCFBooleanTrue/False are constants; SetProperty copies/retains as needed.
    unsafe {
        VTSessionSetProperty(
            session,
            key,
            if value {
                kCFBooleanTrue
            } else {
                kCFBooleanFalse
            },
        );
    }
}

unsafe fn set_i32(session: *mut c_void, key: *const c_void, value: i32) {
    // SAFETY: creates a CFNumber, hands it to the session (which retains), then releases.
    unsafe {
        let number = CFNumberCreate(
            std::ptr::null(),
            KCF_NUMBER_SINT32,
            (&raw const value).cast(),
        );
        VTSessionSetProperty(session, key, number);
        CFRelease(number);
    }
}

unsafe fn set_f64(session: *mut c_void, key: *const c_void, value: f64) {
    // SAFETY: creates a CFNumber, hands it to the session (which retains), then releases.
    unsafe {
        let number = CFNumberCreate(
            std::ptr::null(),
            KCF_NUMBER_DOUBLE,
            (&raw const value).cast(),
        );
        VTSessionSetProperty(session, key, number);
        CFRelease(number);
    }
}

const KCF_NUMBER_SINT32: isize = 3;
const KCF_NUMBER_DOUBLE: isize = 13;

#[link(name = "VideoToolbox", kind = "framework")]
unsafe extern "C" {
    fn VTCompressionSessionCreate(
        allocator: *const c_void,
        width: i32,
        height: i32,
        codec_type: u32,
        encoder_specification: *const c_void,
        source_image_buffer_attributes: *const c_void,
        compressed_data_allocator: *const c_void,
        output_callback: *const c_void,
        refcon: *mut c_void,
        session_out: *mut *mut c_void,
    ) -> i32;
    fn VTSessionSetProperty(session: *mut c_void, key: *const c_void, value: *const c_void) -> i32;
    fn VTCompressionSessionPrepareToEncodeFrames(session: *mut c_void) -> i32;
    fn VTCompressionSessionEncodeFrame(
        session: *mut c_void,
        image_buffer: *mut c_void,
        presentation_timestamp: CMTime,
        duration: CMTime,
        frame_properties: *const c_void,
        source_frame_refcon: *mut c_void,
        info_flags_out: *mut u32,
    ) -> i32;
    fn VTCompressionSessionInvalidate(session: *mut c_void);
    static kVTCompressionPropertyKey_RealTime: *const c_void;
    static kVTCompressionPropertyKey_AllowFrameReordering: *const c_void;
    static kVTCompressionPropertyKey_AverageBitRate: *const c_void;
    static kVTCompressionPropertyKey_ExpectedFrameRate: *const c_void;
    static kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration: *const c_void;
}

#[link(name = "CoreMedia", kind = "framework")]
unsafe extern "C" {
    fn CMSampleBufferGetDataBuffer(sample: *mut c_void) -> *mut c_void;
    fn CMSampleBufferGetFormatDescription(sample: *mut c_void) -> *mut c_void;
    fn CMSampleBufferGetSampleAttachmentsArray(
        sample: *mut c_void,
        create_if_necessary: bool,
    ) -> *const c_void;
    fn CMBlockBufferGetDataPointer(
        buffer: *mut c_void,
        offset: usize,
        length_at_offset: *mut usize,
        total_length: *mut usize,
        data_pointer: *mut *mut u8,
    ) -> i32;
    fn CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
        format: *mut c_void,
        index: usize,
        parameter_set_out: *mut *const u8,
        parameter_set_size_out: *mut usize,
        parameter_set_count_out: *mut usize,
        nal_unit_header_length_out: *mut i32,
    ) -> i32;
    static kCMSampleAttachmentKey_NotSync: *const c_void;
}

#[link(name = "CoreVideo", kind = "framework")]
unsafe extern "C" {
    fn CVPixelBufferCreateWithIOSurface(
        allocator: *const c_void,
        surface: *mut c_void,
        pixel_buffer_attributes: *const c_void,
        pixel_buffer_out: *mut *mut c_void,
    ) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(cf: *const c_void);
    fn CFNumberCreate(
        allocator: *const c_void,
        number_type: isize,
        value_ptr: *const c_void,
    ) -> *const c_void;
    fn CFArrayGetCount(array: *const c_void) -> isize;
    fn CFArrayGetValueAtIndex(array: *const c_void, index: isize) -> *const c_void;
    fn CFDictionaryGetValue(dict: *const c_void, key: *const c_void) -> *const c_void;
    fn CFBooleanGetValue(boolean: *const c_void) -> bool;
    static kCFBooleanTrue: *const c_void;
    static kCFBooleanFalse: *const c_void;
}
