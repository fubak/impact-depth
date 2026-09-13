# Audio banks — provenance and acceptance

Shipped WAVs under `public/assets/audio/` are **fallback-generated** project-owned
synthesis (`scripts/generate-audio-banks.mjs`). They are reliable CI/offline
cues, not operator-accepted production audio. Ledger SSOT:
`public/assets/manifest.json` → `audioBanks` + `licenseLedger` id
`procedural-audio-banks-v1`.

Runtime still starts a procedural oscillator if a bank is missing, still
loading, or fails to decode. Gesture unlock and mute stay required; audio never
writes simulation state.

## Bank ledger

| Cue | File | Duration | Status |
| --- | --- | --- | --- |
| UI click | `audio/click.wav` | 0.06s | fallback-generated |
| Torpedo launch | `audio/torpedo.wav` | 0.50s | fallback-generated |
| Explosion / kill | `audio/explosion.wav` | 1.00s | fallback-generated |
| Sonar ping | `audio/sonar.wav` | 0.55s | fallback-generated |
| Countermeasure | `audio/countermeasure.wav` | 0.30s | fallback-generated |
| Hull alarm | `audio/alarm.wav` | 0.20s | fallback-generated |
| Powerup pickup | `audio/pickup.wav` | 0.22s | fallback-generated |
| Engine bed | `audio/engine.wav` | 1.50s | fallback-generated |
| Primary ambience | `audio/ambient.wav` | 3.50s | fallback-generated |
| Second ambience | `audio/ambient2.wav` | 3.50s | fallback-generated |

Creator/source/license for every row: Silent Depths in-process synthesis,
project-owned. Replacements must change the ledger (and cache version if CDN
cached) and remain `fallback-generated` until heard on the target machine.

## Operator listening checklist (PENDING)

Do not mark `production-accepted` or Plan 014 content ACCEPT without this pass
on desktop Chromium with a real output device:

- [ ] UI click
- [ ] Sonar
- [ ] Torpedo
- [ ] Explosion
- [ ] Countermeasure
- [ ] Alarm
- [ ] Engine bed vs speed (and speed-change chatter does not replace the bed)
- [ ] Ambience (fallback → loaded bank, plus `ambient2` layer)
- [ ] Mute / unmute
- [ ] Restart
- [ ] No clipping during combat

Operator listening acceptance: **PENDING**
