/**
 * English strings. The host merges `locales` into ONE shared dictionary, so everything
 * lives under the plugin's own namespace `maintenance.*`. `{name}` placeholders are filled
 * by api.i18n.t(key, params).
 */
export default {
  maintenance: {
    tabTitle: 'Service',
    widgetTitle: 'Maintenance',
    loading: 'Waiting for the printer…',
    open: 'Open maintenance',

    common: {
      save: 'Save',
      cancel: 'Cancel',
      edit: 'Edit',
      delete: 'Delete task',
      add: 'Add task',
      confirm: 'Confirm',
      create: 'Create',
      close: 'Close',
      why: 'Why, and how to choose the interval',
      notePlaceholder: 'Note (optional): what was done, which parts',
      yes: 'Yes',
      no: 'No',
    },

    nav: { tasks: 'Tasks', chains: 'Chains', journal: 'Journal', settings: 'Settings' },

    summary: {
      overdue: '{n} due',
      soon: '{n} soon',
      allOk: 'Everything is in order',
      activeTitle: 'Active tasks',
      disabledTitle: 'Switched-off tasks',
    },

    status: { ok: 'OK', soon: 'Soon', overdue: 'Due', off: 'Off', triggered: 'Requested by another task' },

    unit: {
      hours: '{used} / {interval} print hours',
      prints: '{used} / {interval} prints',
      days: '{used} / {interval} days',
      filamentKm: '{used} / {interval} km of filament',
    },
    unitName: { hours: 'Print hours', prints: 'Prints', days: 'Days', filamentKm: 'Filament, km' },

    triggeredHint: 'This step was requested by a result you chose on another card. Do it, then press its button.',
    pressed: 'Now due: {names}',
    noTasks: 'Nothing to show yet.',
    link: {
      belts: 'Open the belts tools',
      shaper: 'Open Input Shaper',
      probe: 'Open the probe tools',
      heaters: 'Open the heater tools',
      mesh: 'Open the bed mesh tools',
    },
    tool: 'Tool {tool}',

    outcome: {
      done: 'Done',
      checked: 'Checked',
      adjusted: 'Adjusted',
      replaced: 'Replaced',
    },

    task: {
      'bed-check': {
        name: 'Bed check before printing',
        why: 'Before each print Tessera shows the cameras and asks you to confirm that nothing is left on the bed and the sheet is in place. A forgotten part or a missing sheet can damage the nozzle and the bed.',
      },
      'bed-wash': {
        name: 'Wash the bed',
        why: 'Depends on how dusty the room is, which adhesive you use and how much you touch the bed with your fingers when you take the models off. With glue stick it is recommended to wash the bed at every print. For a not very dusty room and careful handling the recommended interval is once a week.',
      },
      'lube-axes': {
        name: 'Lubricate the X, Y and Z axes',
        why: 'Depends on the consumables and the type of guides. For ball bearing guides use liquid lubricants every 7 days, or lithium soap grease of NLGI 1 / NLGI 2 consistency every month. Carbon guides need no lubrication, only regular cleaning. Also not lubricated: bronze-graphite plain bearings, POM lead screw nuts on Z (usually) and POM wheels running on V-Slot profile.',
        axes: 'Axes: {axes}',
      },
      'rails-clean': {
        name: 'Clean the carbon rails',
        why: 'Carbon guides must not be lubricated: wipe them regularly with a lint-free cloth instead, so that dust and old grease do not build up.',
      },
      belts: {
        name: 'Check the belt tension',
        why: 'A slack belt gives backlash and ringing at the corners and spoils the result of the resonance measurement. Pick "Checked" if the tension was fine, "Adjusted" if you had to change it.',
      },
      'shaper-calib': {
        name: 'Calibrate the input shaper',
        why: 'The resonance frequencies depend on the belt tension, so the shaper has to be measured again whenever the belts were adjusted. It appears here only after "Adjusted" on the belts card.',
      },
      nozzle: {
        name: 'Check the nozzle',
        why: 'Brass nozzles wear fast, are not compatible with abrasive filaments, but heat the filament well; the recommended replacement interval is 10 km of filament. Hardened steel nozzles resist composites but heat the filament worse than brass; the recommended interval is 80-100 km, on abrasive filaments possibly more often. Nozzles with a hardened tip combine the advantages of both; replace them like hardened steel ones. Pick "Checked" if it is still good, "Replaced" after a swap.',
      },
      zoffset: {
        name: 'Check the Z offset',
        why: 'A new nozzle never has exactly the height of the old one, so the first layer drifts. Check the Z offset after every nozzle swap. It appears here only after "Replaced" on the nozzle card.',
      },
      'hot-tighten': {
        name: 'Hot-tighten the nozzle',
        why: 'The parts expand when heated, so a nozzle tightened cold becomes loose at working temperature and leaks around the thread. Tighten it once at working temperature after a swap. It appears here only after "Replaced" on the nozzle card.',
      },
      'feeder-lube': {
        name: 'Lubricate the feeder gearbox',
        why: 'For feeders with an ordinary gearbox every 1000 hours, with a planetary gearbox (Orbiter, Galileo, Nebula) every 500 hours. NEVER lubricate the teeth that grip the filament!',
      },
      custom: { name: 'Custom task' },
    },

    rail: {
      'ball-liquid': 'Ball bearings, liquid oil (every 7 days)',
      'ball-grease': 'Ball bearings, lithium grease NLGI 1/2 (every month)',
      carbon: 'Carbon rails (no lubrication, regular cleaning)',
      none: 'No lubrication needed (bronze-graphite bushings, POM nuts and wheels, V-Slot)',
    },

    wizard: {
      title: 'Set up maintenance',
      intro: 'The right intervals depend on your consumables and hardware. Answer a few questions and the reminders are set up for you; you can change everything afterwards. Until you finish (or skip) this, no reminders or pre-print dialogs are shown.',
      skip: 'Skip, use defaults',
      finish: 'Apply',
      cancel: 'Cancel',
      bedCheck: {
        title: 'Bed check before printing',
        text: 'Before each print, show the cameras and ask to confirm that the bed is empty and the sheet is in place.',
        on: 'Ask before each print',
        off: 'Do not ask',
      },
      wash: {
        title: 'Washing the bed',
        glue: 'I use glue stick: wash at every print',
        normal: 'Normal conditions: once a week (7 days)',
        custom: 'My own interval, days:',
      },
      rails: { title: 'Guides', text: 'Pick the type for each axis. Reminders follow the shortest interval; axes that need no lubrication are left out.' },
      axis: { x: 'X axis', y: 'Y axis', z: 'Z axis' },
      belts: { title: 'Belts', on: 'Remind me to check the belt tension every 3 months', off: 'No belt reminders' },
      nozzle: {
        title: 'Nozzle',
        text: 'Pick the nozzle you use on this tool.',
        brass: 'Brass (10 km of filament)',
        hardened: 'Hardened steel or hardened tip (80 km)',
        custom: 'My own interval, km of filament:',
      },
      feeder: {
        title: 'Feeder gearbox',
        regular: 'Ordinary gearbox (1000 hours)',
        planetary: 'Planetary gearbox: Orbiter, Galileo, Nebula (500 hours)',
        warning: 'Never lubricate the teeth that grip the filament.',
      },
      custom: {
        title: 'Your own tasks and chains',
        text: 'Besides these tasks you can add your own, with a name, an interval and a short instruction. Every card has result buttons, and a result can make other cards due: "Belts: Adjusted" asks for the input shaper calibration, "Nozzle: Replaced" asks for the Z offset check and hot tightening. You can link your own cards the same way when you edit a task. A visual chain editor will come later.',
      },
    },

    editor: {
      title: 'Edit task',
      newTitle: 'New task',
      name: 'Name',
      instruction: 'Instruction',
      kind: 'Kind',
      kindInterval: 'By a timer',
      kindFollowup: 'Appears only when another card asks for it',
      enabled: 'Enabled',
      intervals: 'Interval (it is due when ANY of the set values is reached; empty = not used)',
      lead: 'Start reminding in advance',
      leadHint: 'Empty = automatically (about 10 % of the interval). Same units as above.',
      adjust: 'Correct the counter',
      adjustHint: 'Moonraker counts the whole printer, so for a tool that printed less (or more) than the others add or subtract the difference here.',
      guard: 'Warn about this task before printing',
      notify: 'Send notifications for this task',
      outcomes: 'Results (the buttons on the card)',
      outcomeLabel: 'Button text',
      resetsTimer: 'restarts the timer',
      completes: 'finishes the task',
      triggers: 'Makes these tasks due',
      addOutcome: 'Add a result',
      removeOutcome: 'Remove',
      cycle: 'These cards ask for each other in a circle. It is allowed, but check that it is what you want.',
      deleteConfirm: 'Delete this task?',
    },

    journal: {
      empty: 'Nothing has been done yet.',
      when: 'When',
      export: 'Download CSV',
    },

    settings: {
      notifications: 'Notifications',
      notificationsHint: 'Tell me when a task is about to be due and when it is overdue.',
      guard: 'Warn before printing',
      guardHint: 'Before a print starts from Tessera, show a dialog with the overdue tasks. You can always start anyway.',
      bedCheck: 'Bed check before printing',
      wizard: 'Run the setup wizard again',
      counters: 'Hours, prints and filament come from the Moonraker history of the whole printer and keep counting if you reset the totals on the History page. Prints from other apps (Mainsail, a slicer) are counted, but the pre-print dialog is shown only for prints started from Tessera.',
    },

    chains: {
      title: 'Chains of tasks',
      hint: 'Drag a card by its title to move it. To link, drag from the dot next to a result onto the card that result should make due. Click a line to select it, then press Delete or the button above. Double-click a card to edit it.',
      hintNarrow: 'The board needs more room than this screen has. Edit the links in the list below.',
      undo: 'Undo',
      redo: 'Redo',
      undoHint: 'Undo the last change (Ctrl+Z)',
      redoHint: 'Redo (Ctrl+Y)',
      arrange: 'Arrange automatically',
      removeSelected: 'Remove the selected link',
      dragHint: 'Drag from here onto a card: "{name}" will make it due',
      links: 'Links',
      noLinks: 'No links yet: no result makes another card due.',
      addLink: 'Add a link',
      from: 'Card',
      outcome: 'Result',
      to: 'Makes this card due',
      add: 'Add link',
      remove: 'Remove',
      duplicate: 'This link already exists.',
    },

    notify: {
      label: 'Service',
      soon: '{task} is due soon ({progress})',
      overdue: '{task} is due ({progress})',
      triggered: '{task}: requested by another task',
    },

    guard: {
      title: 'Before printing',
      bedTitle: 'Check the bed',
      bedConfirm: 'The bed is empty and the sheet is in place',
      overdueTitle: 'Maintenance is due',
      overdueHint: 'You can still start the print. This is only a reminder that the work above is due.',
      start: 'Start printing',
      startAnyway: 'Start anyway',
      open: 'Open maintenance',
      noCamera: 'No camera is set up for this printer. Check the bed yourself and confirm below.',
      cameraOff: 'The camera does not answer',
      cancelled: 'Print not started: cancelled in the maintenance check',
    },

    journalEvent: { startedAnyway: 'Print started with this work overdue' },

    widget: { more: '+{n} more', openTab: 'Open the tab' },
  },
};
