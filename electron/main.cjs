const { app, BrowserWindow, shell, ipcMain, dialog, session, desktopCapturer } = require('electron');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');
const { makeUpdateReadyDialog } = require('./update-prompt.cjs');

const writers = new Map();
let currentWindow;


function createWindow() {
  const win = new BrowserWindow({
    show: true,
    width: 1180,
    height: 760,
    minWidth: 370,
    minHeight: 580,
    backgroundColor: '#131820',
    title: 'Mirlume',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  currentWindow = win;
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (url.startsWith('https://')) shell.openExternal(url);
    }
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

// No recipient save prompt: downloads are written to the user's Downloads/Mirlume
// folder. Always use unpredictable unique names and a temporary .part file,
// never overwrite a file supplied by a contact.
ipcMain.handle('file:start', async (event, filename, size) => {
  if (event.sender !== currentWindow?.webContents) throw new Error('Unauthorized file writer.');
  if (!Number.isSafeInteger(size) || size < 1 || size > 20 * 1024 ** 3) {
    throw new Error('Invalid transfer size.');
  }
  const safeName = path.basename(String(filename).replace(/\\/g, '/'))
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 160)
    || 'download.bin';
  const baseDir = path.join(app.getPath('downloads'), 'Mirlume');
  await fs.mkdir(baseDir, { recursive: true });
  try {
    const space = await fs.statfs(baseDir);
    if (Number(space.bavail) * Number(space.bsize) < size + 100 * 1024 ** 2) {
      throw new Error('Not enough free disk space to auto-download this file.');
    }
  } catch (error) {
    if (String(error.message).includes('Not enough')) throw error;
    // Filesystem stats are unavailable on some Windows versions.
  }
  const suffix = crypto.randomBytes(6).toString('hex');
  const extension = path.extname(safeName);
  const stem = safeName.slice(0, safeName.length - extension.length) || 'download';
  const finalPath = path.join(baseDir, stem + '-' + suffix + extension);
  const partialPath = finalPath + '.part';
  const handle = await fs.open(partialPath, 'wx');
  const id = crypto.randomUUID();
  writers.set(id, {
    handle, filepath: partialPath, finalPath, offset: 0, expectedSize: size,
    owner: event.sender.id,
  });
  return { id, filename: path.basename(finalPath), location: 'Downloads/Mirlume' };
});

ipcMain.handle('file:write', async (event, id, bytes) => {
  const writer = writers.get(id);
  if (!writer || writer.owner !== event.sender.id) throw new Error('Unknown transfer.');
  const buffer = Buffer.from(bytes);
  if (writer.offset + buffer.length > writer.expectedSize) {
    throw new Error('Incoming file exceeded announced size.');
  }
  // FileHandle.write() can write fewer bytes; loop until the full segment is on disk.
  let count = 0;
  while (count < buffer.length) {
    const result = await writer.handle.write(buffer, count, buffer.length - count, writer.offset + count);
    if (!result.bytesWritten) throw new Error('Unable to write file.');
    count += result.bytesWritten;
  }
  writer.offset += count;
  return count;
});

ipcMain.handle('file:finish', async (event, id) => {
  const writer = writers.get(id);
  if (!writer || writer.owner !== event.sender.id) throw new Error('Unknown transfer.');
  if (writer.offset !== writer.expectedSize) throw new Error('File is incomplete.');
  writers.delete(id);
  await writer.handle.close();
  await fs.rename(writer.filepath, writer.finalPath);
  return { saved: true, size: writer.offset, filename: path.basename(writer.finalPath) };
});

ipcMain.handle('file:cancel', async (event, id) => {
  const writer = writers.get(id);
  if (!writer || writer.owner !== event.sender.id) return false;
  writers.delete(id);
  await writer.handle.close().catch(() => {});
  await fs.unlink(writer.filepath).catch(() => {});
  return true;
});

function initializeAutoUpdates() {
  // Portable builds and development sessions cannot be safely installed over.
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_FILE || process.platform !== 'win32') return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  let promptedVersion = null;
  autoUpdater.on('error', error => console.warn('Mirlume update failed:', error.message));
  autoUpdater.on('update-available', info => {
    // Downloading is automatic; do not offer a restart until it is complete.
    if (currentWindow && !currentWindow.isDestroyed()) {
      currentWindow.setTitle('Mirlume — downloading update v' + info.version);
    }
  });
  autoUpdater.on('update-downloaded', async info => {
    // Only ask once per downloaded version, even if checkForUpdates runs again.
    const version = info?.version || 'unknown';
    if (promptedVersion === version) return;
    promptedVersion = version;
    const win = currentWindow && !currentWindow.isDestroyed() ? currentWindow : null;
    if (win) {
      win.setTitle('Mirlume — update ready (restart or install on exit)');
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    try {
      const options = makeUpdateReadyDialog(version);
      const { response } = win
        ? await dialog.showMessageBox(win, options)
        : await dialog.showMessageBox(options);
      if (response === 0) {
        // Called only after update-downloaded. v6 electron-updater expects
        // (isSilent, isForceRunAfter): exit, install silently, and relaunch.
        autoUpdater.quitAndInstall(true, true);
      }
      // Choosing Later leaves autoInstallOnAppQuit enabled: the update installs
      // when the user closes Mirlume normally, not while they're on a call.
    } catch (error) {
      console.warn('Could not show the update prompt:', error);
      // Safe fallback: downloaded update still installs on normal app exit.
    }
  });
  const check = () => autoUpdater.checkForUpdates().catch(error => console.warn('Update check failed:', error.message));
  setTimeout(check, 15000);
  const timer = setInterval(check, 60 * 60 * 1000);
  app.on('before-quit', () => clearInterval(timer));
}

app.whenReady().then(() => {
  // Only Mirlume's own packaged window can ask for WebRTC microphone or
  // screen capture; no arbitrary web content, navigation, or camera access.
  const isOwnWindow = (webContents) => webContents === currentWindow?.webContents
    && webContents.getURL().startsWith('file://');
  session.defaultSession.setPermissionCheckHandler((webContents, permission) =>
    (permission === 'media' || permission === 'display-capture') && isOwnWindow(webContents)
  );
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const types = details?.mediaTypes || [];
    if (permission === 'display-capture') {
      // Electron 45+ reports screen capture separately from camera/microphone.
      callback(isOwnWindow(webContents));
      return;
    }
    // Electron 37 (our packaged runtime) sends screen requests as 'media'
    // with an empty mediaTypes list. The explicit display-source picker below
    // is still REQUIRED and prevents silent or unintended screen capture.
    callback(permission === 'media' && isOwnWindow(webContents) && (
      (types.includes('audio') && !types.includes('video')) ||
      types.length === 0
    ));
  });
  // Do not silently pick a monitor: show an explicit native source picker for
  // each request. The person sharing can cancel without sending any pixels.
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const win = currentWindow;
    if (!win || win.isDestroyed() || !isOwnWindow(win.webContents) ||
        request.frame !== request.frame?.top || !request.videoRequested) {
      callback(null);
      return;
    }
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 160, height: 90 }
      });
      const options = sources.slice(0, 14);
      if (!options.length) { callback(null); return; }
      const buttons = [...options.map(source =>
        (source.id.startsWith('screen:') ? 'Screen: ' : 'Window: ') + source.name
      ), 'Cancel'];
      const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        title: 'Mirlume — Share your screen',
        message: 'Choose a screen or window to share with your friend.',
        detail: 'Only the selected screen or window will be shared. You can stop at any time.',
        buttons,
        defaultId: buttons.length - 1,
        cancelId: buttons.length - 1,
        noLink: true
      });
      if (win.isDestroyed() || response < 0 || response >= options.length) {
        callback(null);
        return;
      }
      callback({ video: options[response] });
    } catch (error) {
      console.warn('Screen source picker failed:', error);
      callback(null);
    }
  });
  initializeAutoUpdates();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
