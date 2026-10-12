//! The built web bundle (`web/dist`), served under any base path `B` (`/` in production, `/p/<id>/` in a preview).
//!
//! One build serves every base: Vite builds with a relative base (`JJ_BASE=./`), so JS, CSS and workers find their
//! chunks relative to their own URL. Only the HTML pages name assets relative to the page, and the pages are served at
//! paths that don't match their place in `dist/` (`B/j/ABCD` serves `controller/index.html`), so the server rewrites
//! those references to absolute `B/assets/…` when it loads the bundle, and adds `<meta name="jj-base">` for the apps'
//! API calls (`docs/learnings/server.md`).

use std::collections::HashMap;
use std::path::Path;

use crate::http::{IMMUTABLE, NO_CACHE, Response};

/// The page each route serves.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Page {
    Landing,
    Host,
    Controller,
    /// Credits and licences (P1-C09).
    Credits,
}

impl Page {
    fn file(self) -> &'static str {
        match self {
            Page::Landing => "landing/index.html",
            Page::Host => "host/index.html",
            Page::Controller => "controller/index.html",
            Page::Credits => "landing/credits/index.html",
        }
    }
}

struct File {
    bytes: Vec<u8>,
    content_type: &'static str,
}

pub struct Bundle {
    /// `assets/…` and `test/…`, keyed by their path under `dist/`.
    files: HashMap<String, File>,
    pages: HashMap<Page, Vec<u8>>,
}

pub fn content_type(path: &str) -> &'static str {
    match path.rsplit_once('.').map(|(_, e)| e).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "woff2" => "font/woff2",
        "glb" => "model/gltf-binary",
        "ogg" => "audio/ogg",
        "mp3" => "audio/mpeg",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Rewrites a page's relative asset references (`./assets/`, `../assets/`, `../../assets/` for the credits page, and the same for `test/`) to `{base}assets/`
/// and adds the base meta tag. `base` starts and ends with `/`.
///
/// With a public `origin`, `<meta content>` asset references (the share card's `og:image` and `twitter:image`) become
/// absolute URLs: link-preview scrapers don't resolve paths against the page, so a preview's card has to name its own host.
pub fn rewrite_page(html: &str, base: &str, origin: Option<&str>) -> String {
    let mut out = html.to_owned();
    for dir in ["assets/", "test/"] {
        for rel in ["../../", "../", "./"] {
            for q in ['"', '\''] {
                out = out.replace(&format!("{q}{rel}{dir}"), &format!("{q}{base}{dir}"));
            }
        }
        // A bundle built with an absolute root base (`/assets/…`) also works under any base.
        for q in ['"', '\''] {
            if base != "/" {
                out = out.replace(&format!("{q}/{dir}"), &format!("{q}{base}{dir}"));
            }
        }
    }
    if let Some(origin) = origin {
        let origin = origin.trim_end_matches('/');
        out = out.replace(
            &format!("content=\"{base}assets/"),
            &format!("content=\"{origin}{base}assets/"),
        );
    }
    let meta = format!("<meta name=\"jj-base\" content=\"{base}\" />");
    match out.find("<head>") {
        Some(i) => out.insert_str(i + "<head>".len(), &format!("\n    {meta}")),
        None => out.insert_str(0, &meta),
    }
    out
}

impl Bundle {
    pub fn empty() -> Self {
        Self {
            files: HashMap::new(),
            pages: HashMap::new(),
        }
    }

    /// Loads `dist/` into memory (the bundle is immutable for the server's life).
    pub fn load(dist: &Path, base: &str, origin: Option<&str>) -> std::io::Result<Self> {
        let mut bundle = Self::empty();
        for dir in ["assets", "test"] {
            let root = dist.join(dir);
            if root.is_dir() {
                walk(&root, &mut |p| {
                    let rel = p
                        .strip_prefix(dist)
                        .expect("under dist")
                        .to_string_lossy()
                        .replace('\\', "/");
                    let bytes = std::fs::read(p)?;
                    bundle.files.insert(
                        rel.clone(),
                        File {
                            bytes,
                            content_type: content_type(&rel),
                        },
                    );
                    Ok(())
                })?;
            }
        }
        for page in [Page::Landing, Page::Host, Page::Controller, Page::Credits] {
            let path = dist.join(page.file());
            if path.is_file() {
                let html = std::fs::read_to_string(&path)?;
                bundle
                    .pages
                    .insert(page, rewrite_page(&html, base, origin).into_bytes());
            }
        }
        Ok(bundle)
    }

    /// Adds a file directly (tests).
    pub fn insert(&mut self, rel: &str, bytes: &[u8]) {
        self.files.insert(
            rel.to_owned(),
            File {
                bytes: bytes.to_vec(),
                content_type: content_type(rel),
            },
        );
    }

    pub fn insert_page(&mut self, page: Page, html: &str, base: &str) {
        self.pages
            .insert(page, rewrite_page(html, base, None).into_bytes());
    }

    pub fn page(&self, page: Page) -> Response {
        match self.pages.get(&page) {
            Some(b) => Response::bytes(200, "text/html; charset=utf-8", b.clone()).cache(NO_CACHE),
            None => Response::not_found(),
        }
    }

    /// `assets/…` or `test/…`: immutable when found, a real 404 (never the SPA page) when not.
    pub fn file(&self, rel: &str) -> Response {
        match self.files.get(rel) {
            Some(f) => Response::bytes(200, f.content_type, f.bytes.clone())
                .cache(IMMUTABLE)
                .with_header("x-content-type-options", "nosniff"),
            None => Response::not_found(),
        }
    }

    pub fn file_count(&self) -> usize {
        self.files.len()
    }
}

fn walk(dir: &Path, f: &mut dyn FnMut(&Path) -> std::io::Result<()>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let p = entry?.path();
        if p.is_dir() {
            walk(&p, f)?;
        } else {
            f(&p)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pages_point_at_the_base() {
        let html = "<html><head>\n<script type=\"module\" src=\"../assets/host-1.js\"></script>\
                    <link href='./assets/a.css'></head></html>";
        let out = rewrite_page(html, "/p/x/", None);
        assert!(out.contains("src=\"/p/x/assets/host-1.js\""), "{out}");
        assert!(out.contains("href='/p/x/assets/a.css'"), "{out}");
        assert!(out.contains("<meta name=\"jj-base\" content=\"/p/x/\" />"));
        assert!(!out.contains("../assets"));
        // The credits page sits two folders down (`landing/credits/`).
        let deep = rewrite_page(
            "<script src=\"../../assets/credits-1.js\"></script>",
            "/p/x/",
            None,
        );
        assert!(deep.contains("src=\"/p/x/assets/credits-1.js\""), "{deep}");
    }

    #[test]
    fn root_built_pages_also_rebase() {
        let out = rewrite_page(
            "<head><script src=\"/assets/h.js\"></script></head>",
            "/p/y/",
            None,
        );
        assert!(out.contains("src=\"/p/y/assets/h.js\""), "{out}");
        let root = rewrite_page(
            "<head><script src=\"/assets/h.js\"></script></head>",
            "/",
            None,
        );
        assert!(root.contains("src=\"/assets/h.js\""), "{root}");
    }

    #[test]
    fn share_card_urls_name_the_public_origin() {
        let html = "<head><meta property=\"og:image\" content=\"/assets/og-card.png\" />\
                    <script src=\"/assets/h.js\"></script></head>";
        let out = rewrite_page(html, "/p/z/", Some("https://jammers-preview.dilger.dev/"));
        assert!(
            out.contains("content=\"https://jammers-preview.dilger.dev/p/z/assets/og-card.png\""),
            "{out}"
        );
        // Only meta content goes absolute; scripts stay on the page's own origin.
        assert!(out.contains("src=\"/p/z/assets/h.js\""), "{out}");
        let prod = rewrite_page(html, "/", Some("https://jammers.dilger.dev"));
        assert!(
            prod.contains("content=\"https://jammers.dilger.dev/assets/og-card.png\""),
            "{prod}"
        );
        // Vite emits the card relative to the page, as it does every other asset.
        let built = rewrite_page(
            "<head><meta name=\"twitter:image\" content=\"../assets/og-card.png\" /></head>",
            "/p/z/",
            Some("https://jammers-preview.dilger.dev"),
        );
        assert!(
            built.contains("content=\"https://jammers-preview.dilger.dev/p/z/assets/og-card.png\""),
            "{built}"
        );
        // Without an origin (local dev) the path is left rooted at the base.
        let dev = rewrite_page(html, "/p/z/", None);
        assert!(dev.contains("content=\"/p/z/assets/og-card.png\""), "{dev}");
    }
}
