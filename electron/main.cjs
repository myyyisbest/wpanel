const { app, BrowserWindow, Tray, Menu, nativeImage, utilityProcess, shell, dialog } = require('electron');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..');
const UI_PORT = 8765;
const UI_URL = `http://localhost:${UI_PORT}/`;
const VINEXT_CLI = path.join(ROOT, 'node_modules', 'vinext', 'dist', 'cli.js');
const ICON_PATH = path.join(ROOT, 'build', 'icon.png');
const CONTROLLER_SCRIPT = path.join(ROOT, 'server.mjs');

let win = null;
let tray = null;
let quitting = false;
let balloonShown = false;
let controller = null;
let ui = null;

function startServices() {
  // utilityProcess.fork 是 Electron 官方的 Node 子进程托管 API（打包后自动以嵌入 Node 运行）。
  // 两个入口均为应用内常量：控制器 server.mjs 与 vinext 生产服务器，无用户输入。
  // 控制器的数据目录指向用户目录（安装到 Program Files 时程序目录可能只读）。
  const dataDir = path.join(app.getPath('userData'), 'data');
  controller = utilityProcess.fork(CONTROLLER_SCRIPT, [], {
    cwd: path.dirname(CONTROLLER_SCRIPT),
    serviceName: 'wpanel-controller',
    stdio: 'ignore',
    env: { ...process.env, WPANEL_DATA_DIR: dataDir },
  });
  ui = utilityProcess.fork(VINEXT_CLI, ['start', '--hostname', 'localhost', '--port', String(UI_PORT)], { cwd: ROOT, serviceName: 'wpanel-ui', stdio: 'ignore' });
  for (const [label, child] of [['controller', controller], ['ui', ui]]) {
    child.on('exit', (code) => { if (!quitting) console.log(`[wpanel] ${label} exited (${code})`); });
  }
}

function stopServices() {
  for (const child of [ui, controller]) {
    if (child) { try { child.kill(); } catch { /* 已退出 */ } }
  }
  ui = null;
  controller = null;
}

function waitFor(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const poll = () => {
      const request = http.get(url, (response) => { response.resume(); resolve(true); });
      request.on('error', () => {
        if (Date.now() < deadline) setTimeout(poll, 400);
        else resolve(false);
      });
      request.setTimeout(2000, () => request.destroy(new Error('timeout')));
    };
    poll();
  });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#f6f7fb',
    icon: ICON_PATH,
    autoHideMenuBar: true,
    title: 'WPanel — WSL2 与 Docker 的驾驶舱',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(UI_URL);
  win.once('ready-to-show', () => showWindow());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // 面板是后台服务性质：点 ✕ 收进托盘，托盘“退出”才是真正关闭
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
    if (!balloonShown && tray) {
      balloonShown = true;
      try { tray.displayBalloon({ icon: ICON_PATH, title: 'WPanel 仍在运行', content: '已最小化到托盘。右键托盘图标可打开面板或退出。' }); } catch { /* 可选能力 */ }
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('WPanel — WSL2 与 Docker 的驾驶舱');
  const menu = Menu.buildFromTemplate([
    { label: '打开面板', click: showWindow },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, path: process.execPath }),
    },
    { type: 'separator' },
    { label: '退出（停止服务）', click: () => { quitting = true; stopServices(); app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', showWindow);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('before-quit', () => { quitting = true; stopServices(); });
  app.on('window-all-closed', () => { /* 托盘常驻：不随窗口关闭退出 */ });

  app.whenReady().then(async () => {
    startServices();
    const ready = await waitFor(UI_URL, 45000);
    createTray();
    if (ready) {
      createWindow();
    } else {
      stopServices();
      dialog.showErrorBox('WPanel 启动失败', '界面服务未能在 45 秒内就绪，请查看 logs 目录中的日志后重试。');
      app.quit();
    }
  });
}
