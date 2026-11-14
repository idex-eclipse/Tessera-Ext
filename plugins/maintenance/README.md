# Tessera plugin: Maintenance

[Русская версия](README.ru.md)

Optional Tessera plugin that reminds you to service the printer. Intervals count **print
hours, prints, calendar days and kilometres of filament**; every task can be switched off,
reminders start a little before the deadline, and before a print starts Tessera shows the bed
cameras and anything that is overdue. It adds a **Maintenance** tab to the core *Machine* page
through the extension point `@core/system#tabs`, a dashboard widget, a notification monitor and
a guard on the start of a print. Written in [Lit](https://lit.dev).

## Requirements

- Tessera with plugin API **1.0** or newer and `@core/system` **4.0.0** or newer.
  `tessera-ext` refuses to install on an older Tessera.
- Moonraker with its job history (it is on by default): the counters come from
  `server.history.totals`.
- For the bed check: a camera in Moonraker (`[webcam]` or the camera widget). Any camera
  service works as long as it has a snapshot URL.

## Using it

1. **First run.** The tab opens a short setup form: bed check on or off, how you wash the bed,
   the guide type of each axis, the nozzle and the feeder gearbox of each extruder. The answers
   set the intervals. You can skip it (defaults stay) and run it again from the settings. Until
   it is finished there are no reminders and no pre-print dialog.
2. **Tasks.** Each card shows the progress of every unit, a status (OK, soon, due, off), a
   fold-out explanation of why the task exists and how to choose its interval, and the result
   buttons. A button asks for an optional note, restarts the timer and goes to the journal.
   **Edit** changes the intervals, how early to start reminding, whether the task takes part in
   the pre-print dialog and sends notifications, and the buttons themselves.
3. **Chains.** A result can make other cards due: *Belts: Adjusted* asks for the input shaper
   calibration, *Nozzle: Replaced* asks for the Z offset check and hot tightening. The
   **Chains** section draws the cards on a board: drag a card by its title, drag from the dot
   next to a result onto the card it should trigger, click a line to select it and press Delete.
   Ctrl+Z / Ctrl+Y undo and redo (Cmd on a Mac, any keyboard layout). A link to a timer task
   makes it due at once until you press its own button. Below 700px the board is replaced by a
   list of links with an *Add link* form.
4. **Before printing.** When a print starts from Tessera (Jobs, History, the job queue) a dialog
   shows the live camera frames, asks you to confirm that the bed is empty and the sheet is in
   place, and lists overdue tasks. Overdue work never blocks a print (*Start anyway*); the
   bed confirmation does, until you switch the bed check off. Starting with overdue work is
   written to the journal.
5. **Notifications.** *Soon* (the lead time of the task) and *due* each arrive once per cycle
   through Tessera's notification centre, and an overdue task is repeated after a finished print
   at most once a day.

### Default tasks

| Task | Default |
|---|---|
| Bed check before printing | on |
| Wash the bed | 7 days |
| Lubricate the X, Y, Z axes | 30 days (the shortest interval of the axes you chose) |
| Clean carbon rails | off, replaces lubrication for carbon rails |
| Belt tension: *Checked* / *Adjusted* | 90 days; *Adjusted* triggers the shaper calibration |
| Shaper calibration | only after *Adjusted* on the belts |
| Nozzle: *Checked* / *Replaced* | 10 km of filament (brass), 80 km (hardened); *Replaced* triggers the Z offset check and hot tightening |
| Z offset check, hot tightening | only after *Replaced* on the nozzle |
| Feeder gearbox lubrication | 1000 hours, 500 with a planetary gearbox. Never lubricate the teeth that grip the filament |
| Your own tasks | name, instruction, any interval, any buttons |

## How it counts

Moonraker only keeps totals for the whole printer. Each task remembers the totals at its last
reset, so **resetting the totals on the History page does not lose any progress**. The running
print is counted before it reaches the history. Notes:

- *Prints* is Moonraker's job count, which includes cancelled and failed jobs.
- Hours and filament are not split per extruder: a nozzle or feeder task of a tool that printed
  less than the others can be corrected by hand in the task editor.
- The pre-print dialog appears only for prints started from Tessera; prints started from another
  app are counted but not intercepted. Reminders do not depend on it.
- Data is stored through Tessera's plugin settings, under the keys `printer:<id>:state` and
  `printer:<id>:journal`. A Tessera that mirrors settings into the Moonraker database (newer
  versions) keeps them on the printer, so every browser sees the same tasks. If you switch on
  *sync* for this plugin in Settings → Plugins, all printers share one object; the keys keep
  their data apart.

## Development

```
npm install
npm test            # the model, counters, chains, reminders, the guard and the elements
npm run typecheck
npm run dev         # rebuilds into <Tessera>/extensions/maintenance/ on every change
npm run pack        # build + archive into registry/
```

`src/core/` has no Lit and no host imports: the data model, counters, evaluation, the chain
graph, reminders and the guard decision are plain functions with tests. `src/ui/` holds the
Custom Elements, `src/queue.ts` the guard and its dialog queue, `src/monitor.ts` the reminders.
