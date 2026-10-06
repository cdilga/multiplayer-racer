//! Game server: static serving, rooms, signalling, ICE provider and health (Asupersync, no Tokio; R2).
//!
//! Everything but the socket loop is runtime-free: [`app::App`] maps a [`http::Request`] to a [`http::Response`] with
//! time passed in, so the room and signalling rules are tested with virtual time. `main.rs` is the Asupersync adapter.

pub mod app;
pub mod crypto;
pub mod http;
pub mod ice;
pub mod rate;
pub mod rooms;
pub mod statics;

#[cfg(test)]
mod tests;
