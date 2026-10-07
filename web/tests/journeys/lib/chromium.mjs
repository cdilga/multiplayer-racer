// The journeys' Chromium launch arguments. Default: SwiftShader (software WebGL, as on CI runners without a GPU).
// `JJ_CHROMIUM_GPU=1` renders the host through ANGLE on Vulkan instead (eris's RTX 2080 Super headless): timing
// receipts that depend on host frame time (Identify press-to-visible) are measured that way and say so.
// `JJ_CHROMIUM_GPU=native` leaves the GL choice to Chromium (a Mac's Metal GPU).
const mode = process.env.JJ_CHROMIUM_GPU ?? '0';
export const gpu = mode === '1' || mode === 'native';
export const chromiumArgs = [
  '--disable-features=WebRtcHideLocalIpsWithMdns',
  ...(mode === '1'
    ? ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu']
    : mode === 'native'
      ? ['--ignore-gpu-blocklist']
      : ['--use-gl=swiftshader', '--enable-unsafe-swiftshader']),
];
