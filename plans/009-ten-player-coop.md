# Plan 009: Add optional host-authoritative co-op for up to 10 players

> **Executor instructions:** Start only from a tagged solo release candidate. Treat all network messages as untrusted. Build co-op behind a feature flag so solo remains fully offline and unchanged.
>
> **Drift check:** require Plan 008 DONE, a clean worktree, and record the solo release tag/SHA in this plan before editing.

## Status

- **Priority:** P2, post-launch
- **Effort:** L (3–6 weeks plus infrastructure testing)
- **Risk:** HIGH
- **Depends on:** Plan 008
- **Category:** multiplayer, security, architecture, tests
- **Planned at:** 2026-08-02 planning snapshot

## Why this matters

Co-op is desired but not launch-blocking. The deterministic command/snapshot architecture makes it feasible after solo is stable, but a 10-peer WebRTC mesh, late join, NAT traversal, host migration, and hostile inputs require a dedicated beta rather than an incidental port.

## References and constraints

- PRD section 12 defines message roles and host-authoritative AI.
- Archived `src/game/net.ts:17-834` demonstrates compact snapshots, host election, interpolation, and late sync.
- Archived `src/lib/multiplayer/p2p.ts:12-563` demonstrates signaling, perfect-negotiation concepts, polling, recovery, and stats.
- Maximum players: 10. Friendly fire: off. Each player owns a separate submarine/magazine. Lowest stable peer ID may elect the initial host, but host migration must be explicit and tested.

## Scope

**In scope:** protocol/version schemas; validated compact commands/snapshots; room/signaling service; STUN plus production TURN plan; 2–10 peer connection lifecycle; host authority/election/migration; late join; remote interpolation; reconnect/prune; ally rendering/nameplates; feature flag; optional callsign/auth integration; rate/size limits; network simulation tests; operational docs.

**Out of scope:** dedicated authoritative game servers, public matchmaking at scale, voice chat, shared magazines, friendly fire, paid identity provider requirement, changes to solo outcomes.

## Steps and gates

1. **Architecture spike:** measure full mesh cost at 2/4/10 peers and compare host-relayed/star data topology while retaining P2P transport. Decide topology in an ADR before implementation. STOP if 10-player full mesh cannot meet bandwidth/CPU/recovery budgets.
2. **Protocol:** define versioned Zod or equivalent schemas, message size/rate limits, stable entity/event IDs, tick/ack semantics, and compatibility rejection. Never trust peer identity, coordinates, ammo, damage, score, or host claims without authority checks.
3. **Host authority:** host runs world AI/ordnance/outcomes; clients submit bounded player commands; own-sub prediction/reconciliation is optional but must not overwrite authority. Solo uses the same command path without transport.
4. **Transport/signaling:** implement room cap 10, perfect negotiation, ICE restart, heartbeat, reconnect, cleanup, and TURN credentials with short-lived server delivery. Do not place long-lived TURN/auth secrets in the client.
5. **Late join and migration:** snapshot + event baseline, fingerprint/hash, remote interpolation, stale prune, deterministic host handoff, split-brain prevention, and recovery after host loss.
6. **Presentation:** distinct ally paint/nameplates, join/leave/host/reconnect status, private callsign sanitization, and no remote control of local UI/audio.
7. **Test matrix:** 2/4/10 peers; late join during calm/combat/wave transition; host loss; packet loss/jitter/reorder; stale/duplicate/malformed/oversize messages; reconnect; incompatible protocol; TURN-only network; 60-minute soak.
8. **Beta operations:** feature flag, room metrics without sensitive payloads, abuse/rate controls, rollback to solo, privacy/security review, and documented support limits.

## Verification

- Unit/property tests validate every message boundary and idempotency rule.
- Automated multi-context Playwright tests pass at 2 and 4 peers; controlled soak harness passes at 10.
- Solo `npm run verify`, replay hashes, FPS, and offline startup remain unchanged.
- 10-player beta maintains agreed tick/bandwidth/frame budgets and survives host migration.

## Done criteria

- [ ] Rooms reject player 11 and incompatible protocols cleanly.
- [ ] Host is authoritative for AI, damage, score, waves, pickups, and outcomes.
- [ ] Friendly fire is impossible in simulation rules, not merely hidden in UI.
- [ ] Late join and host migration work during active combat.
- [ ] Malformed, duplicated, stale, oversized, and high-rate messages are bounded/rejected.
- [ ] TURN works without shipping long-lived secrets.
- [ ] Solo/offline mode has no network dependency or regression.
- [ ] 2/4/10-player soak and recovery matrix passes before public enablement.

## STOP conditions

- 10-player mesh exceeds the agreed bandwidth/CPU/connection budget.
- Correctness requires trusting a client-reported hit, score, ammo, or AI state.
- Production connectivity requires embedding persistent credentials in client code.
- Host migration cannot prevent split-brain outcomes.
- Co-op changes break the solo replay hash for identical solo commands.

## Maintenance notes

Review protocol parsers, authority boundaries, idempotency, resource cleanup, and reconnect loops as security-critical. Authentication may provide a callsign, but must never become a prerequisite for offline solo play.
