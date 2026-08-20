# Incident Console

A tiny terminal NOC dashboard — the codebase all lab tasks run against. Zero dependencies, Node 22+.

```bash
node console/src/dash.mjs          # live dashboard, q to quit
node console/src/dash.mjs --once   # one frame, no fullscreen (smoke test)
node --test console/test/*.test.mjs   # tests
```

Metrics are fake but **deterministic** (seeded PRNG): every machine sees the same stream, so what the presenter shows is what you see.

## Layout

| File | Does |
|---|---|
| `src/dash.mjs` | entry: render loop, screen handling |
| `src/metrics.mjs` | seeded fake metrics generator |
| `src/thresholds.mjs` | gauge status thresholds + `statusFor()` |
| `src/gauges.mjs` | gauge bar rendering |
| `src/sparkline.mjs` | unicode sparkline |
| `src/logpanel.mjs` | rolling log + event derivation |
| `src/services.mjs` | seeded per-service metrics + degradation windows |
| `src/svcpanel.mjs` | services table rendering (worst first) |
| `src/ansi.mjs` | ANSI color/screen helpers |
| `test/` | `node --test` specs |
