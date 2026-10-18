//! A minimal RFC 6455 WebSocket server side over a blocking `TcpStream`: the opening handshake and single-frame text,
//! ping/pong and close. The page sends small JSON messages, unfragmented; anything else closes the connection.
//! Written here rather than pulling a WebSocket crate: it's ~150 lines on the workspace's own `sha1` and `base64`.

use std::io::{self, BufRead, BufReader, Read, Write};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use sha1::{Digest, Sha1};

const GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/// The largest frame the page may send (a pairing message is under 100 bytes).
const MAX_PAYLOAD: u64 = 16 * 1024;
const MAX_HEAD: usize = 8 * 1024;

/// The opening request's line and headers (names lower-cased).
#[derive(Debug, Default)]
pub struct Request {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }
}

pub fn read_request(r: &mut impl BufRead) -> io::Result<Request> {
    let mut req = Request::default();
    let mut total = 0;
    let mut line = String::new();
    loop {
        line.clear();
        let n = r.read_line(&mut line)?;
        total += n;
        if n == 0 || total > MAX_HEAD {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "bad request head",
            ));
        }
        let l = line.trim_end_matches(['\r', '\n']);
        if l.is_empty() {
            return Ok(req);
        }
        if req.method.is_empty() {
            let mut parts = l.split(' ');
            req.method = parts.next().unwrap_or("").to_owned();
            req.path = parts.next().unwrap_or("").to_owned();
        } else if let Some((k, v)) = l.split_once(':') {
            req.headers
                .push((k.trim().to_ascii_lowercase(), v.trim().to_owned()));
        }
    }
}

/// `Sec-WebSocket-Accept` for a client's `Sec-WebSocket-Key`.
pub fn accept_key(key: &str) -> String {
    let mut h = Sha1::new();
    h.update(key.as_bytes());
    h.update(GUID.as_bytes());
    STANDARD.encode(h.finalize())
}

/// Whether `req` asks for a WebSocket upgrade; the key to answer with if so.
pub fn upgrade_key(req: &Request) -> Option<&str> {
    let upgrade = req.header("upgrade")?.eq_ignore_ascii_case("websocket");
    let conn = req
        .header("connection")?
        .split(',')
        .any(|t| t.trim().eq_ignore_ascii_case("upgrade"));
    (req.method == "GET" && upgrade && conn)
        .then(|| req.header("sec-websocket-key"))
        .flatten()
}

pub fn write_accept(w: &mut impl Write, key: &str) -> io::Result<()> {
    write!(
        w,
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {}\r\n\r\n",
        accept_key(key)
    )?;
    w.flush()
}

pub fn write_refusal(w: &mut impl Write, status: &str, why: &str) -> io::Result<()> {
    write!(
        w,
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{why}",
        why.len()
    )?;
    w.flush()
}

#[derive(Debug, PartialEq, Eq)]
pub enum Frame {
    Text(String),
    Ping(Vec<u8>),
    Pong,
    Close,
}

/// Reads one frame from the client (which must mask, RFC 6455 §5.1).
pub fn read_frame(r: &mut impl Read) -> io::Result<Frame> {
    let bad = |m: &str| io::Error::new(io::ErrorKind::InvalidData, m.to_owned());
    let mut h = [0u8; 2];
    r.read_exact(&mut h)?;
    let fin = h[0] & 0x80 != 0;
    let op = h[0] & 0x0f;
    if h[1] & 0x80 == 0 {
        return Err(bad("unmasked client frame"));
    }
    let mut len = u64::from(h[1] & 0x7f);
    if len == 126 {
        let mut b = [0u8; 2];
        r.read_exact(&mut b)?;
        len = u64::from(u16::from_be_bytes(b));
    } else if len == 127 {
        let mut b = [0u8; 8];
        r.read_exact(&mut b)?;
        len = u64::from_be_bytes(b);
    }
    if len > MAX_PAYLOAD {
        return Err(bad("frame too large"));
    }
    let mut mask = [0u8; 4];
    r.read_exact(&mut mask)?;
    let mut payload = vec![0u8; len as usize];
    r.read_exact(&mut payload)?;
    for (i, b) in payload.iter_mut().enumerate() {
        *b ^= mask[i % 4];
    }
    match (fin, op) {
        (true, 0x1) => String::from_utf8(payload)
            .map(Frame::Text)
            .map_err(|_| bad("text frame not UTF-8")),
        (true, 0x9) => Ok(Frame::Ping(payload)),
        (true, 0xa) => Ok(Frame::Pong),
        (_, 0x8) => Ok(Frame::Close),
        _ => Err(bad("unsupported frame (binary or fragmented)")),
    }
}

fn write_frame(w: &mut impl Write, op: u8, payload: &[u8]) -> io::Result<()> {
    let mut head = vec![0x80 | op];
    let n = payload.len();
    if n < 126 {
        head.push(n as u8);
    } else if n <= 0xffff {
        head.push(126);
        head.extend_from_slice(&(n as u16).to_be_bytes());
    } else {
        head.push(127);
        head.extend_from_slice(&(n as u64).to_be_bytes());
    }
    head.extend_from_slice(payload);
    w.write_all(&head)?;
    w.flush()
}

pub fn write_text(w: &mut impl Write, text: &str) -> io::Result<()> {
    write_frame(w, 0x1, text.as_bytes())
}

pub fn write_pong(w: &mut impl Write, payload: &[u8]) -> io::Result<()> {
    write_frame(w, 0xa, payload)
}

pub fn write_close(w: &mut impl Write) -> io::Result<()> {
    write_frame(w, 0x8, &[])
}

/// Reads the head from a stream without consuming any frame bytes after it.
pub fn read_request_from<S: Read>(stream: S) -> io::Result<(Request, BufReader<S>)> {
    let mut r = BufReader::new(stream);
    let req = read_request(&mut r)?;
    Ok((req, r))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc_6455_accept_example() {
        assert_eq!(
            accept_key("dGhlIHNhbXBsZSBub25jZQ=="),
            "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
        );
    }

    #[test]
    fn parses_an_upgrade() {
        let head = "GET / HTTP/1.1\r\nHost: 127.0.0.1:47123\r\nUpgrade: websocket\r\nConnection: keep-alive, Upgrade\r\nSec-WebSocket-Key: abc==\r\nOrigin: https://jammers.dilger.dev\r\n\r\n";
        let req = read_request(&mut head.as_bytes()).unwrap();
        assert_eq!(upgrade_key(&req), Some("abc=="));
        assert_eq!(req.header("origin"), Some("https://jammers.dilger.dev"));
        let plain = read_request(&mut "GET / HTTP/1.1\r\nHost: x\r\n\r\n".as_bytes()).unwrap();
        assert_eq!(upgrade_key(&plain), None);
    }

    fn masked(op: u8, payload: &[u8]) -> Vec<u8> {
        let mask = [1u8, 2, 3, 4];
        let mut f = vec![0x80 | op];
        if payload.len() < 126 {
            f.push(0x80 | payload.len() as u8);
        } else {
            f.push(0x80 | 126);
            f.extend_from_slice(&(payload.len() as u16).to_be_bytes());
        }
        f.extend_from_slice(&mask);
        f.extend(payload.iter().enumerate().map(|(i, b)| b ^ mask[i % 4]));
        f
    }

    #[test]
    fn frames_round_trip() {
        let msg = r#"{"t":"pair","code":"123456"}"#;
        assert_eq!(
            read_frame(&mut masked(1, msg.as_bytes()).as_slice()).unwrap(),
            Frame::Text(msg.into())
        );
        let long = "x".repeat(300);
        assert_eq!(
            read_frame(&mut masked(1, long.as_bytes()).as_slice()).unwrap(),
            Frame::Text(long.clone())
        );
        assert_eq!(
            read_frame(&mut masked(8, &[]).as_slice()).unwrap(),
            Frame::Close
        );
        // Server frames are unmasked; a client frame that isn't masked is refused.
        let mut out = vec![];
        write_text(&mut out, &long).unwrap();
        assert_eq!(&out[..4], &[0x81, 126, 1, 44]);
        assert!(read_frame(&mut out.as_slice()).is_err());
        assert!(read_frame(&mut masked(2, b"bin").as_slice()).is_err());
    }
}
