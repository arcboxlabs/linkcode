//! Framed stdio wire protocol between the Link Code daemon and this sidecar.
//!
//! Each frame is `[u32 LE total][u8 type][body]`, where `total = 1 + body.len()`. Control frames
//! (open/resize/close/opened/exit/error) carry JSON bodies; data frames (input/output) carry raw
//! bytes prefixed with the terminal id, so PTY traffic never pays base64 on this private pipe.

use std::io::{self, Read, Write};

/// Largest accepted frame payload including the one-byte frame type.
pub const MAX_FRAME_LEN: usize = 16 * 1024 * 1024;

/// Maximum terminal id length in bytes; data frames encode it as `u16`.
pub const MAX_TERMINAL_ID_LEN: usize = u16::MAX as usize;

// Daemon → sidecar.
pub const OPEN: u8 = 0x01;
pub const INPUT: u8 = 0x02;
pub const RESIZE: u8 = 0x03;
pub const CLOSE: u8 = 0x04;

// Sidecar → daemon.
pub const OPENED: u8 = 0x81;
pub const OUTPUT: u8 = 0x82;
pub const EXIT: u8 = 0x83;
pub const ERROR: u8 = 0x84;

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

/// Write one frame. On stdout only the single writer thread calls this, so its several `write_all`s
/// stay contiguous.
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

/// Encode a data-frame body: `[u16 LE id_len][id][data]`.
pub fn encode_data(terminal_id: &str, data: &[u8]) -> io::Result<Vec<u8>> {
    let id = terminal_id.as_bytes();
    if id.is_empty() || id.len() > MAX_TERMINAL_ID_LEN {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid terminal id length",
        ));
    }
    let mut out = Vec::with_capacity(2 + id.len() + data.len());
    out.extend_from_slice(&(id.len() as u16).to_le_bytes());
    out.extend_from_slice(id);
    out.extend_from_slice(data);
    Ok(out)
}

/// Decode a data-frame body into `(terminal_id, data)`.
pub fn decode_data(body: &[u8]) -> io::Result<(String, &[u8])> {
    let id_len = body
        .get(0..2)
        .map(|b| u16::from_le_bytes([b[0], b[1]]) as usize)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "short data frame"))?;
    let id = body
        .get(2..2 + id_len)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "truncated terminal id"))?;
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
        write_frame(&mut buf, OUTPUT, b"hello").unwrap();
        let mut cursor = Cursor::new(buf);
        let (type_byte, body) = read_frame(&mut cursor).unwrap().unwrap();
        assert_eq!(type_byte, OUTPUT);
        assert_eq!(body, b"hello");
        assert!(read_frame(&mut cursor).unwrap().is_none());
    }

    #[test]
    fn data_frame_preserves_id_and_raw_bytes() {
        let body = encode_data("term-1", b"\x1b[0mls\r\n").unwrap();
        let (id, data) = decode_data(&body).unwrap();
        assert_eq!(id, "term-1");
        assert_eq!(data, b"\x1b[0mls\r\n");
    }

    #[test]
    fn decode_rejects_truncated_frames() {
        assert!(decode_data(&[1]).is_err());
        assert!(decode_data(&[9, 0, b'x']).is_err());
    }

    #[test]
    fn oversized_frames_are_rejected() {
        let mut encoded = Vec::new();
        encoded.extend_from_slice(&((MAX_FRAME_LEN as u32) + 1).to_le_bytes());
        encoded.push(OUTPUT);

        let err = read_frame(&mut Cursor::new(encoded)).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);

        let err = write_frame(&mut Vec::new(), OUTPUT, &vec![0; MAX_FRAME_LEN]).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn oversized_terminal_ids_are_rejected() {
        let terminal_id = "x".repeat(MAX_TERMINAL_ID_LEN + 1);

        let err = encode_data(&terminal_id, b"hello").unwrap_err();

        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
    }
}
