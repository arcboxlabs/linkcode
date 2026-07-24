//! Framed stdio wire protocol between the Link Code daemon and this sidecar.
//!
//! Same transport as `linkcode-pty`: each frame is `[u32 LE total][u8 type][body]`, where
//! `total = 1 + body.len()`. `REQUEST` and `RESULT` carry JSON bodies; `SCREENSHOT` carries raw
//! image bytes prefixed with the request id, so captures never pay base64 on this private pipe.

use std::io::{self, Read, Write};

/// Largest accepted frame payload including the one-byte frame type.
pub const MAX_FRAME_LEN: usize = 16 * 1024 * 1024;

/// Maximum request id length in bytes; `SCREENSHOT` frames encode it as `u16`.
pub const MAX_REQUEST_ID_LEN: usize = u16::MAX as usize;

// Daemon → sidecar.
pub const REQUEST: u8 = 0x01;

// Sidecar → daemon.
pub const RESULT: u8 = 0x81;
pub const SCREENSHOT: u8 = 0x82;
/// A streamed framebuffer frame: `[u16 LE udid_len][udid][jpeg]` (unsolicited, while a stream runs).
pub const STREAM_FRAME: u8 = 0x83;
pub const STREAM_FRAME_H264: u8 = 0x84;

/// Encode a `STREAM_FRAME` body: `[u16 LE udid_len][udid][jpeg bytes]`.
pub fn encode_stream_frame(udid: &str, jpeg: &[u8]) -> io::Result<Vec<u8>> {
    let id = udid.as_bytes();
    if id.is_empty() || id.len() > MAX_REQUEST_ID_LEN {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid udid length",
        ));
    }
    let mut out = Vec::with_capacity(2 + id.len() + jpeg.len());
    out.extend_from_slice(&(id.len() as u16).to_le_bytes());
    out.extend_from_slice(id);
    out.extend_from_slice(jpeg);
    Ok(out)
}

/// Encode a `STREAM_FRAME_H264` body: `[u16 LE udid_len][udid][u8 key][Annex-B access unit]`.
pub fn encode_stream_frame_h264(udid: &str, key: bool, data: &[u8]) -> io::Result<Vec<u8>> {
    let id = udid.as_bytes();
    if id.is_empty() || id.len() > MAX_REQUEST_ID_LEN {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid udid length",
        ));
    }
    let mut out = Vec::with_capacity(3 + id.len() + data.len());
    out.extend_from_slice(&(id.len() as u16).to_le_bytes());
    out.extend_from_slice(id);
    out.push(u8::from(key));
    out.extend_from_slice(data);
    Ok(out)
}

/// Read one frame. Returns `Ok(None)` on a clean end-of-stream (the daemon closed the pipe).
pub fn read_frame(reader: &mut impl Read) -> io::Result<Option<(u8, Vec<u8>)>> {
    let mut len = [0u8; 4];
    match reader.read_exact(&mut len) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let total = u32::from_le_bytes(len) as usize;
    if total == 0 || total > MAX_FRAME_LEN {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid frame length",
        ));
    }
    let mut type_byte = [0u8; 1];
    reader.read_exact(&mut type_byte)?;
    let mut body = vec![0u8; total - 1];
    reader.read_exact(&mut body)?;
    Ok(Some((type_byte[0], body)))
}

/// Write one frame. Only the single writer thread calls this on stdout, so its several
/// `write_all`s stay contiguous.
pub fn write_frame(writer: &mut impl Write, type_byte: u8, body: &[u8]) -> io::Result<()> {
    let total = 1 + body.len();
    if total > MAX_FRAME_LEN {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "frame too large",
        ));
    }
    let total = total as u32;
    writer.write_all(&total.to_le_bytes())?;
    writer.write_all(&[type_byte])?;
    writer.write_all(body)?;
    writer.flush()
}

/// Encode a `SCREENSHOT` body: `[u16 LE id_len][request_id][image bytes]`.
pub fn encode_screenshot(request_id: &str, image: &[u8]) -> io::Result<Vec<u8>> {
    let id = request_id.as_bytes();
    if id.is_empty() || id.len() > MAX_REQUEST_ID_LEN {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid request id length",
        ));
    }
    let mut out = Vec::with_capacity(2 + id.len() + image.len());
    out.extend_from_slice(&(id.len() as u16).to_le_bytes());
    out.extend_from_slice(id);
    out.extend_from_slice(image);
    Ok(out)
}

/// Decode a `SCREENSHOT` body into `(request_id, image bytes)`. The production decoder lives in
/// the TypeScript client (`@linkcode/sim`); this one keeps the encoder honest in tests.
#[cfg(test)]
pub fn decode_screenshot(body: &[u8]) -> io::Result<(String, &[u8])> {
    let id_len = body
        .get(0..2)
        .map(|b| u16::from_le_bytes([b[0], b[1]]) as usize)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "short screenshot frame"))?;
    let id = body
        .get(2..2 + id_len)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "truncated request id"))?;
    Ok((
        String::from_utf8_lossy(id).into_owned(),
        &body[2 + id_len..],
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn frame_roundtrips_and_ends_cleanly() {
        let mut buf = Vec::new();
        write_frame(&mut buf, RESULT, b"{}").unwrap();
        let mut cursor = Cursor::new(buf);
        let (type_byte, body) = read_frame(&mut cursor).unwrap().unwrap();
        assert_eq!(type_byte, RESULT);
        assert_eq!(body, b"{}");
        assert!(read_frame(&mut cursor).unwrap().is_none());
    }

    #[test]
    fn screenshot_body_preserves_id_and_raw_bytes() {
        let body = encode_screenshot("r-1", b"\xFF\xD8\xFF\xE0jpeg").unwrap();
        let (id, image) = decode_screenshot(&body).unwrap();
        assert_eq!(id, "r-1");
        assert_eq!(image, b"\xFF\xD8\xFF\xE0jpeg");
    }

    #[test]
    fn decode_rejects_truncated_bodies() {
        assert!(decode_screenshot(&[1]).is_err());
        assert!(decode_screenshot(&[9, 0, b'x']).is_err());
    }

    #[test]
    fn oversized_frames_are_rejected() {
        let mut encoded = Vec::new();
        encoded.extend_from_slice(&((MAX_FRAME_LEN as u32) + 1).to_le_bytes());
        encoded.push(RESULT);

        let err = read_frame(&mut Cursor::new(encoded)).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);

        let err = write_frame(&mut Vec::new(), RESULT, &vec![0; MAX_FRAME_LEN]).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn oversized_request_ids_are_rejected() {
        let request_id = "x".repeat(MAX_REQUEST_ID_LEN + 1);
        let err = encode_screenshot(&request_id, b"img").unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
    }
}
