# Tessera plugin: Motion diagnostics

[Русская версия](README.ru.md)

Optional Tessera plugin that brings Klipper's **motan** (`scripts/motan`: `data_logger.py`,
`motan_graph.py`, `data_export.py`) into the browser. Record motion, stepper, accelerometer,
load cell, angle sensor, eddy current probe and TMC stallguard data, calculate derived series
(derivative, integral, filters, deviation from the expected stepper position) and look at the
graphs, without a command line, Python or files on the printer. It adds a **Motion
diagnostics** tab to the core *Machine* page through the extension point
`@core/system#tabs`. Written in [Lit](https://lit.dev) with [uPlot](https://github.com/leeoniya/uPlot).

## Requirements

- Tessera with plugin API **0.12** or newer and `@core/system` **4.0.0** or newer.
  `tessera-ext` refuses to install on an older Tessera.
- Klipper in the *ready* state while you record. Opening a saved log needs no printer.
- Moonraker's raw Klippy bridge `/klippysocket`. The Tessera nginx site proxies it like
  `/websocket` (added by `install.sh`; rerun *Update* of Tessera on an existing installation).
  Without it nothing can be recorded.
- Whatever you want to record has to exist in `printer.cfg`: `[adxl345]`, `[lis2dw]`,
  `[mpu9250]`, `[bmi160]`, `[icm20948]` or `[lis3dh]` for accelerometers, `[angle]`,
  `[probe_eddy_current]`, `[load_cell]` / `[load_cell_probe]`, and a TMC driver
  (`tmc2130`, `tmc2209`, `tmc2240`, `tmc2260`, `tmc5160`, `tmc5262`) for stallguard. Motion
  (`trapq`) and stepper step queues come with Klipper itself.

## Using it

1. **Record.** The tab asks Klipper what can be recorded and lists it in groups. Trapq and
   stepq are ticked by default, as in motan. Tick what you need, set the time limit and press
   **Record**, then run the move you want to examine. **Stop** ends it. The data stays in this
   browser tab's memory; a recording continues if you switch to another Machine tab.
2. **Analyse.** The first suitable layout is drawn at once. Choose another from the *Layout*
   list (it is applied and drawn when you pick it), or build your own: **Add series** opens a
   form where you pick a kind of data and fill its parameters from lists of what the capture has.
   Calculated series (a deviation of two series, a filter on an accelerometer) open nested
   forms. *Start*, *Length* and *Time step* are motan's `--skip`, `--duration` and
   `--segment-time`. After changing them or the series press **Build graphs**.
3. **Look.** One chart per row, sharing the time axis: drag to zoom, **Shift + wheel** zooms the time axis around the
   cursor (wheel up in, down out), double-click resets; all rows zoom together. Series with other units go to a second axis on the right, like in
   motan. Long series are thinned for drawing keeping each pixel's minimum and maximum, so
   spikes stay; zooming brings the detail back. Colour and opacity are set per series.
4. **Save.** See below.

### What can be drawn

| Data | Quantities |
|---|---|
| Requested motion (`trapq`) | position, velocity, acceleration of the toolhead, total or per axis |
| Stepper position (`stepq`) | commanded position rebuilt from the step queue, with a smoothing time |
| Stepper phase (`step_phase`) | motor phase or microstep (needs a TMC section and the stepper's queue) |
| Accelerometer | one axis |
| Angle sensor | position of the stepper it is on (uses `rotation_distance` and `gear_ratio`) |
| Eddy current probe | coil frequency, period, estimated height |
| Load cell | force in grams, raw ADC counts |
| TMC stallguard | stallguard result, current level |
| Status field | any numeric field of the printer status, as it changed during the capture |

Calculated from other series: **derivative**, **integral** (optionally pulled towards a
reference), **vector length** of two or three series, **smoothing**, **filter** (Butterworth
low-pass, high-pass, band-pass or notch, causal or zero-phase), **expected stepper position**
from the toolhead motion (cartesian and CoreXY), **CoreXY toolhead position** from two
steppers, and **difference**.

Ready-made layouts are offered only for what the capture contains: velocity and acceleration,
stepper deviation (motan's own default set), accelerometer (plain and band-passed), load
cell, stallguard, angle sensors, eddy current probe, stepper phase.

## Saving and opening

| Button | File | Use |
|---|---|---|
| Download motan log | `<name>.tar.gz` with `dump.json.gz` and `dump.index.gz` | The capture in the format of `data_logger.py`. Unpack it and run `motan_graph.py dump` or `data_export.py dump` on a computer with Klipper's scripts. This tab opens it again |
| Download PNG | `<name>.png` | All graphs in one picture with axes, titles and legends, as you see them (a zoom is kept) |
| Download CSV | `<name>.csv` | The data of the built graphs as a table in the layout of `data_export.py` |
| Open a log… | | A `.tar.gz` saved here, or the two files `*.json.gz` and `*.index.gz` made by `data_logger.py` on a printer (select both together) |

Files are named `motion-diag-<printer>-<date>-<time>`. Nothing is uploaded to the printer or
anywhere else.

## How it differs from motan

The decoders and analyzers are a port of motan's own code and give the same numbers: they are
compared with the real `data_export.py` on a real capture and on synthetic ones (see below).
Deliberate differences:

- The `skip` option reads the log from its start instead of seeking by the index. Same
  result, slower on very long logs.
- Two `stallguard` series of one driver are independent here. In motan they share a message
  list and take every other sample from each other when requested together.
- A `status(...)` field that is not a number is drawn as a gap, not written as text.
- Only cartesian and CoreXY kinematics are supported by `kin(...)`, as in motan.
- The exported log has one index entry (see above).

## Limits and costs

- Everything is kept in browser memory. The recording stops by itself at the time limit
  (60 s by default) or about 200 MB of estimated memory. `stepq` is the heavy one: at high
  speeds it produces a great deal of data. Record only the steppers you need.
- At most 400 000 points per series are computed; with the default 0.1 ms step that is
  40 s. Lengthen the step or shorten the window.
- Klipper has no "unsubscribe": a stream runs while the bridge socket is open, so a recording
  loads Klipper. Stop it when done; closing the tab does as well.
- Calculation runs in the page in chunks (no Web Worker: the default Tessera CSP does not
  allow one), so the page stays responsive, but a long window at a fine step takes seconds.

## Development

```bash
cd plugins/motion-diag
npm install
npm test            # unit tests, motan comparison, UI contract
npm run typecheck
npm run dev         # build on change into <Tessera>/extensions/motion-diag/
npm run pack        # build and write the archive into registry/
```

The comparison with motan lives in `src/__tests__/fixtures/`: captures in the on-disk format
of `data_logger.py` (synthetic cartesian and CoreXY printers) and the CSVs that the real
`data_export.py` wrote for them. `tools/gen_fixtures.py` makes them (needs a Klipper checkout
and Python with NumPy and SciPy); `tools/gen_dsp_fixtures.py` does the same for the SciPy
filters. To check a capture of your own printer, run `tools/gen_real_expected.py` on it: the
result goes to the git-ignored `local/` folder and `src/__tests__/real-log.test.ts` compares
the browser port with it.

See also: [Русская версия](README.ru.md).
