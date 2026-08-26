# Page-turn performance evidence

Checked: 2026-08-26  
Runtime: Codex in-app browser, local Vite development build, normal WebGL path  
Instrumentation: `page-turn:summary` events in `#livingbook-diagnostics`

| Direction | Measured duration | Animation frames | Measured rate |
|---|---:|---:|---:|
| Forward | 821 ms | 99 | 121 FPS |
| Backward | 822 ms | 99 | 120 FPS |

The Challenge Final 1.1 acceptance floor is 45 FPS during page turn. Both measured directions pass with substantial headroom on the verified test device.

This is a device/runtime observation, not a universal performance guarantee. Production verification must repeat the measurement against the published URL in ChatGPT's in-app browser.
