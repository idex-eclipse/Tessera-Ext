/**
 * English strings. The host merges `locales` into ONE shared dictionary, so everything
 * lives under the plugin's own namespace `obico.*`. `{name}` placeholders are filled by
 * api.i18n.t(key, params).
 */
export default {
  obico: {
    tabTitle: 'Obico',
    loading: 'Waiting for the printer…',
    reload: 'Check again',

    missing: {
      title: 'Obico is not installed',
      text: 'moonraker-obico was not found on this printer: no moonraker-obico.cfg in the config folder, no service and no Obico macros. Install it on the printer, then press "Check again".',
      docs: 'Obico setup guide',
    },

    link: {
      title: 'Obico',
      server: 'Server',
      cloud: 'Obico Cloud',
      selfHosted: 'Self-hosted',
      linked: 'Linked',
      notLinked: 'Not linked',
      unknown: 'Link state unknown',
      code: 'Link code',
      codeHint: 'Enter this code in the Obico app when you add the printer, or open the link page.',
      openCode: 'Open the link page',
      waiting: 'The agent shows a link code a few seconds after it starts. If no code appears, check the service and its log below.',
      noMacros: 'Obico macros are not included in printer.cfg, so the link code is not shown here. Find it in the agent log below.',
      open: 'Open in Obico',
      relink: 'Re-link',
      relinkConfirm: 'The agent forgets its link and restarts. The printer stays offline in Obico until you link it again with a new code. Re-link?',
      relinkDone: 'The agent is re-linking. A new code appears here in a few seconds.',
      confirm: 'Re-link',
      cancel: 'Cancel',
    },

    service: {
      title: 'Service',
      restart: 'Restart',
      restarted: 'The service is restarting.',
      unmanaged: 'Moonraker does not manage the moonraker-obico service here: it is not listed in moonraker.asvc, or the agent runs in Docker.',
      showLog: 'Show log',
      hideLog: 'Hide log',
      refreshLog: 'Refresh log',
      logMissing: 'The log file was not found.',
      logOutside: 'The log is written outside the Moonraker folders ({path}), so it cannot be shown here.',
      logEmpty: 'The log is empty.',
    },

    tunnel: {
      title: 'Remote access through Obico',
      intro: 'The Obico app opens the web page of the printer through the Obico tunnel. By default the tunnel leads to port 80, where Mainsail or Fluidd usually live.',
      target: 'The tunnel leads to',
      ok: 'The tunnel opens Tessera.',
      other: 'The tunnel opens another page. To open Tessera remotely, put these lines into moonraker-obico.cfg (replace the [tunnel] section if there is one) and restart the service:',
      unknownPort: 'This page was opened over HTTPS, so its HTTP port is unknown. To open Tessera remotely, set dest_port in the [tunnel] section of moonraker-obico.cfg to the HTTP port of Tessera (8000 by default) and restart the service.',
      noConfig: 'moonraker-obico.cfg was not found, so the tunnel settings are unknown.',
    },

    error: 'Failed: {error}',
    openTab: 'Open the Obico tab',

    api: {
      title: 'Obico API',
      intro: 'Failure probability, alerts and statistics come from the Obico server API. Enter the address of your server and an access token; Tessera keeps the token on the printer and never shows it again.',
      cloud: 'This printer is linked to Obico Cloud. The cloud has no personal access tokens, so these features work only with a self-hosted Obico server.',
      url: 'Server address',
      token: 'Access token',
      tokenSaved: 'saved (type to replace)',
      tokenHelp: 'In the admin of your Obico server add an access token: pick your user, type a long random token, set a far expiry date and the scope "read write", save, and paste the token here.',
      tokenPage: 'Open the token page',
      save: 'Save',
      saved: 'Saved.',
      check: 'Check the connection',
      checked: 'Checked.',
      remove: 'Forget the server',
      removed: 'The address and the token are removed from the printer.',
      connected: 'Connected: {count} printer(s) in the account, this one is "{name}".',
      notSetUp: 'The Obico API is not set up.',
      notLinked: 'This printer is not linked to Obico.',
      notFound: 'This printer was not found in the Obico account of the token.',
      failed: 'The Obico server does not answer.',
      tokenRejected: 'the Obico server refused the token',
      unavailable: 'This Tessera cannot reach the Obico API: its service proxy (the tessera-ext service) is turned off or missing, for example on a development server. The panels above keep working.',
      unavailableShort: 'The Obico API is not available on this Tessera.',
      status: {
        unknown: 'Checking',
        unavailable: 'Unavailable',
        unconfigured: 'Not set up',
        ready: 'Connected',
        error: 'Error',
      },
    },

    reaction: {
      title: 'Failure detection',
      watching: 'Watch prints for failures',
      onFailure: 'When a failure is detected',
      pause: 'Pause the print and alert',
      notifyOnly: 'Only alert',
      sensitivity: 'Sensitivity: {value} (0.8 low … 1.2 high)',
      retract: 'Retract on pause, mm',
      liftZ: 'Lift Z on pause, mm',
      toolsOff: 'Turn the hotends off on pause',
      bedOff: 'Turn the bed off on pause',
      saved: 'Saved in Obico.',
    },

    events: {
      title: 'Obico events',
      empty: 'No events of this printer yet.',
    },

    level: { good: 'Looking good', fishy: 'Fishy…', failing: 'Failing!' },
    meter: { label: 'Failure probability', notWatching: 'Not watching' },
    reason: {
      disabled: 'Failure detection is turned off',
      noHours: 'The AI detection hours are used up',
      notPrinting: 'Not printing',
      muted: 'Not watching the rest of this print',
    },
    snapshot: { alt: 'The latest frame Obico analysed', none: 'No frame yet' },

    alert: {
      short: 'Possible failure',
      title: 'Obico: possible failure on {printer}',
      text: 'Obico thinks this print may be failing. Look at the frame and decide.',
      textPaused: 'Obico thinks this print may be failing and has paused it. Look at the frame and decide.',
      notify: 'Obico: possible print failure on {printer}',
      notFailure: 'Not a failure',
      notFailureResume: 'Not a failure, resume',
      muteToo: 'Do not watch the rest of this print',
      cancel: 'Cancel print',
      cancelConfirm: 'Cancel the print? It cannot be resumed afterwards.',
      cancelYes: 'Cancel the print',
      later: 'Later',
      mute: 'Stop watching this print',
    },

    widget: {
      detection: 'Failure detection',
      stats: 'Obico stats',
      graph: 'Failure probability during this print',
    },

    stats: {
      period: 'Period',
      week: '7 days',
      month: '30 days',
      year: '12 months',
      allPrinters: 'All printers',
      prints: 'Prints',
      succeeded: 'Finished',
      cancelled: 'Cancelled',
      hours: 'Print hours',
      filament: 'Filament, m',
      alerted: 'Alerts',
      failures: 'Real failures',
      falseAlarms: 'False alarms',
      unanswered: 'Not answered',
    },

    chip: { title: 'Obico', placed: 'Already on the strip.' },
    fleet: { title: 'Obico', alertTag: 'Obico alert' },
    action: { mute: 'Obico: stop watching', muted: 'Obico stopped watching this print.' },
  },
};
