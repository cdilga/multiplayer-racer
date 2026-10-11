# Self-review br-dx0e

Local real jj-server, fresh Vite pages based on 5191bdde with this drawer change. Mac arm64 / Apple M1 Pro. Software Playwright Chromium, native Chromium on Metal and Playwright WebKit. Four emulated pads are a sample; viewport dimensions are not physical devices.

## Looked at

- frames/software-chromium-drawer-after-fullscreen.jpg — 1920×1080, software; frame, scrolling and visible canvas inspected.
- frames/software-chromium-drawer-bottom-1366x768.jpg — 1366×768, software; frame, scrolling and visible canvas inspected.
- frames/software-chromium-drawer-bottom-1920x1080.jpg — 1920×1080, software; frame, scrolling and visible canvas inspected.
- frames/software-chromium-drawer-bottom-375x667.jpg — 375×667, software; frame, scrolling and visible canvas inspected.
- frames/software-chromium-drawer-bottom-412x915.jpg — 412×915, software; frame, scrolling and visible canvas inspected.
- frames/software-chromium-drawer-bottom-915x412.jpg — 915×412, software; frame, scrolling and visible canvas inspected.
- frames/software-chromium-drawer-fullscreen.jpg — 1920×1080, software; frame, scrolling and visible canvas inspected.
- frames/software-chromium-drawer-top-1366x768.jpg — 1366×768, software; frame, scrolling and visible canvas inspected.
- frames/software-chromium-drawer-top-1920x1080.jpg — 1920×1080, software; frame, scrolling and visible canvas inspected.
- frames/software-chromium-drawer-top-375x667.jpg — 375×667, software; frame, scrolling and visible canvas inspected.
- frames/software-chromium-drawer-top-412x915.jpg — 412×915, software; frame, scrolling and visible canvas inspected.
- frames/software-chromium-drawer-top-915x412.jpg — 915×412, software; frame, scrolling and visible canvas inspected.
- frames/software-webkit-drawer-bottom-1366x768.jpg — 1366×768, software; frame, scrolling and visible canvas inspected.
- frames/software-webkit-drawer-bottom-1920x1080.jpg — 1920×1080, software; frame, scrolling and visible canvas inspected.
- frames/software-webkit-drawer-bottom-375x667.jpg — 375×667, software; frame, scrolling and visible canvas inspected.
- frames/software-webkit-drawer-bottom-412x915.jpg — 412×915, software; frame, scrolling and visible canvas inspected.
- frames/software-webkit-drawer-bottom-915x412.jpg — 915×412, software; frame, scrolling and visible canvas inspected.
- frames/software-webkit-drawer-top-1366x768.jpg — 1366×768, software; frame, scrolling and visible canvas inspected.
- frames/software-webkit-drawer-top-1920x1080.jpg — 1920×1080, software; frame, scrolling and visible canvas inspected.
- frames/software-webkit-drawer-top-375x667.jpg — 375×667, software; frame, scrolling and visible canvas inspected.
- frames/software-webkit-drawer-top-412x915.jpg — 412×915, software; frame, scrolling and visible canvas inspected.
- frames/software-webkit-drawer-top-915x412.jpg — 915×412, software; frame, scrolling and visible canvas inspected.
- frames/native-chromium-drawer-after-fullscreen.jpg — 1920×1080, native; frame, scrolling and visible canvas inspected.
- frames/native-chromium-drawer-bottom-1366x768.jpg — 1366×768, native; frame, scrolling and visible canvas inspected.
- frames/native-chromium-drawer-bottom-1920x1080.jpg — 1920×1080, native; frame, scrolling and visible canvas inspected.
- frames/native-chromium-drawer-bottom-375x667.jpg — 375×667, native; frame, scrolling and visible canvas inspected.
- frames/native-chromium-drawer-bottom-412x915.jpg — 412×915, native; frame, scrolling and visible canvas inspected.
- frames/native-chromium-drawer-bottom-915x412.jpg — 915×412, native; frame, scrolling and visible canvas inspected.
- frames/native-chromium-drawer-fullscreen.jpg — 1920×1080, native; frame, scrolling and visible canvas inspected.
- frames/native-chromium-drawer-top-1366x768.jpg — 1366×768, native; frame, scrolling and visible canvas inspected.
- frames/native-chromium-drawer-top-1920x1080.jpg — 1920×1080, native; frame, scrolling and visible canvas inspected.
- frames/native-chromium-drawer-top-375x667.jpg — 375×667, native; frame, scrolling and visible canvas inspected.
- frames/native-chromium-drawer-top-412x915.jpg — 412×915, native; frame, scrolling and visible canvas inspected.
- frames/native-chromium-drawer-top-915x412.jpg — 915×412, native; frame, scrolling and visible canvas inspected.
- frames/live-p_c12_host_drive_1366x768.jpg — 1366×768, live; frame, scrolling and visible canvas inspected.
- frames/live-p_c12_host_drive_1366x768_after-resize.jpg — 1366×768, live; frame, scrolling and visible canvas inspected.
- frames/live-p_c12_host_drive_1920x1080.jpg — 1920×1080, live; frame, scrolling and visible canvas inspected.
- frames/live-p_c12_host_drive_1920x1080_after-resize.jpg — 1920×1080, live; frame, scrolling and visible canvas inspected.
- frames/live-p_c12_host_drive_375x667.jpg — 375×667, live; frame, scrolling and visible canvas inspected.
- frames/live-p_c12_host_drive_375x667_after-resize.jpg — 375×667, live; frame, scrolling and visible canvas inspected.
- frames/live-p_c12_host_drive_412x915.jpg — 412×915, live; frame, scrolling and visible canvas inspected.
- frames/live-p_c12_host_drive_412x915_after-resize.jpg — 412×915, live; frame, scrolling and visible canvas inspected.
- frames/live-p_c12_host_drive_915x412.jpg — 915×412, live; frame, scrolling and visible canvas inspected.
- frames/live-p_c12_host_drive_915x412_after-resize.jpg — 915×412, live; frame, scrolling and visible canvas inspected.
- frames/before-phone.jpg — original opaque scroller; navy strip below the frame inspected.
- frames/before-laptop.jpg — original opaque scroller; navy strip below the frame inspected.

Every image inspected in eight contact sheets. Expanded drawer top and bottom, five viewport sizes, real Chromium fullscreen enter/exit and live-check resize captures included. Last keyboard card remains reachable.

## Defects found and fixed

The opaque scrolling aside left a canvas-compositing hole below its clipped frame after resize. A transparent inner scroll element now sits inside the opaque, non-scrolling frame. No rows or sources removed.

## Remaining defects

No remaining drawer-strip defect in this matrix. The existing temporary welcome caption can overlap the lower card while it displays in drive mode; it is pointer-transparent and does not prevent scrolling. Tracked separately as br-m5l0.

## Not covered

Physical phones, TV output and device Safari. Real helper devices belong to P1-C12.1. Deployed preview matrix remains pending publication before close.
