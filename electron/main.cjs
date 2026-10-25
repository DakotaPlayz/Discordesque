const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');

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

// The receiver selects the destination directly in Windows. No Blob accumulation,
// and no arbitrary filesystem path from the untrusted renderer is accepted.
ipcMain.handle('file:start', async (event, filename) => {
  if (event.sender !== currentWindow?.webContents) throw new Error('Unauthorized file writer.');
  const safeName = path.basename(String(filename).replace(/\\/g, '/')).slice(0, 255) || 'download.bin';
  const result = await dialog.showSaveDialog(currentWindow, {
    title: 'Save incoming Mirlume file',
    defaultPath: safeName,
    buttonLabel: 'Save',
  });
  if (result.canceled || !result.filePath) return { error: 'Save cancelled.' };
  const handle = await fs.open(result.filePath, 'w');
  const id = crypto.randomUUID();
  writers.set(id, { handle, filepath: result.filePath, offset: 0, owner: event.sender.id });
  return { id };
});

ipcMain.handle('file:write', async (event, id, bytes) => {
  const writer = writers.get(id);
  if (!writer || writer.owner !== event.sender.id) throw new Error('Unknown transfer.');
  const buffer = Buffer.from(bytes);
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
  writers.delete(id);
  await writer.handle.close();
  return { saved: true, size: writer.offset };
});

ipcMain.handle('file:cancel', async (event, id) => {
  const writer = writers.get(id);
  if (!writer || writer.owner !== event.sender.id) return false;
  writers.delete(id);
  await writer.handle.close().catch(() => {});
  await fs.unlink(writer.filepath).catch(() => {});
  return true;
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
