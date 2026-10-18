//! The helper end to end over a real loopback socket: the handshake's Host and Origin checks, pairing, nothing sent
//! before pairing, capture only while a paired page is connected, and the device layer's messages reaching the page.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use jj_input_helper::backend::{Backend, Sink};
use jj_input_helper::hub::DeviceEvent;
use jj_input_helper::protocol::Kind;
use jj_input_helper::server::{Config, Server};
use serde_json::Value;

const ORIGIN: &str = "http://127.0.0.1:9";

/// A backend the test drives: `start` hands the test its sink, `stop` is recorded.
struct Rig {
    sinks: Sender<Option<Sink>>,
}

impl Backend for Rig {
    fn start(&mut self, sink: Sink) {
        self.sinks.send(Some(sink)).unwrap();
    }
    fn stop(&mut self) {
        self.sinks.send(None).unwrap();
    }
}

/// The port, the capture starts/stops the backend saw, and the helper's status lines.
type Helper = (u16, Receiver<Option<Sink>>, Arc<Mutex<Vec<String>>>);

fn helper() -> Helper {
    let server = Server::bind(Config {
        port: 0,
        allowed: vec![ORIGIN.into()],
        store: None,
        code: Some("246810".into()),
    })
    .unwrap();
    let port = server.port();
    let (tx, rx) = channel();
    let said = Arc::new(Mutex::new(vec![]));
    let log = said.clone();
    std::thread::spawn(move || {
        server.run(Box::new(Rig { sinks: tx }), &mut |l| {
            log.lock().unwrap().push(l.to_owned())
        })
    });
    (port, rx, said)
}

fn handshake(port: u16, host: &str, origin: &str) -> (TcpStream, String) {
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    write!(
        s,
        "GET / HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: {origin}\r\n\r\n"
    )
    .unwrap();
    let mut r = BufReader::new(s.try_clone().unwrap());
    let mut status = String::new();
    r.read_line(&mut status).unwrap();
    loop {
        let mut l = String::new();
        if r.read_line(&mut l).unwrap() == 0 || l == "\r\n" {
            break;
        }
    }
    (s, status)
}

fn send(s: &mut TcpStream, text: &str) {
    let mask = [9u8, 8, 7, 6];
    let mut f = vec![0x81, 0x80 | text.len() as u8];
    f.extend_from_slice(&mask);
    f.extend(text.bytes().enumerate().map(|(i, b)| b ^ mask[i % 4]));
    s.write_all(&f).unwrap();
}

fn recv(s: &mut TcpStream) -> Value {
    let mut h = [0u8; 2];
    s.read_exact(&mut h).unwrap();
    assert_eq!(h[0], 0x81, "a text frame");
    let mut len = (h[1] & 0x7f) as usize;
    if len == 126 {
        let mut b = [0u8; 2];
        s.read_exact(&mut b).unwrap();
        len = u16::from_be_bytes(b) as usize;
    }
    let mut p = vec![0u8; len];
    s.read_exact(&mut p).unwrap();
    serde_json::from_slice(&p).unwrap()
}

#[test]
fn only_allowed_origins_on_loopback_get_in() {
    let (port, _, _) = helper();
    let (_, s) = handshake(port, "evil.example", ORIGIN);
    assert!(s.starts_with("HTTP/1.1 403"), "{s}");
    let (_, s) = handshake(port, &format!("127.0.0.1:{port}"), "https://evil.example");
    assert!(s.starts_with("HTTP/1.1 403"), "{s}");
    let (_, s) = handshake(port, &format!("localhost:{port}"), ORIGIN);
    assert!(s.starts_with("HTTP/1.1 101"), "{s}");
}

#[test]
fn pairs_then_streams_devices_and_captures_only_while_paired() {
    let (port, sinks, said) = helper();
    let (mut page, status) = handshake(port, &format!("127.0.0.1:{port}"), ORIGIN);
    assert!(status.starts_with("HTTP/1.1 101"), "{status}");
    assert_eq!(recv(&mut page)["t"], "hello");

    // Wrong code: refused, and no capture starts.
    send(&mut page, r#"{"t":"pair","code":"000000"}"#);
    assert_eq!(recv(&mut page)["t"], "unpaired");
    assert!(sinks.recv_timeout(Duration::from_millis(200)).is_err());

    send(&mut page, r#"{"t":"pair","code":"246810"}"#);
    let paired = recv(&mut page);
    assert_eq!(paired["t"], "paired");
    let token = paired["token"].as_str().unwrap().to_owned();
    assert_eq!(recv(&mut page)["t"], "devices", "the snapshot follows");
    let sink = sinks
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .expect("capture starts when a page pairs");

    // Two keyboards and a pad; the second keyboard's W reaches the page as that keyboard's keys.
    for (handle, kind) in [(1, Kind::Keyboard), (2, Kind::Keyboard), (3, Kind::Pad)] {
        sink.send(DeviceEvent::Added {
            handle,
            stable: format!("dev{handle}"),
            kind,
            name: format!("Device {handle}"),
        });
        let d = recv(&mut page);
        assert_eq!(d["devices"].as_array().unwrap().len(), handle as usize);
    }
    sink.send(DeviceEvent::Key {
        handle: 2,
        code: "KeyW".into(),
        down: true,
    });
    let k = recv(&mut page);
    assert_eq!((k["t"].as_str(), k["id"].as_u64()), (Some("keys"), Some(2)));
    assert_eq!(k["down"][0], "KeyW");

    // A second page that hasn't paired hears nothing; with the first page's token it pairs (same origin).
    let (mut other, _) = handshake(port, &format!("127.0.0.1:{port}"), ORIGIN);
    assert_eq!(recv(&mut other)["t"], "hello");
    sink.send(DeviceEvent::Key {
        handle: 1,
        code: "KeyS".into(),
        down: true,
    });
    assert_eq!(recv(&mut page)["id"], 1);
    other
        .set_read_timeout(Some(Duration::from_millis(300)))
        .unwrap();
    let mut b = [0u8; 1];
    assert!(other.read(&mut b).is_err(), "an unpaired page gets nothing");
    other
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    send(&mut other, &format!(r#"{{"t":"pair","token":"{token}"}}"#));
    assert_eq!(recv(&mut other)["t"], "paired");
    let snap = recv(&mut other);
    assert_eq!(snap["devices"].as_array().unwrap().len(), 3);

    // Both pages leave: capture stops (devices closed) and the window says so.
    drop(page);
    drop(other);
    assert!(
        sinks
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .is_none(),
        "capture stops when no paired page is left"
    );
    let mut log = String::new();
    for _ in 0..50 {
        log = said.lock().unwrap().join("\n");
        if log.ends_with("\nNot capturing: no game page is paired.") && log.contains("\nCapturing")
        {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(log.contains("Pairing code: 246810"), "{log}");
    assert!(log.contains("Capturing 2 keyboards and 1 pad"), "{log}");
    assert!(
        log.ends_with("\nNot capturing: no game page is paired."),
        "{log}"
    );
}
