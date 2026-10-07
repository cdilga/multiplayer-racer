// The journeys' Chromium launch arguments. Default: SwiftShader (software WebGL, as on CI runners without a GPU).
// `JJ_CHROMIUM_GPU=1` renders the host through ANGLE on Vulkan instead (eris's RTX 2080 Super headless): timing
// receipts that depend on host frame time (Identify press-to-visible) are measured that way and say so.
export const gpu = process.env.JJ_CHROMIUM_GPU === '1';
export const chromiumArgs = [
  '--disable-features=WebRtcHideLocalIpsWithMdns',
  ...(gpu ? ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] : ['--use-gl=swiftshader', '--enable-unsafe-swiftshader']),
];
