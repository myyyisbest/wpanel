import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, realpath, access, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createReadStream, createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);
const HOST = '127.0.0.1';
const PORT = Number(process.env.WPANEL_PORT) || 8766;
const DISTRO = process.env.WPANEL_DISTRO || 'Ubuntu';
const TOKEN = randomBytes(24).toString('hex');
const DATA_DIR = path.join(process.cwd(), 'data');
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.jsonl');
const LOCAL_CONFIG_FILE = path.join(DATA_DIR, 'wpanel.local.json');
const allowedOrigins = new Set(['http://localhost:8765', 'http://127.0.0.1:8765']);

// 服务列表默认仅 docker；本机扩展项写在 data/wpanel.local.json（不进 git）：
// { "services": [{ "key": "postgresql", "name": "PostgreSQL", "unit": "postgresql.service" }] }
function readServicesConfig() {
  try {
    const parsed = JSON.parse(readFileSync(LOCAL_CONFIG_FILE, 'utf8'));
    const list = Array.isArray(parsed.services) ? parsed.services : [];
    return list.filter((item) => item && typeof item.key === 'string' && typeof item.unit === 'string' && /^[a-z0-9-]{1,64}$/.test(item.key))
      .map((item) => ({ key: item.key, name: String(item.name || item.key).slice(0, 64), unit: item.unit }));
  } catch {
    return [];
  }
}

const FILE_ROOTS = (process.env.WPANEL_ROOTS || '/home')
  .split(',').map((item) => item.trim()).filter(Boolean);
const EDIT_MAX_BYTES = 1024 * 1024;
const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
const LIST_MAX_ENTRIES = 500;
const uncBases = [`\\\\wsl.localhost\\${DISTRO}`, `\\\\wsl$\\${DISTRO}`];
let uncBase = null;

async function resolveUncBase() {
  if (uncBase) return uncBase;
  for (const base of uncBases) {
    try { await stat(base); uncBase = base; return base; } catch { /* 尝试下一个前缀 */ }
  }
  throw new Error('无法访问 WSL 文件系统，请确认 Ubuntu 正在运行');
}

function normalizeLinuxPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\0') || value.includes('\\')) return null;
  const path = value.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  const segments = path.split('/').slice(1);
  if (segments.some((segment) => segment === '.' || segment === '..')) return null;
  return path.length > 2048 ? null : path || '/';
}

function assertAllowedPath(path) {
  if (!FILE_ROOTS.some((root) => path === root || path.startsWith(`${root}/`))) {
    throw new Error('路径超出允许范围（默认仅开放 /home，可用 WPANEL_ROOTS 扩展）');
  }
}

// follow=false 用于删除/改名：符号链接本身操作不会跟随目标
async function checkedUnc(path, follow = true) {
  assertAllowedPath(path);
  const base = await resolveUncBase();
  const unc = base + path.replaceAll('/', '\\');
  if (follow) {
    try {
      const real = await realpath(unc);
      if (real.startsWith(base)) {
        const realPath = real.slice(base.length).replaceAll('\\', '/');
        assertAllowedPath(realPath);
      }
    } catch (error) {
      if (error.message.startsWith('路径超出允许范围')) throw error;
      // ENOENT 等留给调用方按实际操作报错
    }
  }
  return unc;
}

function validFileName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 255 && !name.includes('/') && !name.includes('\0') && name !== '.' && name !== '..';
}

async function listDir(path) {
  const unc = await checkedUnc(path);
  const dirents = await readdir(unc, { withFileTypes: true });
  const entries = await Promise.all(dirents.slice(0, LIST_MAX_ENTRIES).map(async (dirent) => {
    const type = dirent.isDirectory() ? 'dir' : dirent.isSymbolicLink() ? 'link' : 'file';
    let size = null;
    let mtime = null;
    let linkDir = false;
    try {
      const info = await stat(`${unc}\\${dirent.name}`);
      size = info.size;
      mtime = info.mtimeMs;
      if (type === 'link') linkDir = info.isDirectory();
    } catch { /* 悬空链接等，保留 null */ }
    return { name: dirent.name, type, linkDir, size, mtime };
  }));
  entries.sort((a, b) => ((a.type === 'dir' || a.linkDir) ? 0 : 1) - ((b.type === 'dir' || b.linkDir) ? 0 : 1) || a.name.localeCompare(b.name, 'zh-CN'));
  return entries;
}

async function readTextFile(path) {
  const unc = await checkedUnc(path);
  const info = await stat(unc);
  if (info.isDirectory()) throw new Error('目标是目录，请进入后再操作');
  if (info.size > EDIT_MAX_BYTES) throw new Error('文件超过 1MB，请使用下载');
  const buffer = await readFile(unc);
  if (buffer.subarray(0, 8192).includes(0)) throw new Error('二进制文件不支持在线编辑，请使用下载');
  return { size: info.size, mtime: info.mtimeMs, content: buffer.toString('utf8') };
}

function decodeOutput(value) {
  if (typeof value === 'string') return value.replaceAll('\0', '').trim();
  if (!Buffer.isBuffer(value)) return '';
  const sample = value.subarray(0, Math.min(value.length, 80));
  const nulls = [...sample].filter((byte) => byte === 0).length;
  return (nulls > sample.length / 5 ? value.toString('utf16le') : value.toString('utf8')).replaceAll('\0', '').trim();
}

async function run(file, args, options = {}) {
  try {
    const result = await execFileAsync(file, args, {
      encoding: 'buffer',
      windowsHide: true,
      timeout: options.timeout ?? 20_000,
      maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
    });
    return { ok: true, stdout: decodeOutput(result.stdout), stderr: decodeOutput(result.stderr), code: 0 };
  } catch (error) {
    return {
      ok: false,
      stdout: decodeOutput(error.stdout),
      stderr: decodeOutput(error.stderr) || error.message,
      code: Number.isInteger(error.code) ? error.code : 1,
    };
  }
}

const wsl = (...args) => run('wsl.exe', ['-d', DISTRO, '-u', 'root', '--exec', ...args]);
const docker = (...args) => wsl('docker', ...args);

async function isUbuntuRunning() {
  const result = await run('wsl.exe', ['--list', '--running', '--quiet']);
  return result.ok && result.stdout.split(/\r?\n/).map((item) => item.trim()).includes(DISTRO);
}

function parseLines(value) {
  return value ? value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
}

function parseLabels(value) {
  const labels = {};
  for (const pair of parseLines(value)) {
    const index = pair.indexOf('=');
    if (index > 0) labels[pair.slice(0, index)] = pair.slice(index + 1);
  }
  return labels;
}

function validContainerName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name);
}

// 一次 bash 采样取齐：IP、内存、CPU、uptime、磁盘、配置的服务状态
function statusSnapshotCommand() {
  const unitList = ['docker.service', ...readServicesConfig().map((item) => item.unit)];
  return "ip=$(hostname -I 2>/dev/null | awk '{print $1}'); "
    + "total=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo); "
    + "avail=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo); "
    + "cpu=$(LC_ALL=C top -bn1 | awk '/Cpu\\(s\\)/{print 100-$8; exit}'); "
    + "up=$(awk '{print int($1)}' /proc/uptime); "
    + "set -- $(df -k / | tail -1); "
    + `sv=$(systemctl is-active ${unitList.join(' ')} 2>/dev/null | tr '\\n' ','); `
    + 'printf \'%s|%s|%s|%s|%s|%s|%s|%s\' "$ip" "$total" "$avail" "$cpu" "$up" "$2" "$3" "$sv"';
}

async function getStatus() {
  const ubuntuRunning = await isUbuntuRunning();
  const base = {
    timestamp: new Date().toISOString(),
    host: os.hostname(),
    distro: DISTRO,
    ubuntu: { running: ubuntuRunning, systemd: false, ip: null, memoryUsedMb: null, memoryTotalMb: null, cpuPercent: null, uptimeSec: null, diskUsedMb: null, diskTotalMb: null },
    services: { list: [] },
    docker: { running: false, version: null, runningContainers: 0, totalContainers: 0, df: [] },
    containers: [],
  };

  if (!ubuntuRunning) return base;

  const [systemd, dockerActive, systemInfo] = await Promise.all([
    wsl('systemctl', 'is-system-running'),
    wsl('systemctl', 'is-active', 'docker.service'),
    wsl('bash', '-lc', statusSnapshotCommand()),
  ]);

  base.ubuntu.systemd = systemd.ok && ['running', 'degraded'].includes(systemd.stdout);
  const parts = systemInfo.stdout.split('|');
  if (systemInfo.ok && parts.length === 8) {
    const total = Number(parts[1]);
    const available = Number(parts[2]);
    const uptimeSec = Number(parts[4]);
    const diskTotalKb = Number(parts[5]);
    const diskUsedKb = Number(parts[6]);
    base.ubuntu.ip = parts[0] || null;
    base.ubuntu.memoryTotalMb = Number.isFinite(total) ? total : null;
    base.ubuntu.memoryUsedMb = Number.isFinite(total - available) ? total - available : null;
    base.ubuntu.cpuPercent = Number.isFinite(Number(parts[3])) ? Math.max(0, Math.min(100, Number(parts[3]))) : null;
    base.ubuntu.uptimeSec = Number.isFinite(uptimeSec) && uptimeSec > 0 ? uptimeSec : null;
    base.ubuntu.diskTotalMb = Number.isFinite(diskTotalKb) && diskTotalKb > 0 ? Math.round(diskTotalKb / 1024) : null;
    base.ubuntu.diskUsedMb = Number.isFinite(diskUsedKb) && diskUsedKb > 0 ? Math.round(diskUsedKb / 1024) : null;
    const serviceStates = parts[7].split(',').filter(Boolean);
    const servicesConfig = readServicesConfig();
    base.services = {
      list: [
        { key: 'docker', name: 'Docker', state: serviceStates[0] || 'unknown' },
        ...servicesConfig.map((item, index) => ({ key: item.key, name: item.name, state: serviceStates[index + 1] || 'unknown' })),
      ],
    };
  }

  base.docker.running = dockerActive.ok && dockerActive.stdout === 'active';
  if (!base.docker.running) return base;

  const [version, list, diskUsage] = await Promise.all([
    docker('version', '--format', '{{.Server.Version}}'),
    docker('ps', '-a', '--no-trunc', '--format', '{{json .}}'),
    docker('system', 'df', '--format', '{{json .}}'),
  ]);

  base.docker.version = version.ok ? version.stdout : null;
  base.docker.df = parseLines(diskUsage.stdout).flatMap((line) => {
    try {
      const item = JSON.parse(line);
      return [{ Type: String(item.Type), Total: Number(item.TotalCount ?? item.Total) || 0, Size: String(item.Size) }];
    } catch { return []; }
  });
  base.containers = parseLines(list.stdout).flatMap((line) => {
    try {
      const item = JSON.parse(line);
      const labels = parseLabels(item.Labels);
      return [{
        id: item.ID,
        name: item.Names,
        image: item.Image,
        state: item.State,
        status: item.Status,
        ports: item.Ports || '',
        project: labels['com.docker.compose.project'] || '',
        running: item.State === 'running',
      }];
    } catch {
      return [];
    }
  });
  base.docker.totalContainers = base.containers.length;
  base.docker.runningContainers = base.containers.filter((container) => container.running).length;
  return base;
}

async function addActivity(action, target, success, message) {
  await mkdir(DATA_DIR, { recursive: true });
  const entry = { at: new Date().toISOString(), action, target, success, message: String(message || '').slice(0, 500) };
  await appendFile(ACTIVITY_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
  return entry;
}

async function readActivity(limit = 50) {
  try {
    const lines = (await readFile(ACTIVITY_FILE, 'utf8')).split('\n').filter(Boolean).slice(-limit);
    return lines.map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean).reverse();
  } catch {
    return [];
  }
}

async function readBody(request, maxBytes = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('请求内容过大');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function setCors(response, origin) {
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
}

function send(response, status, body, origin) {
  setCors(response, origin);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.statusCode = status;
  response.end(JSON.stringify(body));
}

async function requireContainer(name) {
  if (!validContainerName(name)) throw new Error('容器名称无效');
  const inspect = await docker('inspect', name);
  if (!inspect.ok) throw new Error('容器不存在');
}

function serviceUnitFor(key) {
  if (!/^[a-z0-9-]{1,64}$/.test(key)) return null;
  if (key === 'docker') return 'docker.service';
  return readServicesConfig().find((item) => item.key === key)?.unit || null;
}

async function handleAction(pathname, body) {
  if (pathname === '/api/wsl/start') {
    const start = await run('wsl.exe', ['-d', DISTRO, '--exec', 'true'], { timeout: 60_000 });
    if (!start.ok) throw new Error(start.stderr || 'Ubuntu 启动失败');
    const dockerStart = await wsl('systemctl', 'start', 'docker.service');
    if (!dockerStart.ok) throw new Error(dockerStart.stderr || 'Docker 启动失败');
    return addActivity('start', 'Ubuntu', true, 'Ubuntu 与 Docker 已启动');
  }

  if (pathname === '/api/wsl/shutdown') {
    if (body.confirm !== 'SHUTDOWN') throw new Error('需要关机确认');
    if (!(await isUbuntuRunning())) return addActivity('shutdown', 'Ubuntu', true, 'Ubuntu 已经停止');
    const ids = await docker('ps', '-q');
    const runningIds = parseLines(ids.stdout);
    if (runningIds.length) {
      const stopped = await docker('stop', '-t', '60', ...runningIds);
      if (!stopped.ok) throw new Error(stopped.stderr || '部分容器未能正常停止');
    }
    await wsl('systemctl', 'stop', 'postgresql.service');
    await wsl('systemctl', 'stop', 'dpanel.service', 'docker.service', 'docker.socket', 'containerd.service');
    const result = await run('wsl.exe', ['--terminate', DISTRO], { timeout: 30_000 });
    if (!result.ok) throw new Error(result.stderr || 'Ubuntu 关闭失败');
    return addActivity('shutdown', 'Ubuntu', true, '容器和服务已正常停止，Ubuntu 已关闭');
  }

  if (pathname === '/api/docker/start') {
    const result = await wsl('systemctl', 'start', 'docker.service');
    if (!result.ok) throw new Error(result.stderr || 'Docker 启动失败');
    return addActivity('start', 'Docker', true, 'Docker 已启动');
  }

  if (pathname === '/api/docker/stop') {
    if (body.confirm !== 'STOP_DOCKER') throw new Error('需要停止确认');
    const result = await wsl('systemctl', 'stop', 'dpanel.service', 'docker.service', 'docker.socket', 'containerd.service');
    if (!result.ok) throw new Error(result.stderr || 'Docker 停止失败');
    return addActivity('stop', 'Docker', true, 'Docker 服务已停止');
  }

  const match = pathname.match(/^\/api\/containers\/([^/]+)\/(start|stop|restart)$/);
  if (match) {
    const name = decodeURIComponent(match[1]);
    const action = match[2];
    await requireContainer(name);
    const args = action === 'stop' ? ['stop', '-t', '60', name] : [action, name];
    const result = await docker(...args);
    if (!result.ok) throw new Error(result.stderr || `容器${action}失败`);
    return addActivity(action, name, true, result.stdout || '操作完成');
  }

  const serviceMatch = pathname.match(/^\/api\/services\/([^/]+)\/(start|stop)$/);
  if (serviceMatch) {
    const name = decodeURIComponent(serviceMatch[1]);
    const action = serviceMatch[2];
    const unit = serviceUnitFor(name);
    if (!unit) throw new Error('未知服务，可在 data/wpanel.local.json 中配置');
    const result = await wsl('systemctl', action, unit);
    if (!result.ok) throw new Error(result.stderr || `服务${action}失败`);
    return addActivity(action, name, true, `${name} 服务已${action === 'start' ? '启动' : '停止'}`);
  }

  throw new Error('不支持的操作');
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin;
  const url = new URL(request.url || '/', `http://${request.headers.host || `${HOST}:${PORT}`}`);

  if (request.method === 'OPTIONS') {
    if (!origin || !allowedOrigins.has(origin)) return send(response, 403, { error: '来源不受信任' }, origin);
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-WPanel-Token');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.statusCode = 204;
    return response.end();
  }

  if (origin && !allowedOrigins.has(origin)) return send(response, 403, { error: '来源不受信任' }, origin);

  try {
    if (request.method === 'GET' && url.pathname === '/api/session') return send(response, 200, { token: TOKEN }, origin);
    if (request.method === 'GET' && url.pathname === '/api/status') return send(response, 200, await getStatus(), origin);
    if (request.method === 'GET' && url.pathname === '/api/activity') return send(response, 200, await readActivity(), origin);

    if (request.method === 'GET' && url.pathname === '/api/files/list') {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const path = normalizeLinuxPath(url.searchParams.get('path') || '');
      if (!path) throw new Error('路径无效');
      return send(response, 200, { path, roots: FILE_ROOTS, entries: await listDir(path) }, origin);
    }

    if (request.method === 'GET' && url.pathname === '/api/files/read') {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const path = normalizeLinuxPath(url.searchParams.get('path') || '');
      if (!path) throw new Error('路径无效');
      const file = await readTextFile(path);
      return send(response, 200, { path, name: path.split('/').pop(), ...file }, origin);
    }

    if (request.method === 'GET' && url.pathname === '/api/files/raw') {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const path = normalizeLinuxPath(url.searchParams.get('path') || '');
      if (!path) throw new Error('路径无效');
      const unc = await checkedUnc(path);
      const info = await stat(unc);
      if (info.isDirectory()) throw new Error('目录不支持下载，请进入后操作具体文件');
      setCors(response, origin);
      response.setHeader('Content-Type', 'application/octet-stream');
      response.setHeader('Content-Length', info.size);
      response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.split('/').pop() || 'file')}`);
      response.setHeader('Cache-Control', 'no-store');
      response.statusCode = 200;
      const stream = createReadStream(unc);
      stream.on('error', () => response.destroy());
      stream.pipe(response);
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/containers/') && url.pathname.endsWith('/logs')) {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const name = decodeURIComponent(url.pathname.split('/')[3] || '');
      await requireContainer(name);
      const tailParam = url.searchParams.get('tail');
      const tail = ['100', '250', '1000'].includes(tailParam || '') ? tailParam : '250';
      const logs = await docker('logs', '--tail', tail, '--timestamps', name);
      return send(response, 200, { name, logs: `${logs.stdout}${logs.stderr ? `\n${logs.stderr}` : ''}`.trim() }, origin);
    }

    if (request.method === 'POST' && url.pathname === '/api/files/upload') {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const dir = normalizeLinuxPath(url.searchParams.get('path') || '');
      const name = url.searchParams.get('name') || '';
      if (!dir || !validFileName(name)) throw new Error('上传参数无效');
      const dirStat = await stat(await checkedUnc(dir));
      if (!dirStat.isDirectory()) throw new Error('目标不是目录');
      const target = dir === '/' ? `/${name}` : `${dir}/${name}`;
      const unc = await checkedUnc(target, false);
      if (url.searchParams.get('overwrite') !== '1') {
        try { await access(unc); throw new Error('同名文件已存在'); } catch (error) { if (error.message === '同名文件已存在') throw error; }
      }
      let total = 0;
      const limit = new Transform({
        transform(chunk, encoding, callback) {
          total += chunk.length;
          if (total > UPLOAD_MAX_BYTES) { callback(new Error('文件超过 100MB 上限')); return; }
          callback(null, chunk);
        },
      });
      try {
        await pipeline(request, limit, createWriteStream(unc));
      } catch (error) {
        await rm(unc, { force: true }).catch(() => {});
        throw new Error(error.message || '上传失败');
      }
      const activity = await addActivity('upload', target, true, `${name}（${(total / 1024).toFixed(1)} KB）`);
      return send(response, 200, { ok: true, activity }, origin);
    }

    if (request.method === 'POST' && url.pathname.startsWith('/api/files/')) {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const action = url.pathname.slice('/api/files/'.length);
      const body = action === 'save' ? await readBody(request, 2 * 1024 * 1024) : await readBody(request);

      if (action === 'save') {
        const path = normalizeLinuxPath(body.path || '');
        if (!path || typeof body.content !== 'string') throw new Error('保存参数无效');
        if (Buffer.byteLength(body.content, 'utf8') > EDIT_MAX_BYTES) throw new Error('内容超过 1MB，请拆分后再保存');
        await writeFile(await checkedUnc(path), body.content, 'utf8');
        return send(response, 200, { ok: true, activity: await addActivity('save', path, true, '文件已保存') }, origin);
      }

      if (action === 'mkdir' || action === 'touch') {
        const path = normalizeLinuxPath(body.path || '');
        if (!path) throw new Error('路径无效');
        const unc = await checkedUnc(path, false);
        try { await access(unc); throw new Error('同名文件或目录已存在'); } catch (error) { if (error.message === '同名文件或目录已存在') throw error; }
        if (action === 'mkdir') await mkdir(unc); else await writeFile(unc, '', 'utf8');
        return send(response, 200, { ok: true, activity: await addActivity(action, path, true, action === 'mkdir' ? '目录已创建' : '文件已创建') }, origin);
      }

      if (action === 'rename') {
        const from = normalizeLinuxPath(body.path || '');
        if (!from || !validFileName(body.name)) throw new Error('重命名参数无效');
        const to = `${from.slice(0, from.lastIndexOf('/'))}/${body.name}`;
        const fromUnc = await checkedUnc(from, false);
        const toUnc = await checkedUnc(to, false);
        try { await access(toUnc); throw new Error('目标名称已存在'); } catch (error) { if (error.message === '目标名称已存在') throw error; }
        await rename(fromUnc, toUnc);
        return send(response, 200, { ok: true, activity: await addActivity('rename', from, true, `→ ${body.name}`) }, origin);
      }

      if (action === 'delete') {
        const paths = Array.isArray(body.paths) ? body.paths : [];
        if (!paths.length) throw new Error('未选择要删除的对象');
        for (const item of paths.slice(0, 100)) {
          const path = normalizeLinuxPath(item);
          if (!path) throw new Error('路径无效');
          await rm(await checkedUnc(path, false), { recursive: true, force: true });
          await addActivity('delete', path, true, '已删除');
        }
        return send(response, 200, { ok: true, activity: await addActivity('delete', paths[0], true, `共 ${Math.min(paths.length, 100)} 项`) }, origin);
      }

      throw new Error('不支持的文件操作');
    }

    if (request.method === 'POST' && url.pathname.startsWith('/api/')) {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const body = await readBody(request);
      const activity = await handleAction(url.pathname, body);
      return send(response, 200, { ok: true, activity }, origin);
    }

    return send(response, 404, { error: '未找到接口' }, origin);
  } catch (error) {
    const denied = error && (error.code === 'EPERM' || error.code === 'EACCES');
    const message = denied
      ? '权限不足：文件共享以 WSL 默认用户身份访问，root 属地的目录不可操作'
      : (error.message || '操作失败');
    await addActivity('error', url.pathname, false, message).catch(() => {});
    return send(response, 400, { error: message }, origin);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`WPanel controller listening on http://${HOST}:${PORT}`);
});
