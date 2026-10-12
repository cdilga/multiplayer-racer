# Local CI repair self-review — 2026-10-12

Build: candidate after 58126f19. Mac, Chromium via Playwright; emulated phone/laptop/TV viewports, emulated pads. Local Rust server /tmp/jj-macos-server-w01 and real WebRTC join path. This is local evidence; deployed review remains required.

Inspected all eleven JPEGs in this directory at their captured states. The five short landscape sizes (640×300, 740×360, 800×300, 844×340, 844×390) retain the full toolbar, readable name, sticks inside their zones and no scroll/overlap. Reduced inter-tool spacing fixes the reproduced 640×300 clipping without changing target sizes. The dropped-in phone shows its own number and the racing tool set. TV lobby, countdown, twelve-player racing, churn, intermission and shrunk lobby retain clear QR/readiness/vehicle flow; racing has no floating Controllers drawer.

Validation: phone landscape and JN5 real mixed join/leave journeys 2/2; component kit 11/11; numpad reliable join followed by applied wire sequence 1/1; typecheck green. JN5 holds vehicle-confirmation keys until the room applies them and observes their neutral release before Ready. Numpad observes applied input separately from reliable join. The component reference still compares every design token except the explicitly approved R13 identity rule/pattern extension; frozen sheet hashes remain intact.

JN5 ran concurrently with other browser work: five drop-in samples had p95 7548ms on this loaded local run. This is behavioural churn evidence, not a latency qualification (the earlier isolated native Chromium owner-flow receipt measured 271ms). No CI/deployed/physical-device pass is claimed here.
