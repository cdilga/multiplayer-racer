# P1-N03 receipt: rooms and signalling

The code landed with P1-N02's commit 6db165a (`crates/jj-server/src/{app.rs,rooms.rs,rate.rs}`), since the server
skeleton and its room API were built together; this receipt names the bead and maps its acceptance to the tests that
CI runs (`cargo test --workspace`, `crates/jj-server/src/tests.rs`).

| AC | Test |
|---|---|
| create → resolve → register (ICE servers in the response) → offer/answer/candidates over SSE | `create_resolve_register_and_exchange_offer_answer_candidates_over_sse` |
| a retried create returns the same room | `a_retried_create_returns_the_same_room` |
| after a restart the host's PUT keeps the code and controllers re-register | `after_a_restart_the_host_keeps_its_code_and_controllers_re_register` |
| forged/missing ticket 403; taken code → fresh code, same roomId; ended room can't re-register | `forged_tickets_taken_codes_and_ended_rooms` |
| reused endpointId with another hash 409; wrong bearer 401 | `endpoint_conflicts_and_wrong_bearers` |
| host-unreachable after 30 s, dropped after 10 min (virtual time) | `host_unreachable_after_30_s_and_dropped_after_10_min_virtual_time` |
| 100 registrations from one IP all succeed | `a_hundred_registrations_from_one_ip_all_succeed` |
| Last-Event-ID resume within 60 s, exactly once | `last_event_id_resume_delivers_missed_messages_once_within_60_s` |
| bursts get 429 {retryAfterMs}, succeed after waiting; never refused permanently | `bursts_get_429_with_retry_after_and_then_succeed` |
| after a restart: 404 unknown-room; GET rooms/<code> states; end leaves a tombstone | `after_a_restart_the_host_keeps_its_code_and_controllers_re_register`, `forged_tickets_taken_codes_and_ended_rooms` |
| codes use ROOM_CODE_ALPHABET, skip the deny-list, retry on collision | `codes_use_the_alphabet_skip_the_deny_list_and_retry_on_collision` |
| POST /ice with the bearer (401 otherwise); /ice/fallback 503 relay-unavailable until N04b | `ice_refresh_needs_the_endpoint_bearer_and_fallback_is_relay_unavailable` |

End to end over real WebRTC: `web/shared/transport/tests/transport.test.mjs` and the journeys (JN1, JN7) drive the same
routes through the browser transport.
