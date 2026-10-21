// Electron 主程序：啟動 Python 後端、建立視窗、提供檔案對話框
const { app, BrowserWindow, dialog, ipcMain, net: electronNet, protocol } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// 以 app:// 提供前端檔案：file:// 無法載入 ES module，且 app:// 屬於安全來源可使用攝影機
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const token = crypto.randomBytes(16).toString('hex');
let backend = null;
let backendInfo = null;
let backendLog = '';

function findPython() {
  if (process.env.ML_SCRATCH_PYTHON) return process.env.ML_SCRATCH_PYTHON;
  const win = path.join(ROOT, '.venv', 'Scripts', 'python.exe');
  const posix = path.join(ROOT, '.venv', 'bin', 'python');
  if (fs.existsSync(win)) return win;
  if (fs.existsSync(posix)) return posix;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitHealthy(url, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (backend && backend.exitCode !== null) throw new Error('後端已結束');
    try {
      const r = await fetch(`${url}/health`);
      if (r.ok) return;
    } catch { /* 尚未啟動 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('等待後端逾時');
}

async function startBackend() {
  const port = await freePort();
  const home = path.join(app.getPath('userData'), 'workspace');
  backend = spawn(findPython(), ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: path.join(ROOT, 'backend'),
    env: { ...process.env, ML_SCRATCH_HOME: home, ML_SCRATCH_TOKEN: token, PYTHONUTF8: '1' },
    windowsHide: true,
  });
  const keep = (d) => { backendLog = (backendLog + d.toString()).slice(-8000); };
  backend.stdout.on('data', keep);
  backend.stderr.on('data', keep);
  const url = `http://127.0.0.1:${port}`;
  await waitHealthy(url);
  backendInfo = { url, token, home };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    title: 'ML-Scratch',
    backgroundColor: '#f4f5f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadURL('app://local/index.html');
}

ipcMain.handle('backend:info', () => backendInfo);
ipcMain.handle('dialog:openFolder', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:openFile', async (_e, filters) => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('project:save', async (_e, content) => {
  const r = await dialog.showSaveDialog({ filters: [{ name: 'ML-Scratch 專案', extensions: ['mlsb'] }] });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, content, 'utf-8');
  return r.filePath;
});
ipcMain.handle('project:open', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'ML-Scratch 專案', extensions: ['mlsb'] }] });
  if (r.canceled) return null;
  return fs.readFileSync(r.filePaths[0], 'utf-8');
});

app.whenReady().then(async () => {
  protocol.handle('app', (req) => {
    const file = path.normalize(path.join(DIST, decodeURIComponent(new URL(req.url).pathname)));
    if (!file.startsWith(DIST + path.sep)) return new Response('Forbidden', { status: 403 });
    return electronNet.fetch(pathToFileURL(file).toString());
  });
  try {
    await startBackend();
  } catch (err) {
    dialog.showErrorBox('後端啟動失敗', `${err.message}\n\n${backendLog}`);
    app.quit();
    return;
  }
  createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('quit', () => { if (backend) backend.kill(); });
