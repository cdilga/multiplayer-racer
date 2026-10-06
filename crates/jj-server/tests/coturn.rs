//! P1-N04: a credential minted by the ICE provider allocates on a real coturn (`use-auth-secret`), checked with the
//! same probe that did the 2026-10-02 live WAN allocation (`tools/net/turn_probe.py`).
//!
//! Needs `turnserver` (coturn) and `python3` on PATH. Without coturn the test skips, unless `JJ_COTURN_REQUIRED=1`
//! (CI) makes a missing coturn a failure.

use std::net::UdpSocket;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use jj_server::ice::{CoturnProvider, IceProvider};

fn have(cmd: &str) -> bool {
    Command::new("sh")
        .arg("-c")
        .arg(format!("command -v {cmd}"))
        .stdout(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

#[test]
fn a_minted_credential_allocates_on_a_local_coturn() {
    if !have("turnserver") {
        assert!(
            std::env::var("JJ_COTURN_REQUIRED").is_err(),
            "JJ_COTURN_REQUIRED is set but coturn isn't installed"
        );
        eprintln!("skipped: coturn (turnserver) isn't installed");
        return;
    }
    let port = UdpSocket::bind("127.0.0.1:0")
        .expect("a free UDP port")
        .local_addr()
        .expect("addr")
        .port();
    let secret = "jj-test-secret";
    let mut coturn = Command::new("turnserver")
        .args([
            "-n",
            "--listening-ip=127.0.0.1",
            "--relay-ip=127.0.0.1",
            &format!("--listening-port={port}"),
            "--use-auth-secret",
            &format!("--static-auth-secret={secret}"),
            "--realm=jj.test",
            "--no-tls",
            "--no-cli",
            "--fingerprint",
            "--min-port=49152",
            "--max-port=65535",
            "--log-file=stdout",
            "--simple-log",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("turnserver starts");
    std::thread::sleep(Duration::from_millis(800));

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis() as u64;
    let provider = CoturnProvider::new(Some(secret.as_bytes().to_vec()));
    let (list, _) = provider.initial("c-probe", now_ms);
    let turn = list
        .iter()
        .find(|s| s.urls[0].starts_with("turn:"))
        .expect("a TURN entry");
    let probe = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/net/turn_probe.py");
    let out = Command::new("python3")
        .arg(&probe)
        .args(["--host", "127.0.0.1", "--port", &port.to_string()])
        .args(["--username", turn.username.as_deref().expect("username")])
        .args([
            "--credential",
            turn.credential.as_deref().expect("credential"),
        ])
        .output()
        .expect("the probe runs");
    let _ = coturn.kill();
    let _ = coturn.wait();
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(
        out.status.success() && text.contains("TURN allocate: OK"),
        "probe failed: {text}"
    );

    // A wrong secret is refused.
    let bad = CoturnProvider::new(Some(b"wrong".to_vec()));
    assert_ne!(
        bad.initial("c-probe", now_ms).0[1].credential,
        turn.credential
    );
}
