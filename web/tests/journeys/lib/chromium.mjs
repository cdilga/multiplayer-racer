// The journeys' Chromium launch arguments. Default: SwiftShader (software WebGL, as on CI runners without a GPU).
// `JJ_CHROMIUM_GPU=1` renders the host through ANGLE on Vulkan instead (eris's RTX 2080 Super headless): timing
// receipts that depend on host frame time (Identify press-to-visible) are measured that way and say so.
// `JJ_CHROMIUM_GPU=native` leaves the GL choice to Chromium (a Mac's Metal GPU).
// `JJ_CHROMIUM_GPU=render` (a CI browser slot that sees a GPU, scripts/ci/run-slot.mjs): the same ANGLE-on-Vulkan pages,
// but `gpu` stays false, so the file asserts exactly what it asserts on a SwiftShader slot. The GPU only takes the
// rendering off the runner's CPU; hardware-only checks stay in gpu.yml (br-15gd).
import { afterEach } from 'node:test';
const mode = process.env.JJ_CHROMIUM_GPU ?? '0';
export const gpu = mode === '1' || mode === 'native';
const GPU_ARGS = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'];
/** For files that launch Chromium with its defaults: nothing added, except on a CI slot with a GPU (`render`, br-15gd). */
export const slotArgs = mode === 'render' ? GPU_ARGS : [];
export const chromiumArgs = [
  '--disable-features=WebRtcHideLocalIpsWithMdns',
  ...(mode === '1' || mode === 'render'
    ? GPU_ARGS
    : mode === 'native'
      ? ['--ignore-gpu-blocklist', '--enable-gpu']
      : ['--use-gl=swiftshader', '--enable-unsafe-swiftshader']),
];

/**
 * Closes every browser context a test left open, after each test of the file. A live host page keeps rendering (and
 * its sim worker keeps stepping) until its context closes, and every page of one browser shares one GPU process: on
 * SwiftShader, three leaked live hosts slowed the next host's open from 1 s to 7 s, and a fourth never reached the
 * Lobby (run 1547's c07-settings and c08-hub; reproduced in the CI image on triton: 1.2, 1.4, 5.8, 7.8 s, then 90 s
 * timeouts, and 0.9-1.2 s every time with each context closed). Only for files whose tests each open their own pages.
 * @param {() => import('playwright').Browser | undefined} getBrowser
 */
export function closeContextsAfterEach(getBrowser) {
  afterEach(async () => {
    for (const ctx of getBrowser()?.contexts() ?? []) await ctx.close().catch(() => {});
  });
}
