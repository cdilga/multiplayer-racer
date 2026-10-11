# Launch journey setup

R116's neutral sample does not immediately cancel a pending launch. The detector
keeps its release window for 250 ms; pulling back inside it resumes the preceding
preload. A brake assertion that waits on a slow host can already have engaged
reverse before that nominally fresh pull. In br-vkdo's failure the 500 ms timer
produced a 1,200 ms action, and the host never launched.

For a fresh launch test, observe that preload has cleared; brake at the detent
outside the preload zone until the car is grounded and no longer reversing; then
pull and snap once. Check the emitted preload and the host's actual wheelie.
`Session.inspect().launch` exposes the detector and last detected action. Preserve
the original deadlines and real controller/host path.
