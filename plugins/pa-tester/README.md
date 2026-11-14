# Tessera plugin: Pressure Advance tester

[Русская версия](README.ru.md)

Optional Tessera plugin for the Klipper module **`pa_tester`** (Pressure Advance measured
with a load cell in the nozzle). It adds a **Pressure Advance** tab to the core
*Calibrations* page through the extension point `@core/calibrations#tabs`, and a live
graph of the load cell. Written in [Lit](https://lit.dev), like the Shake&Tune plugin.

| Surface | What it does |
|---|---|
| Extension of `@core/calibrations#tabs` (tab, append) | `TEST_PRESSURE_ADVANCE` / `PA_CALIBRATE` with their parameters, a read-only G-code preview, confirmation before PA is changed, the parsed result, and the live load cell graph |
| Overlay (empty) | keeps the plugin api available to the guard from app start |
| Guard `printer.gcode.script` | `TEST_PRESSURE_ADVANCE` and `PA_CALIBRATE` from other plugins (console, macros) are refused while printing, with axes not homed or with a cold extruder |

## Requirements

- The `pa_tester` module in Klipper: a `[pa_tester]` section in `printer.cfg`. It lives in
  the `generic-cartesian` branch of the dmbutyugin/klipper fork, **not in mainline
  Klipper**. It needs NumPy in the Klipper environment and a load cell (`[load_cell]` or
  `[load_cell_probe]`) in the nozzle; `max_extrude_cross_section` in `[extruder]` must allow
  the high flow.
- Tessera with plugin API **1.0** or newer and
  `@core/calibrations` 3.0.0 or newer. `tessera-ext` refuses to install on an older Tessera.

The tab is always in Calibrations. On a printer without `[pa_tester]` it shows how to set the
module up (the fork branch, NumPy, the section to add, a full Klipper restart) and a **Check
again** button; it also looks again by itself after a Klipper restart or config change. Without a
load cell the tab is shown with an explanation and **Run** is blocked.

## Commands

| Button | Command | Effect |
|---|---|---|
| Test | `TEST_PRESSURE_ADVANCE` | measures and reports |
| Calibrate | `PA_CALIBRATE` | measures and applies the result with `SET_PRESSURE_ADVANCE` (asks for a confirmation) |

Methods: `step_response` (PA per extrusion flow and overall) and `search_overshoot`
(search in `PA_RANGE`). `METHOD` is always sent, so the preview shows what really runs.
Other fields are sent only when filled in: `SLOW_FLOW`, `HIGH_FLOW`, `PURGE_LENGTH`,
`SEGMENT_TIME`, `TEST_REPETITIONS`, `FILTER_WINDOW`, `EXTRUDE_FORCE_SIGN`, `PA_RANGE`,
`EXTRUDER`, `FORCE_SENSOR`. Placeholders are the values of your `[pa_tester]`. The ranges are
the module's own (`high_flow` greater than `slow_flow`, `PA_RANGE` below 2.0, …): an invalid
value is marked and the command is not sent.

The module writes no result file. Everything is read from the console: live from
`notify_gcode_response`, and from `server.gcode_store` when the tab is opened during a run
that was started elsewhere. **Apply** after a Test sends `SET_PRESSURE_ADVANCE` (lost on
restart: put the value into `[extruder] pressure_advance`).

The guard works for commands typed in the Tessera console. Commands sent from outside
Tessera (Mainsail, Fluidd, the KAPAT/autopa web UIs, a terminal) bypass it.

## Load cell graph

The graph draws the force sensor with [uPlot](https://github.com/leeoniya/uPlot), the same
library the *Heaters* tab uses. The data comes from Klipper's `load_cell/dump_force`
webhook — **every sample the sensor produces**, tens to hundreds per second. Moonraker serves it
only on its raw bridge `/klippysocket`, so the plugin asks the host for it with
`handle.klippyStream(…)` (plugin API 0.9): the host opens and owns that socket. The
Tessera nginx site proxies `/klippysocket` like `/websocket` (added by `install.sh`;
rerun *Update* of Tessera on an existing installation).

- The stream is on only while the graph is shown and the browser page is visible. Klipper
  has no "unsubscribe": the host closes the socket when the last listener goes away. A
  stream left on loads Klipper, so hide the graph when you do not need it.
- If the bridge is not reachable (no `/klippysocket` in nginx, mixed content on HTTPS),
  the graph falls back to the regular status subscription, about 4 samples per second, and
  says so in a badge.
- Without calibration the cell reports no grams: the graph then shows counts relative to
  the tare.

### Filters

The filters change only what is drawn; the buffer keeps what the sensor sent, so switching
is instant. The window is set in milliseconds (20 to 2000).

- **Raw**, **Average** (fixed windows), **Moving average**, **Moving median** (drops single
  spikes without blurring edges) and **Min/max envelope** (two lines: minimum in the theme's
  cold colour, maximum in the heat colour, so the noise stays visible).
- *Show raw* draws the unfiltered trace faintly under a filtered one.
- **Mains filter** (50 or 60 Hz) can be combined with any of the above. It is a moving average
  over exactly one mains period: it nulls the mains frequency and all its harmonics and keeps
  the force level. It runs on the sensor's own samples, before they are binned, so it needs
  a fast sensor (at least 4 samples per mains period, about 200 Hz or more). On a slow
  sensor (for example HX711 at 10 to 80 Hz) hum cannot be removed, the samples pass through
  unchanged and a badge says so; the same holds for the ≈4 Hz status fallback. Switching it
  restarts the trace.

## Development

The sources live in the registry repository, `Tessera-Ext/plugins/pa-tester/`. Clone
Tessera next to it; the build and the type check expect this layout (`TESSERA_ROOT`
overrides it for the build and `pack`):

```
…/Tessera/                        host (dev server, plugin-sdk types, registry-pack.cjs)
…/Tessera-Ext/plugins/pa-tester/  this plugin
```

```bash
npm install
npm run dev        # vite build --watch → dist/ and Tessera/extensions/pa-tester/
npm test           # parser, commands, run state, graph source + host contract test
npm run typecheck
```

In Tessera, run `node tools/extensions-sync.cjs` once so the catalog lists the plugin.
Then Settings → Plugins → Install "Pressure Advance tester", and F5 after code changes.

## Publishing

Bump `version` in `manifest.json`, run `npm run pack` (builds and writes
`registry/pa-tester-<version>.tar.gz` and its `registry.json` entry), run
`node scripts/verify-registry.mjs` in the repository root, commit sources, archive and
`registry.json` together.

## How it plugs into Tessera

| File | Integration point |
|---|---|
| `manifest.json` | `extensions[]`: point `@core/calibrations#tabs`, kind `tab`, no `available` (always shown); `pluginApi: "1.0"` |
| `src/ui/pa-tab.ts` | the contribution itself: a whole tab, command form, preview, result, graph panel |
| `src/ui/pa-controller.ts` | Moonraker subscriptions bound to the element and the active printer; owns the graph source |
| `src/force-source.ts` | `klippyStream` of the host, with the status subscription as fallback |
| `src/ui/force-chart.ts` | uPlot in a shadow root, theme colours read from the host's CSS tokens |
| `src/run-store.ts` | run state at module level: the host unmounts the tab whenever the user leaves it |
| `src/parse.ts` | `pa_tester` console output → result; run boundaries; history restore |
| `src/guard.ts` | own guard; own requests skip own guards, so the Run button checks the same conditions |
