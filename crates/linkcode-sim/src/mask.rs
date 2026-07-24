//! Per-device screen-mask rendering: the devicetype bundle ships a `framebufferMask` PDF (the
//! exact screen outline — corner curvature, sensor island), which this module rasterizes to a
//! transparent PNG so clients can clip the framebuffer to the real device shape. Public surface
//! only: `simctl list` supplies the bundle path, `plutil` reads the profile, CoreGraphics renders.

#[cfg(not(target_os = "macos"))]
mod imp {
    use crate::rpc::{ErrorCode, OpError};

    pub fn screen_mask(_udid: &str) -> Result<Vec<u8>, OpError> {
        Err(OpError::new(
            ErrorCode::XcodeMissing,
            "screen masks require macOS",
        ))
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::c_void;
    use std::path::Path;
    use std::process::Command;

    use serde::Deserialize;

    use crate::rpc::{ErrorCode, OpError};
    use crate::simctl;

    /// Apple's OS-provided plist tool by absolute path (same rationale as `simctl.rs`'s XCRUN).
    const PLUTIL: &str = "/usr/bin/plutil";

    /// The devicetype profile keys the mask render needs; the profile is a binary plist.
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Profile {
        framebuffer_mask: Option<String>,
    }

    pub fn screen_mask(udid: &str) -> Result<Vec<u8>, OpError> {
        let bundle = simctl::device_type_bundle_path(udid)?;
        let resources = bundle.join("Contents/Resources");
        let profile = read_profile(&resources.join("profile.plist"))?;
        let mask_name = profile.framebuffer_mask.ok_or_else(|| {
            OpError::new(
                ErrorCode::SimctlFailed,
                "devicetype profile has no framebufferMask",
            )
        })?;
        let pdf = std::fs::read(resources.join(format!("{mask_name}.pdf")))
            .map_err(|e| OpError::new(ErrorCode::Io, format!("read framebufferMask pdf: {e}")))?;
        render_pdf_to_png(&pdf)
    }

    fn read_profile(path: &Path) -> Result<Profile, OpError> {
        let output = Command::new(PLUTIL)
            .args(["-convert", "json", "-o", "-"])
            .arg(path)
            .output()
            .map_err(|e| OpError::new(ErrorCode::Io, format!("spawn {PLUTIL}: {e}")))?;
        if !output.status.success() {
            return Err(OpError::new(
                ErrorCode::Io,
                format!(
                    "{PLUTIL} failed on {}: {}",
                    path.display(),
                    String::from_utf8_lossy(&output.stderr).trim()
                ),
            ));
        }
        serde_json::from_slice(&output.stdout)
            .map_err(|e| OpError::new(ErrorCode::Io, format!("parse devicetype profile: {e}")))
    }

    /// Rasterize page 1 of the mask PDF into a transparent RGBA PNG at the page's native size.
    fn render_pdf_to_png(pdf: &[u8]) -> Result<Vec<u8>, OpError> {
        let fail = |message: &str| OpError::new(ErrorCode::Io, message.to_owned());

        // SAFETY: plain CF/CG object construction and drawing; every created object is released
        // on all paths below, and the PDF bytes are copied into the CFData up front.
        unsafe {
            let data = CFDataCreate(std::ptr::null(), pdf.as_ptr(), pdf.len() as isize);
            let provider = CGDataProviderCreateWithCFData(data);
            let document = CGPDFDocumentCreateWithProvider(provider);
            CGDataProviderRelease(provider);
            CFRelease(data.cast_const());
            if document.is_null() {
                return Err(fail("framebufferMask is not a readable PDF"));
            }
            let page = CGPDFDocumentGetPage(document, 1);
            if page.is_null() {
                CGPDFDocumentRelease(document);
                return Err(fail("framebufferMask PDF has no pages"));
            }
            let media = CGPDFPageGetBoxRect(page, KCG_PDF_MEDIA_BOX);
            let width = media.size.width.round().max(1.0) as usize;
            let height = media.size.height.round().max(1.0) as usize;

            let space = CGColorSpaceCreateDeviceRGB();
            let context = CGBitmapContextCreate(
                std::ptr::null_mut(),
                width,
                height,
                8,
                width * 4,
                space,
                KCG_ALPHA_PREMULTIPLIED_LAST,
            );
            CGColorSpaceRelease(space);
            if context.is_null() {
                CGPDFDocumentRelease(document);
                return Err(fail("could not create the mask bitmap context"));
            }
            CGContextDrawPDFPage(context, page);
            let image = CGBitmapContextCreateImage(context);
            CGContextRelease(context);
            CGPDFDocumentRelease(document);
            if image.is_null() {
                return Err(fail("could not snapshot the mask bitmap"));
            }

            let png = encode_png(image);
            CGImageRelease(image);
            png.ok_or_else(|| fail("could not encode the mask PNG"))
        }
    }

    /// Encode a CGImage as PNG via ImageIO; `None` on any ImageIO failure.
    unsafe fn encode_png(image: *mut c_void) -> Option<Vec<u8>> {
        // SAFETY: `image` is a live CGImage owned by the caller; all CF objects created here are
        // released before returning, and the destination's bytes are copied out first.
        unsafe {
            let out = CFDataCreateMutable(std::ptr::null(), 0);
            let png_type =
                CFStringCreateWithCString(std::ptr::null(), c"public.png".as_ptr(), KCF_UTF8);
            let dest = CGImageDestinationCreateWithData(out, png_type, 1, std::ptr::null());
            CFRelease(png_type);
            if dest.is_null() {
                CFRelease(out.cast_const());
                return None;
            }
            CGImageDestinationAddImage(dest, image, std::ptr::null());
            let finalized = CGImageDestinationFinalize(dest);
            CFRelease(dest.cast_const());
            let bytes = finalized.then(|| {
                let len = CFDataGetLength(out.cast_const()) as usize;
                std::slice::from_raw_parts(CFDataGetBytePtr(out.cast_const()), len).to_vec()
            });
            CFRelease(out.cast_const());
            bytes
        }
    }

    #[repr(C)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    struct CGSize {
        width: f64,
        height: f64,
    }
    #[repr(C)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }

    const KCG_PDF_MEDIA_BOX: i32 = 0;
    const KCG_ALPHA_PREMULTIPLIED_LAST: u32 = 1;
    const KCF_UTF8: u32 = 0x0800_0100;

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGColorSpaceCreateDeviceRGB() -> *mut c_void;
        fn CGColorSpaceRelease(space: *mut c_void);
        fn CGBitmapContextCreate(
            data: *mut c_void,
            width: usize,
            height: usize,
            bits_per_component: usize,
            bytes_per_row: usize,
            space: *mut c_void,
            bitmap_info: u32,
        ) -> *mut c_void;
        fn CGBitmapContextCreateImage(context: *mut c_void) -> *mut c_void;
        fn CGContextRelease(context: *mut c_void);
        fn CGImageRelease(image: *mut c_void);
        fn CGDataProviderCreateWithCFData(data: *mut c_void) -> *mut c_void;
        fn CGDataProviderRelease(provider: *mut c_void);
        fn CGPDFDocumentCreateWithProvider(provider: *mut c_void) -> *mut c_void;
        fn CGPDFDocumentRelease(document: *mut c_void);
        fn CGPDFDocumentGetPage(document: *mut c_void, page: usize) -> *mut c_void;
        fn CGPDFPageGetBoxRect(page: *mut c_void, box_: i32) -> CGRect;
        fn CGContextDrawPDFPage(context: *mut c_void, page: *mut c_void);
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFRelease(cf: *const c_void);
        fn CFDataCreate(allocator: *const c_void, bytes: *const u8, length: isize) -> *mut c_void;
        fn CFDataCreateMutable(allocator: *const c_void, capacity: isize) -> *mut c_void;
        fn CFDataGetLength(data: *const c_void) -> isize;
        fn CFDataGetBytePtr(data: *const c_void) -> *const u8;
        fn CFStringCreateWithCString(
            allocator: *const c_void,
            cstr: *const i8,
            encoding: u32,
        ) -> *const c_void;
    }

    #[link(name = "ImageIO", kind = "framework")]
    unsafe extern "C" {
        fn CGImageDestinationCreateWithData(
            data: *mut c_void,
            type_: *const c_void,
            count: usize,
            options: *const c_void,
        ) -> *mut c_void;
        fn CGImageDestinationAddImage(
            dest: *mut c_void,
            image: *mut c_void,
            properties: *const c_void,
        );
        fn CGImageDestinationFinalize(dest: *mut c_void) -> bool;
    }
}

pub use imp::screen_mask;
