const { app, BrowserWindow, shell, ipcMain, dialog, session } = require('electron');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');

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
  autoUpdater.on('error', error => console.warn('Mirlume update failed:', error.message));
  autoUpdater.on('update-downloaded', () => {
    // Downloaded updates install the next time the user closes Mirlume.
    if (currentWindow && !currentWindow.isDestroyed()) {
      currentWindow.setTitle('Mirlume — update ready (installs on exit)');
    }
  });
  const check = () => autoUpdater.checkForUpdates().catch(error => console.warn('Update check failed:', error.message));
  setTimeout(check, 15000);
  const timer = setInterval(check, 60 * 60 * 1000);
  app.on('before-quit', () => clearInterval(timer));
}

app.whenReady().then(() => {
  // Allow microphone-only WebRTC requests from Mirlume's own packaged UI.
  // Never allow video, screen capture, or arbitrary external origins.
  const isOwnWindow = (webContents) => webContents === currentWindow?.webContents
    && webContents.getURL().startsWith('file://');
  session.defaultSession.setPermissionCheckHandler((webContents, permission) =>
    permission === 'media' && isOwnWindow(webContents)
  );
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const types = details?.mediaTypes || [];
    callback(permission === 'media' && isOwnWindow(webContents)
      && types.includes('audio') && !types.includes('video'));
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
