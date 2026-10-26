'use strict';

// A native dialog works even if the renderer is loading or the user is in a call.
// The choice is shown only after electron-updater finishes downloading the EXE.
function makeUpdateReadyDialog(version) {
  const versionText = typeof version === 'string' && /^\d+\.\d+\.\d+(?:[-+.][a-zA-Z0-9.-]+)?$/.test(version)
    ? `v${version}`
    : 'new version';

  return {
    type: 'info',
    title: 'Mirlume Update Available',
    message: `Mirlume ${versionText} is ready to install.`,
    detail: [
      'The update has already downloaded automatically.',
      '',
      'Before updating:',
      '1. Finish any voice calls or file transfers.',
      '2. Make sure you have sent any messages you are writing.',
      '',
      'Choose "Restart & Update" to close Mirlume, install the update, and open Mirlume again.',
      '',
      'Choose "Later" to keep using Mirlume. The update will install automatically when you close the app normally. Open Mirlume again afterward.',
      '',
      'You do not need to visit GitHub, download another installer, or uninstall Mirlume.'
    ].join('\n'),
    buttons: ['Restart & Update', 'Later'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  };
}

module.exports = { makeUpdateReadyDialog };
