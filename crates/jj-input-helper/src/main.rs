//! `jj-input-helper`: run it on the host computer, type the code it shows into the game's Keys & pads drawer, and every
//! keyboard and pad on this computer is its own player. See the crate docs and `docs/evidence/P1-C12.1/receipt.md`.
//!
//! ```text
//! jj-input-helper [--port 47123] [--allow-origin https://example] [--backend native|stdin] [--only NAME]
//!                 [--grab] [--state FILE|none]
//! ```

use std::io::Write;

use jj_input_helper::backend::{self, Backend, Scripted};
use jj_input_helper::pairing::default_store;
use jj_input_helper::server::{Config, Server};
use jj_input_helper::{DEFAULT_ORIGINS, DEFAULT_PORT};

const USAGE: &str = "jj-input-helper: one player per keyboard and per pad for Joystick Jammers.

  --port N              listen on 127.0.0.1:N (default 47123; the game looks there)
  --allow-origin URL    also accept this site (repeatable; the game's own sites are always accepted)
  --backend native      read this computer's keyboards and pads (default)
  --backend stdin       read scripted device events, one JSON line each (tests)
  --only NAME           only devices whose name contains NAME
  --grab                Linux: take the devices exclusively (their keys stop reaching the desktop)
  --state FILE|none     where pairings are kept (default: the user's config folder)
  --pair-code CODE      the first pairing code (tests; otherwise random)
  --version";

fn main() {
    let mut args = std::env::args().skip(1);
    let mut port = DEFAULT_PORT;
    let mut allowed: Vec<String> = DEFAULT_ORIGINS.iter().map(|s| (*s).to_owned()).collect();
    let mut scripted = false;
    let mut only = None;
    let mut grab = false;
    let mut store = default_store();
    let mut code = None;
    while let Some(a) = args.next() {
        let mut val = |name: &str| {
            args.next().unwrap_or_else(|| {
                eprintln!("{name} needs a value\n\n{USAGE}");
                std::process::exit(2)
            })
        };
        match a.as_str() {
            "--port" => {
                port = val("--port").parse().unwrap_or_else(|_| {
                    eprintln!("--port takes a number");
                    std::process::exit(2)
                })
            }
            "--allow-origin" => {
                allowed.push(val("--allow-origin").trim_end_matches('/').to_owned())
            }
            "--backend" => scripted = val("--backend") == "stdin",
            "--only" => only = Some(val("--only")),
            "--grab" => grab = true,
            "--state" => {
                let v = val("--state");
                store = (v != "none").then(|| v.into());
            }
            "--pair-code" => code = Some(val("--pair-code")),
            "--version" => {
                println!("jj-input-helper {}", env!("CARGO_PKG_VERSION"));
                return;
            }
            _ => {
                eprintln!("{USAGE}");
                std::process::exit(if a == "--help" || a == "-h" { 0 } else { 2 });
            }
        }
    }
    let server = match Server::bind(Config {
        port,
        allowed,
        store,
        code,
    }) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Can't listen on 127.0.0.1:{port}: {e} (is another helper already running?)");
            std::process::exit(1);
        }
    };
    let backend: Box<dyn Backend> = if scripted {
        Box::new(Scripted::stdin())
    } else {
        backend::native(only, grab)
    };
    let mut out = std::io::stdout();
    server.run(backend, &mut |line| {
        let _ = writeln!(out, "{line}");
        let _ = out.flush();
    });
}
