const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const isDev = !app.isPackaged;

// GPU Configuration setup
const gpuConfigPath = path.join(app.getPath('userData'), 'gpu-config.json');
let isGpuEnabled = true; // default true

if (fs.existsSync(gpuConfigPath)) {
  try {
    const raw = fs.readFileSync(gpuConfigPath);
    const parsed = JSON.parse(raw);
    if (parsed.gpu !== undefined) {
      isGpuEnabled = parsed.gpu;
    }
  } catch (e) {
    console.warn("GPU Config parsing failed:", e);
  }
}

if (isGpuEnabled) {
  // Force GPU Hardware Acceleration
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('disable-software-rasterizer');
} else {
  // Turn off Hardware Acceleration for poor GPUs
  app.disableHardwareAcceleration();
}

let mainWindow;

function createWindow() {
  const windowIcon = app.isPackaged
    ? path.join(process.resourcesPath, 'Icon.png')
    : path.join(__dirname, 'Icon.png');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 768,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webgl: true,
      experimentalFeatures: true
    },
    icon: windowIcon
  });

  const url = isDev 
    ? 'http://localhost:5173' 
    : `file://${path.join(__dirname, 'dist', 'index.html')}`;
    
  mainWindow.loadURL(url);

  if (isDev) {
     mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => (mainWindow = null));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

// Window controls IPC
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});
ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});
ipcMain.on('window-fullscreen', (event) => {
  if (mainWindow) {
    const isFS = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(isFS);
    event.returnValue = isFS;
  }
});
ipcMain.on('window-pin', (event, shouldPin) => {
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(shouldPin);
    event.returnValue = shouldPin;
  }
});
ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

// Memory Vault IPC Systems
const vaultPath = path.join(app.getPath('userData'), 'video-vault.json');

ipcMain.on('save-time', (event, payload) => {
  try {
    let vault = {};
    if (fs.existsSync(vaultPath)) vault = JSON.parse(fs.readFileSync(vaultPath));
    vault[payload.filePath] = payload.time;
    fs.writeFileSync(vaultPath, JSON.stringify(vault));
  } catch(e){}
});

ipcMain.on('get-time', (event, filePath) => {
  try {
    if (fs.existsSync(vaultPath)) {
      const vault = JSON.parse(fs.readFileSync(vaultPath));
      event.returnValue = vault[filePath] || 0;
    } else {
      event.returnValue = 0;
    }
  } catch(e) { 
    event.returnValue = 0; 
  }
});

// GPU Status IPC
ipcMain.on('get-gpu-status', (event) => {
  event.returnValue = isGpuEnabled;
});
ipcMain.on('toggle-gpu', () => {
  isGpuEnabled = !isGpuEnabled;
  fs.writeFileSync(gpuConfigPath, JSON.stringify({ gpu: isGpuEnabled }));
  app.relaunch();
  app.exit();
});

// yt-dlp helpers
function getYtDlpPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'yt-dlp.exe')
    : path.join(__dirname, 'yt-dlp.exe');
}

// List available qualities for a URL
ipcMain.handle('list-formats', async (event, pageUrl) => {
  return new Promise((resolve, reject) => {
    const ytDlpPath = getYtDlpPath();
    if (!fs.existsSync(ytDlpPath)) return reject(new Error('yt-dlp.exe not found'));

    execFile(
      ytDlpPath,
      ['-J', '--no-playlist', '--no-warnings', pageUrl],
      { timeout: 45000 },
      (error, stdout, stderr) => {
        if (error) return reject(new Error(stderr || error.message));
        try {
          const info = JSON.parse(stdout);
          const allVideoFormats = (info.formats || [])
            .filter(f => f.vcodec && f.vcodec !== 'none' && f.height);
          const muxedFormats = allVideoFormats.filter(f => f.acodec && f.acodec !== 'none');
          const sourceFormats = muxedFormats.length ? muxedFormats : allVideoFormats;

          const formats = sourceFormats
            .map(f => ({
              id: f.format_id,
              label: `${f.height}p${f.fps ? f.fps : ''} (${f.ext})${!muxedFormats.length ? ' - no audio' : ''}`,
              height: f.height,
              ext: f.ext,
              filesize: f.filesize || f.filesize_approx || 0
            }));
          // Deduplicate by height, keep best per resolution
          const seen = {};
          const unique = [];
          for (const f of formats.sort((a, b) => b.height - a.height)) {
            if (!seen[f.height]) {
              seen[f.height] = true;
              unique.push(f);
            }
          }
          resolve({ title: info.title || '', formats: unique });
        } catch (e) {
          reject(new Error('Failed to parse format list'));
        }
      }
    );
  });
});

// Extract stream URL (optionally with a specific format)
ipcMain.handle('extract-url', async (event, pageUrl, formatId) => {
  return new Promise((resolve, reject) => {
    const ytDlpPath = getYtDlpPath();
    if (!fs.existsSync(ytDlpPath)) return reject(new Error('yt-dlp.exe not found'));

    const args = ['--get-url', '--no-playlist', '--no-warnings'];
    if (formatId) {
      // Request the exact format chosen by user (quality list prefers muxed AV formats).
      args.push('-f', formatId);
    } else {
      // Best single stream that includes both video and audio.
      args.push('-f', 'best[acodec!=none][vcodec!=none]/best');
    }
    args.push(pageUrl);

    execFile(
      ytDlpPath,
      args,
      { timeout: 30000 },
      (error, stdout, stderr) => {
        if (error) return reject(new Error(stderr || error.message));
        const urls = stdout.trim().split('\n').filter(Boolean);
        if (!urls.length) return reject(new Error('No stream URL found'));
        resolve(urls[0]);
      }
    );
  });
});
