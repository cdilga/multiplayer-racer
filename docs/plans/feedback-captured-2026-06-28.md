# Captured Feedback — Multiplayer Racer (To-Do subtasks)

> Source: Microsoft To-Do task "Multiplayer racer", pulled 2026-06-28 via browser-harness.
> Verbatim subtask text, grouped into themes. This is the raw input for the design pass.

## Raw subtasks (verbatim, in list order)

1. Add account (pay once for offline, $6 a month for online, can pay for one month (see if chargebacks happen and can kill me))
2. Invite system — send a code to someone else. Flow allows them to choose a controller only (join) if they can see the screen, or to duplicate the screen if they can't see it (remote mode, sync with host screen) and their phone can still join.
3. Account system?
4. Bug tracker
5. Fix some bugs with maps
6. Better map system
7. Actual game assets
8. Fix curb
9. Fix scrolly join window and make transparent
10. Fix spinners on start and skip them
11. Hide in-progress join QR code when in lobby
12. Join screen no scrolling at all allowed, only nav buttons or sth
13. Better controller tutorial including a left hand side "ghost" move left right thing.
14. Add left hand controller forward and backwards shooting mode instead of "fire" button below in middle triangle
15. Right hand side controller with acceleration forward back stick
16. Add configurable controller schemes — each needs a tutorial setup + description of controls
17. Camera angle needs to be far clearer on cars, higher angle, and in general better for big screen
18. Split camera modes, so that if cars get too far away, one camera splits into 2 cameras at least, perhaps more
19. Full n-player splitscreen mode, in a dynamic grid, as players join etc.
20. Bigger setup for big screens, current scales are BAD
21. Names and badges much bigger
22. (allow switching between camera modes in settings)
23. Derby camera mode default ONE huge overhead mode, but zoom more aggressively, and higher angle of incidence
24. Rejoin mechanic is kinda weak, we had some cases where players would get kinda stuck. Rejoining should be easier. If a player dc's their car should go transparent
25. Automatic out of bounds reset — similar to flipping
26. Some gun sounds are bad, esp homing missile. Terrible, needs to be addressed and fixed
27. Corners of generated maps are inverted
28. Friction on the boundaries is too aggressive, cars essentially stop instead of being pushed around the track, perhaps add small angled sections like a curb to assist steering the cars. Should be more suspension-bouncy, and auto-steering type physics.
29. Add a keyboard set of options as well, wasd + arrows and some nearby keys for shooting forward and backwards. Allow any n number of keyboards with no max. I don't care if we have like, 60 players and it sucks, let the players be free! no player caps!

## Thematic grouping

- **A. Camera & big-screen presentation** — 17, 18, 19, 20, 21, 22, 23
- **B. Controllers & input schemes** — 13, 14, 15, 16, 29
- **C. Vehicle physics & feel** — 25, 28
- **D. Maps / tracks** — 5, 6, 8, 27
- **E. Onboarding / join UX** — 9, 10, 11, 12
- **F. Networking / multiplayer flow** — 2, 24
- **G. Audio** — 26
- **H. Assets** — 7
- **I. Meta / business** — 1, 3, 4
