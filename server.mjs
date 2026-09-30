import http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFile, mkdir, open, readFile, readdir, rename, rm, stat, realpath, access, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, statSync, createReadStream, createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
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

// 前端来源白名单：默认放行本机 8765（UI 端口），可用 WPANEL_UI_ORIGINS 覆盖（逗号分隔）
const allowedOrigins = new Set(
  (process.env.WPANEL_UI_ORIGINS || 'http://localhost:8765,http://127.0.0.1:8765')
    .split(',').map((item) => item.trim()).filter(Boolean),
);
// Host 白名单：浏览器访问本机服务必然带 Host，DNS rebinding 会带上攻击者域名，这里直接拒绝
const allowedHosts = new Set(
  (process.env.WPANEL_ALLOWED_HOSTS || `127.0.0.1:${PORT},localhost:${PORT}`)
    .split(',').map((item) => item.trim()).filter(Boolean),
);

// data/*.json 读取缓存（按 mtime 失效）：配置读取在请求热路径上，避免每次都落盘
const jsonCache = new Map();
function readJsonCached(file) {
  try {
    const info = statSync(file);
    const cached = jsonCache.get(file);
    if (cached && cached.mtimeMs === info.mtimeMs) return cached.value;
    const value = JSON.parse(readFileSync(file, 'utf8'));
    jsonCache.set(file, { mtimeMs: info.mtimeMs, value });
    return value;
  } catch {
    jsonCache.delete(file);
    return null;
  }
}

// 写入 data/*.json：mtime 精度可能只有秒级，写入后主动失效缓存
async function writeJsonConfig(file, value) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
  jsonCache.delete(file);
}

// 服务列表默认仅 docker；本机扩展项写在 data/wpanel.local.json（不进 git）：
// { "services": [{ "key": "postgresql", "name": "PostgreSQL", "unit": "postgresql.service" }] }
// key 与 unit 都做严格校验：unit 最终会进 systemctl 参数，不接受任何多余字符
function readServicesConfig() {
  const parsed = readJsonCached(LOCAL_CONFIG_FILE);
  const list = Array.isArray(parsed?.services) ? parsed.services : [];
  return list.filter((item) => item && typeof item.key === 'string' && typeof item.unit === 'string'
    && /^[a-z0-9-]{1,64}$/.test(item.key) && /^[A-Za-z0-9@._-]{1,64}\.service$/.test(item.unit))
    .map((item) => ({ key: item.key, name: String(item.name || item.key).slice(0, 64), unit: item.unit }));
}

// 关闭 WSL / 停止 Docker 时一并停止的单元：内置 Docker 三件套 + 配置的服务 + WPANEL_STOP_UNITS
const DOCKER_UNITS = ['docker.service', 'docker.socket', 'containerd.service'];
const EXTRA_STOP_UNITS = (process.env.WPANEL_STOP_UNITS || '')
  .split(',').map((item) => item.trim()).filter((item) => /^[a-z0-9@._-]{1,64}\.service$/.test(item));
const dockerStopUnits = () => [...new Set([...DOCKER_UNITS, ...EXTRA_STOP_UNITS])];
const shutdownStopUnits = () => [...new Set([...dockerStopUnits(), ...readServicesConfig().map((item) => item.unit)])];

// 归一化允许根：去尾部斜杠、只保留绝对路径
// （相对路径或带尾斜杠的写法永远不会匹配成功，容易让人误以为配置已生效）
const FILE_ROOTS = (process.env.WPANEL_ROOTS || '/home')
  .split(',').map((item) => item.trim().replace(/\/+$/, '')).filter((item) => item.startsWith('/'));
if (!FILE_ROOTS.length) {
  console.warn('WPANEL_ROOTS 中没有合法的绝对路径，已回退为 /home');
  FILE_ROOTS.push('/home');
}
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

// 允许根校验 + UNC 组装。follow=false 用于删除/改名（只操作链接本身，不跟随目标）。
//
// 路径防护分两层，二者都不是唯一依赖：
//   1) assertAllowedPath —— 词法层：按字符串前缀判断，拒绝 `..`（由 normalizeLinuxPath 前置拦截）；
//   2) assertRealWithinRoot —— 规范化层：用 realpath 解析父目录（follow 时连目标一起解析），
//      再对解析结果做一次白名单判断。
// 第 2 层用于兜住第 1 层看不见的符号链接跳转，例如 /home/dev/current/xxx
// （current 是指向 /etc 的符号链接）这类路径。
//
// 实测补充（Windows + WSL 9p 共享）：当前平台**无法跟随 Linux 符号链接**——
// 对 /bin、/lib、/etc/os-release 这类链接，lstat 报 EISDIR，realpath / readdir / readFile 一律报 ENOENT；
// 而同一目标的真实路径（如 /usr/bin/bash）读写正常。因此经符号链接的访问会被底层直接拒绝（fail-closed），
// 第 2 层在此平台属于纵深防御：一旦平台日后支持跟随链接，它会立刻成为有效的拦截点。
async function checkedUnc(target, follow = true) {
  assertAllowedPath(target);
  const base = await resolveUncBase();
  const unc = base + target.replaceAll('/', '\\');
  const parent = target.slice(0, target.lastIndexOf('/')) || '/';
  await assertRealWithinRoot(base, parent);
  if (follow) await assertRealWithinRoot(base, target);
  return unc;
}

async function assertRealWithinRoot(base, linuxPath) {
  let real;
  try {
    real = await realpath(base + linuxPath.replaceAll('/', '\\'));
  } catch {
    // ENOENT / EISDIR 等：目标不存在，或目标本身是 Linux 符号链接（本平台无法解析）。
    // 两种情况都留给调用方按实际操作报错，从而保持 fail-closed —— 不会因「解析不出来」而放行。
    return;
  }
  // 前缀比较不区分大小写：发行版名在不同入口可能大小写不一致，
  // 否则会把正常路径误判成越界，直接让文件管理不可用。
  if (!real.toLowerCase().startsWith(base.toLowerCase())) {
    // realpath 成功却落在共享之外 —— 只可能是异常跳转，按越界处理（保守拒绝）
    throw new Error('路径超出允许范围（解析结果不在 WSL 共享内）');
  }
  // 共享根本身会解析成 base + '\'，相对路径为空 —— 此时无需再做白名单判断
  const relative = real.slice(base.length).replaceAll('\\', '/').replace(/\/+$/, '');
  if (!relative) return;
  assertAllowedPath(relative);
}

function validFileName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 255 && !name.includes('/') && !name.includes('\0') && name !== '.' && name !== '..';
}

async function listDir(path) {
  const unc = await checkedUnc(path);
  const dirents = await readdir(unc, { withFileTypes: true });
  const visible = dirents.slice(0, LIST_MAX_ENTRIES);
  const entries = await Promise.all(visible.map(async (dirent) => {
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
  // 截断要显式告知前端，避免用户以为「目录里就这些」
  return { entries, total: dirents.length, truncated: dirents.length > visible.length };
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
      cwd: options.cwd,
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

// 跟踪子进程：收到退出信号时一并回收，避免残留 wsl.exe 与 docker 进程
const children = new Set();
function trackChild(child) {
  children.add(child);
  child.on('close', () => children.delete(child));
  child.on('error', () => children.delete(child));
  return child;
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
// 单元名以位置参数传入（不拼进脚本正文），因此配置里写什么都无法注入 shell；
// 脚本内先 units=("$@") 存一份，因为后面的 set -- 会覆盖位置参数
function statusSnapshotCommand() {
  const units = ['docker.service', ...readServicesConfig().map((item) => item.unit)];
  const script = 'units=("$@"); '
    + "ip=$(hostname -I 2>/dev/null | awk '{print $1}'); "
    + "total=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo); "
    + "avail=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo); "
    + "cpu=$(LC_ALL=C top -bn1 | awk '/Cpu\\(s\\)/{print 100-$8; exit}'); "
    + "up=$(awk '{print int($1)}' /proc/uptime); "
    + 'set -- $(df -k / | tail -1); '
    + 'sv=$(systemctl is-active "${units[@]}" 2>/dev/null | tr \'\\n\' \',\'); '
    + 'printf \'%s|%s|%s|%s|%s|%s|%s|%s\' "$ip" "$total" "$avail" "$cpu" "$up" "$2" "$3" "$sv"';
  return { script, units };
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

  // 单元名以位置参数传入：$0 占位后依次是各单元，脚本内不再拼接任何配置内容
  const statusCmd = statusSnapshotCommand();
  const [systemd, dockerActive, systemInfo] = await Promise.all([
    wsl('systemctl', 'is-system-running'),
    wsl('systemctl', 'is-active', 'docker.service'),
    wsl('bash', '-lc', statusCmd.script, 'wpanel-status', ...statusCmd.units),
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

const ACTIVITY_MAX_BYTES = 5 * 1024 * 1024;
const ACTIVITY_TAIL_BYTES = 2 * 1024 * 1024;

async function addActivity(action, target, success, message) {
  await mkdir(DATA_DIR, { recursive: true });
  const entry = { at: new Date().toISOString(), action, target, success, message: String(message || '').slice(0, 500) };
  const line = `${JSON.stringify(entry)}\n`;
  // 轮转：文件超过上限时保留上一份，避免长期运行后无限增长
  try {
    const info = await stat(ACTIVITY_FILE);
    if (info.size + Buffer.byteLength(line) > ACTIVITY_MAX_BYTES) {
      await rename(ACTIVITY_FILE, `${ACTIVITY_FILE}.1`).catch(() => {});
    }
  } catch { /* 文件尚不存在 */ }
  await appendFile(ACTIVITY_FILE, line, 'utf8');
  return entry;
}

// 只读取文件尾部窗口，避免日志增长后整文件读入内存
async function readTailText(file, maxBytes) {
  let handle;
  try {
    handle = await open(file, 'r');
    const info = await handle.stat();
    const length = Math.min(info.size, maxBytes);
    const start = info.size - length;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const text = buffer.toString('utf8');
    // 起点可能落在某行中间，丢弃首行残片
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
  } catch {
    return '';
  } finally {
    await handle?.close().catch(() => {});
  }
}

// 审计日志读取：服务端关键字过滤 + 分页（只回读文件尾部窗口，防止文件过大拖垮内存）
async function readActivity({ search = '', page = 1, pageSize = 30 } = {}) {
  const text = await readTailText(ACTIVITY_FILE, ACTIVITY_TAIL_BYTES);
  const entries = text.split('\n').filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean).reverse();
  const keyword = String(search || '').trim().toLowerCase();
  const filtered = keyword
    ? entries.filter((item) => `${item.action} ${item.target} ${item.message}`.toLowerCase().includes(keyword))
    : entries;
  const total = filtered.length;
  const start = (Math.max(1, page) - 1) * pageSize;
  return { total, page: Math.max(1, page), pageSize, items: filtered.slice(start, start + pageSize) };
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

// 统一安全响应头：禁止 MIME 嗅探与跨站嵌套，且不通过 Referer 泄露本机地址
function setSecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
}

// RFC 5987 的 ext-value 只接受 attr-char，而 encodeURIComponent 不会转义 ' ( ) * —— 含这些字符的文件名
// 会让 Content-Disposition 变成非法值。这里补转义，并把 CR/LF 一并编码以杜绝头部注入。
function encodeRfc5987(value) {
  return encodeURIComponent(value.replace(/[\r\n]/g, ' '))
    .replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function send(response, status, body, origin) {
  setCors(response, origin);
  setSecurityHeaders(response);
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

// ===== AI 副驾驶：只读建议者。配置存 data/ai.local.json（不进 git），AI 输出一律不直接执行 =====
const AI_CONFIG_FILE = path.join(DATA_DIR, 'ai.local.json');
function readAiConfig() {
  const config = readJsonCached(AI_CONFIG_FILE);
  if (!config?.baseUrl || !config?.apiKey || !config?.model) return null;
  return { baseUrl: String(config.baseUrl).replace(/\/$/, ''), apiKey: String(config.apiKey), model: String(config.model) };
}

async function aiChat(messages) {
  const config = readAiConfig();
  if (!config) throw new Error('尚未配置 AI：请在「AI 助手」页填写 OpenAI 兼容接口地址、密钥与模型');
  let response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages, temperature: 0.2 }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw new Error(`无法连接 AI 接口（${config.baseUrl}）：${error.message === 'fetch failed' ? '网络不可达或地址有误' : error.message}`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`AI 接口错误（HTTP ${response.status}）：${(data.error?.message || '').slice(0, 200)}`);
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('AI 返回内容为空');
  return content;
}

const SAFE_TEXT = (value, max = 8000) => String(value || '').slice(0, max);

const COMPOSE_FILE_NAMES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];
let composeDirCache = null;
// 编排目录最终会作为位置参数交给 bash，这里只接受不含空格与引号的绝对路径
function normalizeComposeDir(value) {
  const dir = String(value || '').replaceAll('\\', '/').replace(/\/+$/, '');
  if (!dir.startsWith('/') || /['"\r\n\t ]/.test(dir)) throw new Error('编排目录需为不含空格与引号的绝对路径');
  return dir;
}
async function resolveComposeDir() {
  // 默认放在 WSL 默认用户的 home 下（UNC 共享以该身份访问，必须可写），可用 WPANEL_COMPOSE_DIR 覆盖
  if (process.env.WPANEL_COMPOSE_DIR) return normalizeComposeDir(process.env.WPANEL_COMPOSE_DIR);
  if (composeDirCache) return composeDirCache;
  const home = await run('wsl.exe', ['-d', DISTRO, '--exec', 'sh', '-c', 'printf %s "$HOME"']);
  composeDirCache = normalizeComposeDir(`${home.ok && home.stdout ? home.stdout.trim() : FILE_ROOTS[0] || '/tmp'}/compose`);
  return composeDirCache;
}

function validProjectName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) && !name.includes('..');
}

// ===== 应用商店（默认 1Panel appstore 仓库，tarball 下载到本地缓存；仅取 compose 与变量定义，忽略任何脚本字段） =====
const STORE_DIR = path.join(DATA_DIR, 'store-cache', 'appstore');
const STORE_REPO_DEFAULT = process.env.WPANEL_STORE_REPO || 'https://github.com/1Panel-dev/appstore';
const STORE_BRANCH_DEFAULT = process.env.WPANEL_STORE_BRANCH || 'main';
// 模板源可在界面修改，持久化在 data/wpanel.local.json 的 store 段（不进 git）；
// mirror 为 docker.io 镜像加速站（安装时改写镜像地址），默认 docker.1ms.run，留空则直连
function readStoreConfig() {
  const fallback = { repo: STORE_REPO_DEFAULT, branch: STORE_BRANCH_DEFAULT, mirror: 'docker.1ms.run' };
  const parsed = readJsonCached(LOCAL_CONFIG_FILE);
  const repo = parsed?.store?.repo;
  const branch = parsed?.store?.branch;
  const mirror = parsed?.store?.mirror;
  return {
    repo: typeof repo === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/.test(repo) ? repo.replace(/\.git$/, '') : fallback.repo,
    branch: typeof branch === 'string' && /^[\w.-]{1,64}$/.test(branch) ? branch : fallback.branch,
    mirror: mirror == null ? fallback.mirror : (typeof mirror === 'string' && /^[a-z0-9][a-z0-9.-]*(:\d+)?$/.test(mirror) ? mirror : ''),
  };
}

// 仅改写 docker.io 镜像（显式或隐式）；其他 registry（ghcr/quay/私有）保持原样
function mirrorImageRef(image, mirror) {
  const name = image.replace(/^docker\.io\//, '');
  const slash = name.indexOf('/');
  // 无路径段（如 busybox:latest、nginx）→ docker.io 隐式镜像；有路径段才可能带 registry 主机
  if (slash === -1) return `${mirror}/${name}`;
  const host = name.slice(0, slash);
  // Docker 把含 . 或 : 的首段视为 registry 主机，localhost 也单独特判 —— 漏掉它会把它误当命名空间改写
  const hasExplicitRegistry = host.includes('.') || host.includes(':') || host === 'localhost';
  return hasExplicitRegistry ? name : `${mirror}/${name}`;
}

function applyImageMirror(composeText, mirror) {
  if (!mirror) return composeText;
  try {
    const doc = parseYaml(composeText);
    const services = doc?.services;
    if (services && typeof services === 'object') {
      for (const service of Object.values(services)) {
        if (service && typeof service.image === 'string') service.image = mirrorImageRef(service.image, mirror);
      }
    }
    return stringifyYaml(doc);
  } catch { return composeText; }
}
const validAppId = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(id);

// 并发调用共享同一次下载：多个标签页同时打开商店时，避免重复下载与互相覆盖缓存目录
let storeDownload = null;
async function downloadStore() {
  if (storeDownload) return storeDownload;
  storeDownload = fetchStoreArchive().finally(() => { storeDownload = null; });
  return storeDownload;
}

async function fetchStoreArchive() {
  const { repo, branch } = readStoreConfig();
  const cacheDir = path.dirname(STORE_DIR);
  await mkdir(cacheDir, { recursive: true });
  // 走 codeload tarball（git 协议在部分网络环境不可达）
  const codeload = `${repo.replace(/\/$/, '').replace('https://github.com/', 'https://codeload.github.com/')}/tar.gz/refs/heads/${branch}`;
  const response = await fetch(codeload, { redirect: 'follow', signal: AbortSignal.timeout(600_000) });
  if (!response.ok || !response.body) throw new Error(`模板源下载失败（HTTP ${response.status}）`);
  // 每次下载用独立文件名，避免并发或上次残留的 tar 互相踩
  const tarPath = path.join(cacheDir, `store-${randomUUID()}.tar.gz`);
  await pipeline(response.body, createWriteStream(tarPath));
  // 用相对路径解压：GNU tar 会把 'C:\' 中的冒号当作远程主机名
  const extractResult = await run('tar', ['-xzf', path.basename(tarPath)], { timeout: 300_000, cwd: cacheDir });
  await rm(tarPath, { force: true }).catch(() => {});
  if (!extractResult.ok) throw new Error('模板源解压失败：' + (extractResult.stderr || '').slice(0, 200));
  const extracted = path.join(cacheDir, `${(repo.split('/').pop() || 'appstore').replace(/\.git$/, '')}-${branch}`);
  if (!existsSync(path.join(extracted, 'apps'))) throw new Error('模板源解压后缺少 apps 目录');
  if (existsSync(STORE_DIR)) await rm(STORE_DIR, { recursive: true, force: true });
  await rename(extracted, STORE_DIR);
}

async function ensureStore() {
  if (existsSync(path.join(STORE_DIR, 'apps'))) return;
  await downloadStore();
}

// 安装后台任务：compose up 拉镜像可能持续数分钟，输出流式存入内存任务供前端轮询
const installJobs = new Map();
// 只清理已结束的任务，避免把仍在运行的安装日志丢掉
function pruneInstallJobs() {
  if (installJobs.size <= 20) return;
  for (const [key, job] of installJobs) {
    if (installJobs.size <= 20) break;
    if (job.status === 'running') continue;
    installJobs.delete(key);
  }
}

function safeStorePath(...segments) {
  const root = path.resolve(STORE_DIR);
  const resolved = path.resolve(root, ...segments);
  // 必须等于根本身，或落在「根 + 分隔符」之下。
  // 只比较裸前缀会漏掉兄弟目录：STORE_DIR=/tmp/store 时 /tmp/store-evil 也能通过。
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error('路径无效');
  return resolved;
}

// 商店模板来自第三方：外部链接只放行 http/https。
// 否则模板里写 javascript: 之类的伪协议会被前端渲染成可点链接，点击即在面板源下执行脚本。
const httpUrl = (value) => (/^https?:\/\//i.test(String(value || '')) ? String(value) : '');

async function storeAppMeta(id) {
  const file = safeStorePath('apps', id, 'data.yml');
  const meta = parseYaml(await readFile(file, 'utf8')) || {};
  const props = meta.additionalProperties || {};
  return {
    id,
    name: props.name || meta.name || id,
    title: props.shortDescZh || meta.description || props.shortDescEn || '',
    description: meta.description || props.shortDescZh || '',
    tags: props.tags || meta.tags || [],
    type: props.type || '',
    website: httpUrl(props.website),
    github: httpUrl(props.github),
    document: httpUrl(props.document),
  };
}

async function storeVersions(id) {
  const root = safeStorePath('apps', id);
  try {
    const dirents = await readdir(root, { withFileTypes: true });
    return dirents.filter((item) => item.isDirectory() && /^\d+(\.\d+)*$/.test(item.name)).map((item) => item.name)
      .sort((a, b) => String(a).localeCompare(String(b), 'en', { numeric: true }));
  } catch {
    return [];
  }
}

async function storeFormFields(id, version) {
  const versionMeta = parseYaml(await readFile(safeStorePath('apps', id, version, 'data.yml'), 'utf8')) || {};
  return (versionMeta.additionalProperties?.formFields || []).map((field) => ({
    envKey: String(field.envKey || ''),
    label: field.label?.zh || field.labelZh || field.label?.en || field.labelEn || String(field.envKey || ''),
    default: field.default ?? '',
    required: field.required === true,
    type: field.type === 'number' ? 'number' : 'text',
    rule: field.rule || '',
  })).filter((field) => /^[A-Za-z0-9_]+$/.test(field.envKey));
}

// 安装渲染：表单参数 → .env；镜像按加速站设置改写。预览与安装共用，保证所见即所装
async function renderStoreInstall(id, version, params) {
  const formFields = await storeFormFields(id, version);
  const input = typeof params === 'object' && params ? params : {};
  const envLines = [`CONTAINER_NAME=${id}`];
  for (const field of formFields) {
    const key = field.envKey;
    let value = String(input[key] ?? field.default ?? '').trim();
    if (!value && field.required) throw new Error(`缺少必填参数：${field.label}`);
    if (value) {
      if (field.rule === 'paramPort' && !/^\d{1,5}$/.test(value)) throw new Error(`端口参数 ${key} 无效`);
      else if (field.type === 'number' && !/^-?\d+(\.\d+)?$/.test(value)) throw new Error(`参数 ${key} 需为数字`);
      else if (!/^[A-Za-z0-9_\-.:\/@+= ]*$/.test(value)) throw new Error(`参数 ${key} 含不允许的字符`);
    }
    envLines.push(`${key}=${value}`);
  }
  const rawCompose = await readFile(safeStorePath('apps', id, version, 'docker-compose.yml'), 'utf8');
  return { compose: applyImageMirror(rawCompose, readStoreConfig().mirror), envText: envLines.join('\n') + '\n', rawCompose };
}

async function composeProjectUnc(project, mustExist = true) {
  if (!validProjectName(project)) throw new Error('项目名无效');
  const dir = await resolveComposeDir();
  const base = await resolveUncBase();
  const unc = `${base}${dir}\\${project}`.replaceAll('/', '\\');
  if (mustExist) {
    const info = await stat(unc).catch(() => null);
    if (!info?.isDirectory()) throw new Error('项目目录不存在');
  }
  return unc;
}

// 目录与项目名以位置参数传入，不做字符串拼接，避免命令注入
async function runCompose(project, args, timeout = 180_000) {
  const dir = await resolveComposeDir();
  const result = await run('wsl.exe', [
    '-d', DISTRO, '-u', 'root', '--exec', 'bash', '-lc',
    'cd -- "$1/$2" && shift 2 && docker compose "$@" 2>&1',
    'wpanel-compose', dir, project, ...args.trim().split(/\s+/).filter(Boolean),
  ], { timeout });
  if (!result.ok) throw new Error(result.stdout || result.stderr || 'Compose 操作失败');
  return result;
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
    // 停止单元来自 data/wpanel.local.json 的 services 配置 + WPANEL_STOP_UNITS，不再写死具体服务
    await wsl('systemctl', 'stop', ...shutdownStopUnits());
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
    const result = await wsl('systemctl', 'stop', ...dockerStopUnits());
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

  // 容器内命令执行（实验性）：在指定容器内运行单条命令
  const execMatch = pathname.match(/^\/api\/containers\/([^/]+)\/exec$/);
  if (execMatch) {
    const name = decodeURIComponent(execMatch[1]);
    await requireContainer(name);
    const command = typeof body.cmd === 'string' ? body.cmd.trim() : '';
    if (!command || command.length > 2000) throw new Error('命令为空或超长（≤2000 字符）');
    if (/[\r\n]/.test(command)) throw new Error('命令不支持换行');
    const result = await docker('exec', name, 'sh', '-c', command);
    const output = `${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`.trim();
    await addActivity('exec', name, true, SAFE_TEXT(command, 200));
    return { __raw: { ok: true, output: SAFE_TEXT(output, 64000) || '（无输出）' } };
  }

  // 删除单个容器（须先停止）与批量清理已停止容器
  const removeMatch = pathname.match(/^\/api\/containers\/([^/]+)\/remove$/);
  if (removeMatch) {
    const name = decodeURIComponent(removeMatch[1]);
    await requireContainer(name);
    const result = await docker('rm', name);
    if (!result.ok) throw new Error(result.stderr || '容器删除失败');
    return addActivity('delete', name, true, '容器已删除');
  }

  if (pathname === '/api/containers/prune') {
    const result = await docker('container', 'prune', '-f');
    if (!result.ok) throw new Error(result.stderr || '清理失败');
    return addActivity('prune', '已停止容器', true, result.stdout || '清理完成');
  }

  // 手动拉取镜像（自动套用商店加速站设置），后台任务流式输出
  if (pathname === '/api/images/pull') {
    const image = typeof body.image === 'string' ? body.image.trim() : '';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._\/:-]{1,200}$/.test(image)) throw new Error('镜像名无效');
    const { mirror } = readStoreConfig();
    const target = mirror ? mirrorImageRef(image, mirror) : image;
    const jobId = randomUUID().replaceAll('-', '');
    const job = { status: 'running', output: `docker pull ${target}\n` };
    installJobs.set(jobId, job);
    pruneInstallJobs();
    const child = trackChild(spawn('wsl.exe', ['-d', DISTRO, '-u', 'root', '--exec', 'docker', 'pull', target], { windowsHide: true }));
    const append = (chunk) => {
      job.output += chunk.toString('utf8');
      if (job.output.length > 120000) job.output = job.output.slice(-90000);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', (error) => { job.status = 'error'; job.output += `\n${error.message}`; });
    child.on('close', (code) => {
      job.status = code === 0 ? 'done' : 'error';
      job.output += `\n[进程退出码 ${code}]`;
      addActivity('download', target, code === 0, code === 0 ? '镜像拉取完成' : '镜像拉取失败').catch(() => {});
    });
    return { __raw: { ok: true, jobId, target } };
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

  const imageMatch = pathname.match(/^\/api\/images\/(delete|prune)$/);
  if (imageMatch) {
    const action = imageMatch[1];
    if (action === 'delete') {
      const id = typeof body.id === 'string' ? body.id : '';
      if (!/^[a-f0-9]{6,64}$/i.test(id)) throw new Error('镜像 ID 无效');
      const result = await docker('rmi', id);
      if (!result.ok) throw new Error(result.stderr || '镜像删除失败');
      return addActivity('delete', `image ${id.slice(0, 12)}`, true, result.stdout || '镜像已删除');
    }
    const all = body.all === true;
    const result = await docker('image', 'prune', ...(all ? ['-a'] : []), '-f');
    if (!result.ok) throw new Error(result.stderr || '镜像清理失败');
    return addActivity('prune', all ? '全部未使用镜像' : '悬空镜像', true, result.stdout || '清理完成');
  }

  const volumeMatch = pathname.match(/^\/api\/volumes\/(delete|prune)$/);
  if (volumeMatch) {
    const action = volumeMatch[1];
    if (action === 'delete') {
      const name = typeof body.name === 'string' ? body.name : '';
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name)) throw new Error('卷名称无效');
      const result = await docker('volume', 'rm', name);
      if (!result.ok) throw new Error(result.stderr || '卷删除失败');
      return addActivity('delete', `volume ${name}`, true, '卷已删除');
    }
    const result = await docker('volume', 'prune', '-a', '-f');
    if (!result.ok) throw new Error(result.stderr || '卷清理失败');
    return addActivity('prune', '未使用卷', true, result.stdout || '清理完成');
  }

  const composeMatch = pathname.match(/^\/api\/compose\/(up|down|delete)$/);
  if (composeMatch) {
    const action = composeMatch[1];
    const project = typeof body.project === 'string' ? body.project : '';
    const unc = await composeProjectUnc(project, true);
    if (action === 'delete') {
      // 先尝试停止容器（未部署过的项目 down 只会警告，忽略其结果）；数据卷默认保留
      try { await runCompose(project, `down${body.removeVolumes ? ' -v' : ''}`); } catch { /* 项目从未部署时继续删除文件夹 */ }
      await rm(unc, { recursive: true, force: true });
      return addActivity('delete', `compose ${project}`, true, '项目已删除（compose 文件与文件夹）');
    }
    const result = await runCompose(project, action === 'up' ? 'up -d' : `down${body.removeVolumes ? ' -v' : ''}`);
    return addActivity(action, `compose ${project}`, true, result.stdout.slice(-500) || '操作完成');
  }

  const storeMatch = pathname.match(/^\/api\/store\/(install|uninstall)$/);
  if (storeMatch) {
    const action = storeMatch[1];
    const id = typeof body.id === 'string' ? body.id : '';
    if (!validAppId(id)) throw new Error('应用 ID 无效');
    await ensureStore();
    const versions = await storeVersions(id);
    if (!versions.length) throw new Error('该应用没有可用版本');
    const version = versions[versions.length - 1];
    const composeUnc = await composeProjectUnc(id, action === 'uninstall'); // 安装时要求不存在，卸载时要求存在

    if (action === 'install') {
      if (existsSync(composeUnc)) throw new Error('编排目录中已存在同名项目，请先卸载或改名');
      const rendered = await renderStoreInstall(id, version, body.params);
      await mkdir(composeUnc, { recursive: true });
      await writeFile(`${composeUnc}\\docker-compose.yml`, rendered.compose, 'utf8');
      await writeFile(`${composeUnc}\\.env`, rendered.envText, 'utf8');
      if (rendered.rawCompose.includes('1panel-network')) {
        const network = await docker('network', 'inspect', '1panel-network');
        if (!network.ok) await docker('network', 'create', '1panel-network');
      }
      // 后台任务执行 up（镜像拉取可能持续数分钟），前端轮询 /api/store/job/<id> 展示实时输出
      const jobId = randomUUID().replaceAll('-', '');
      const job = { status: 'running', output: '' };
      installJobs.set(jobId, job);
      pruneInstallJobs();
      const dir = await resolveComposeDir();
      const child = trackChild(spawn('wsl.exe', [
        '-d', DISTRO, '-u', 'root', '--exec', 'bash', '-lc',
        'cd -- "$1/$2" && docker compose up -d 2>&1',
        'wpanel-store', dir, id,
      ], { windowsHide: true }));
      const append = (chunk) => {
        job.output += chunk.toString('utf8');
        if (job.output.length > 120000) job.output = job.output.slice(-90000);
      };
      child.stdout.on('data', append);
      child.stderr.on('data', append);
      child.on('error', (error) => { job.status = 'error'; job.output += `\n${error.message}`; });
      child.on('close', (code) => {
        job.status = code === 0 ? 'done' : 'error';
        job.output += `\n[进程退出码 ${code}]`;
        addActivity('install', `store ${id}`, code === 0, `v${version} ${code === 0 ? '部署完成' : '部署失败（见安装日志）'}`).catch(() => {});
      });
      return { __raw: { ok: true, jobId } };
    }

    // uninstall
    const downResult = await runCompose(id, `down${body.removeVolumes ? ' -v' : ''}`);
    await rm(composeUnc, { recursive: true, force: true });
    return addActivity('delete', `store ${id}`, true, `已卸载${body.removeVolumes ? '（含卷）' : ''} ${downResult.stdout.slice(-200)}`);
  }

  throw new Error('不支持的操作');
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin;

  // Host 校验必须排在 URL 解析之前：解析 URL 要用 Host 头作为 base，
  // 先解析等于信任了尚未校验的输入；而且非法 Host 会让 new URL 抛错，
  // 此时还没进入下面的 try，响应将永远不返回（客户端只能等超时）。
  // 同时挡住「恶意域名解析到 127.0.0.1」的 DNS rebinding 读取。
  if (!allowedHosts.has(request.headers.host || '')) return send(response, 403, { error: 'Host 不受信任' }, origin);

  let url;
  try {
    url = new URL(request.url || '/', `http://${request.headers.host}`);
  } catch {
    return send(response, 400, { error: '请求地址无效' }, origin);
  }

  if (request.method === 'OPTIONS') {
    if (!origin || !allowedOrigins.has(origin)) return send(response, 403, { error: '来源不受信任' }, origin);
    setSecurityHeaders(response);
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
    if (request.method === 'GET' && url.pathname === '/api/images') {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const result = await docker('images', '--format', '{{json .}}');
      const images = parseLines(result.stdout).flatMap((line) => {
        try {
          const item = JSON.parse(line);
          return [{ id: item.ID, repository: item.Repository, tag: item.Tag, size: item.Size, createdSince: item.CreatedSince }];
        } catch { return []; }
      });
      return send(response, 200, { images }, origin);
    }

    if (request.method === 'GET' && url.pathname === '/api/volumes') {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const [listing, usage] = await Promise.all([
        docker('volume', 'ls', '--format', '{{json .}}'),
        docker('system', 'df', '-v'),
      ]);
      const sizes = {};
      const lines = parseLines(usage.stdout);
      const section = lines.findIndex((line) => line.startsWith('Local Volumes space usage'));
      if (section >= 0) {
        for (const line of lines.slice(section + 2)) {
          const fields = line.trim().split(/\s+/);
          if (fields.length >= 3) sizes[fields[0]] = { links: fields[1], size: fields[2] };
        }
      }
      const volumes = parseLines(listing.stdout).flatMap((line) => {
        try {
          const item = JSON.parse(line);
          return [{ name: item.Name, driver: item.Driver, links: sizes[item.Name]?.links ?? '—', size: sizes[item.Name]?.size ?? '—' }];
        } catch { return []; }
      });
      return send(response, 200, { volumes }, origin);
    }

    if (request.method === 'GET' && url.pathname === '/api/compose/projects') {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const dir = await resolveComposeDir();
      // 以默认用户身份创建（UNC 共享按默认用户校验权限，root 创建会导致后续不可写）
      await run('wsl.exe', ['-d', DISTRO, '--exec', 'mkdir', '-p', dir]);
      const base = await resolveUncBase();
      const rootUnc = `${base}${dir}`.replaceAll('/', '\\');
      let dirents = [];
      try { dirents = await readdir(rootUnc, { withFileTypes: true }); } catch { return send(response, 200, { dir, projects: [] }, origin); }
      const projects = [];
      for (const dirent of dirents.filter((item) => item.isDirectory())) {
        let file = null;
        for (const name of COMPOSE_FILE_NAMES) {
          if (await access(`${rootUnc}\\${dirent.name}\\${name}`).then(() => true).catch(() => false)) { file = name; break; }
        }
        if (file) projects.push({ name: dirent.name, file });
      }
      projects.sort((a, b) => a.name.localeCompare(b.name));
      return send(response, 200, { dir, projects }, origin);
    }

    if (request.method === 'GET' && url.pathname === '/api/compose/logs') {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const project = url.searchParams.get('project') || '';
      await composeProjectUnc(project);
      const tailParam = url.searchParams.get('tail');
      const tail = ['100', '250', '1000'].includes(tailParam || '') ? tailParam : '250';
      const result = await runCompose(project, `logs --tail ${tail}`);
      return send(response, 200, { name: project, logs: result.stdout.trim() }, origin);
    }

    if (request.method === 'GET' && url.pathname === '/api/ai/settings') {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const config = readAiConfig();
      return send(response, 200, { baseUrl: config?.baseUrl || '', model: config?.model || '', hasKey: Boolean(config) }, origin);
    }

    if (request.method === 'POST' && url.pathname === '/api/ai/settings') {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const body = await readBody(request);
      const baseUrl = SAFE_TEXT(body.baseUrl, 300).replace(/\/$/, '');
      const submitted = SAFE_TEXT(body.apiKey, 300);
      const model = SAFE_TEXT(body.model, 120);
      // 前端留空时回填 __KEEP__：沿用已保存的密钥，避免二次保存把真实密钥覆盖成占位符
      const apiKey = submitted === '__KEEP__' ? (readAiConfig()?.apiKey || '') : submitted;
      if (!/^https?:\/\//.test(baseUrl)) throw new Error('接口地址需以 http(s):// 开头');
      if (!baseUrl || !apiKey || !model) throw new Error('三项配置均必填（密钥留空时需先成功保存过一次）');
      await writeJsonConfig(AI_CONFIG_FILE, { baseUrl, apiKey, model });
      return addActivity('save', 'AI 设置', true, `已保存（${model}）`);
    }

    if (request.method === 'POST' && url.pathname === '/api/ai/diagnose') {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const body = await readBody(request);
      const name = typeof body.name === 'string' ? body.name : '';
      await requireContainer(name);
      const [inspectInfo, logInfo] = await Promise.all([
        docker('inspect', '--format', '{{.State.Status}} restarts={{.RestartCount}} started={{.State.StartedAt}}', name),
        docker('logs', '--tail', '120', '--timestamps', name),
      ]);
      const prompt = [
        `容器名: ${name}`,
        `状态: ${SAFE_TEXT(inspectInfo.stdout, 300)}`,
        `最近日志:\n${SAFE_TEXT(logInfo.stdout + logInfo.stderr, 6000)}`,
      ].join('\n\n');
      const content = await aiChat([
        { role: 'system', content: '你是容器运维专家。根据容器状态与日志输出诊断：1) 可能的根因 2) 建议的处置步骤（只给文字建议，不要输出命令之外的内容）。用简洁中文回答，最多 300 字。' },
        { role: 'user', content: prompt },
      ]);
      return send(response, 200, { content }, origin);
    }

    if (request.method === 'POST' && url.pathname === '/api/ai/generate-compose') {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const body = await readBody(request);
      const content = await aiChat([
        { role: 'system', content: '你是 Docker Compose 专家。根据用户描述输出一个可直接使用的 compose.yaml，只输出 YAML 内容本身（不要 markdown 代码块标记），使用 compose v2 语法（services: 开头）。镜像优先使用官方源。' },
        { role: 'user', content: SAFE_TEXT(body.prompt, 2000) },
      ]);
      const yaml = content.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
      return send(response, 200, { content: yaml }, origin);
    }

    if (request.method === 'POST' && url.pathname === '/api/ai/plan') {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const body = await readBody(request);
      const containersNow = (await getStatus()).containers.map((item) => `${item.name}(${item.running ? 'running' : 'exited'})`).join(', ');
      const content = await aiChat([
        { role: 'system', content: '你是容器运维助手。用户会描述期望的容器操作。你只能从这些动作中选择：start（启动容器）、stop（停止容器）、restart（重启容器），target 必须是现有容器名。只输出一个 JSON 数组，形如 [{"action":"restart","target":"name"}]，不要输出任何其他文字。如果需求无法用这些动作表达，输出 []。' },
        { role: 'user', content: `现有容器: ${containersNow}\n\n用户需求: ${SAFE_TEXT(body.prompt, 1000)}` },
      ]);
      let actions = [];
      try {
        const match = content.match(/\[[\s\S]*\]/);
        actions = JSON.parse(match ? match[0] : '[]');
      } catch { throw new Error('AI 返回的计划无法解析，请换个描述重试'); }
      const allowed = { start: 1, stop: 1, restart: 1 };
      actions = (Array.isArray(actions) ? actions : []).slice(0, 10).filter((item) => item && allowed[item.action] && typeof item.target === 'string' && validContainerName(item.target));
      return send(response, 200, { actions }, origin);
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/containers/') && url.pathname.endsWith('/inspect')) {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const name = decodeURIComponent(url.pathname.split('/')[3] || '');
      await requireContainer(name);
      const result = await docker('inspect', '--format', '{{json .}}', name);
      let summary;
      try {
        const item = JSON.parse(result.stdout);
        summary = {
          name: String(item.Name || '').replace(/^\//, ''),
          image: item.Config?.Image || '',
          status: item.State?.Status || '',
          startedAt: item.State?.StartedAt || '',
          restartCount: item.RestartCount ?? 0,
          restartPolicy: item.HostConfig?.RestartPolicy?.Name || 'no',
          ports: Object.entries(item.NetworkSettings?.Ports || {}).flatMap(([key, bindings]) => (bindings || []).map((binding) => `${binding.HostIp}:${binding.HostPort} → ${key}`)),
          mounts: (item.Mounts || []).map((mount) => `${mount.Source || mount.Name || '?'} → ${mount.Destination}${mount.Mode ? ` (${mount.Mode})` : ''}`),
          networks: Object.keys(item.NetworkSettings?.Networks || {}),
          env: (item.Config?.Env || []).slice(0, 40),
        };
      } catch { throw new Error('inspect 输出解析失败'); }
      return send(response, 200, summary, origin);
    }

    // 镜像导出：docker save 流式返回 tar（优先按 仓库:标签 导出，保留名称信息）
    if (request.method === 'GET' && url.pathname === '/api/images/export') {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const id = url.searchParams.get('id') || '';
      if (!/^[a-f0-9]{6,64}$/i.test(id)) throw new Error('镜像 ID 无效');
      const check = await docker('inspect', id);
      if (!check.ok) throw new Error('镜像不存在');
      let reference = id;
      let fileName = `image-${id.slice(0, 12)}`;
      const list = await docker('images', '--format', '{{json .}}');
      for (const line of parseLines(list.stdout)) {
        try {
          const item = JSON.parse(line);
          if (item.ID && String(item.ID).startsWith(id) && item.Repository && item.Repository !== '<none>') {
            reference = `${item.Repository}:${item.Tag}`;
            fileName = `${String(item.Repository).replace(/[^\w.-]+/g, '_')}_${item.Tag}`;
            break;
          }
        } catch { /* 跳过无法解析的行 */ }
      }
      setCors(response, origin);
      setSecurityHeaders(response);
      response.setHeader('Content-Type', 'application/x-tar');
      response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}.tar`);
      response.setHeader('Cache-Control', 'no-store');
      response.flushHeaders();
      const child = trackChild(spawn('wsl.exe', ['-d', DISTRO, '-u', 'root', '--exec', 'docker', 'save', reference], { windowsHide: true }));
      // docker save 正常时 stderr 是安静的，但告警也走 stderr；
      // 只有「一个字节都没发出去就失败」才中断响应，避免把正常的 tar 截断成半截文件
      let sent = false;
      let stderrTail = '';
      child.stdout.on('data', () => { sent = true; });
      child.stdout.pipe(response);
      child.stderr.on('data', (chunk) => { stderrTail = (stderrTail + chunk.toString('utf8')).slice(-400); });
      child.on('error', () => { try { response.destroy(); } catch { /* 已断开 */ } });
      child.on('close', (code) => {
        if (code !== 0 && !sent) {
          console.error(`镜像导出失败（${reference}）：${stderrTail.trim() || `退出码 ${code}`}`);
          try { response.destroy(); } catch { /* 已断开 */ }
        }
      });
      request.on('close', () => child.kill());
      return;
    }

    // 镜像导入：请求体为 docker save 的 tar 流，上限 2GB
    if (request.method === 'POST' && url.pathname === '/api/images/import') {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      // 临时文件带随机后缀，避免并发导入互相覆盖；data/ 可能尚未创建
      await mkdir(DATA_DIR, { recursive: true });
      const tmpPath = path.join(DATA_DIR, `import-${randomUUID()}.tar`);
      let total = 0;
      const limit = new Transform({
        transform(chunk, encoding, callback) {
          total += chunk.length;
          if (total > 2 * 1024 * 1024 * 1024) { callback(new Error('文件超过 2GB 上限')); return; }
          callback(null, chunk);
        },
      });
      try {
        await pipeline(request, limit, createWriteStream(tmpPath));
        const child = trackChild(spawn('wsl.exe', ['-d', DISTRO, '-u', 'root', '--exec', 'docker', 'load'], { windowsHide: true }));
        const loadResult = await Promise.all([
          pipeline(createReadStream(tmpPath), child.stdin).then(() => 'loaded'),
          new Promise((resolve) => {
            let output = '';
            child.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
            child.stderr.on('data', (chunk) => { output += chunk.toString('utf8'); });
            child.on('close', (code) => resolve({ code, output: output.slice(-500) }));
            child.on('error', (error) => resolve({ code: 1, output: error.message }));
          }),
        ]);
        const outcome = loadResult[1];
        await rm(tmpPath, { force: true });
        if (outcome.code !== 0) throw new Error(outcome.output || '导入失败');
        return addActivity('install', '镜像导入', true, outcome.output);
      } catch (error) {
        await rm(tmpPath, { force: true }).catch(() => {});
        throw error;
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/activity') {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
      const pageSizeRaw = Number(url.searchParams.get('pageSize')) || 30;
      const pageSize = Math.min(100, Math.max(1, pageSizeRaw));
      return send(response, 200, await readActivity({ search: url.searchParams.get('search') || '', page, pageSize }), origin);
    }

    // ===== 应用商店 =====
    if (request.method === 'GET' && url.pathname === '/api/store/apps') {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      await ensureStore();
      const appsRoot = safeStorePath('apps');
      const dirents = await readdir(appsRoot, { withFileTypes: true });
      const apps = (await Promise.all(dirents.filter((item) => item.isDirectory()).map(async (item) => {
        try { return await storeAppMeta(item.name); } catch { return null; }
      }))).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      const storeConfig = readStoreConfig();
      return send(response, 200, { source: `${storeConfig.repo}@${storeConfig.branch}`, mirror: storeConfig.mirror, apps }, origin);
    }

    if (request.method === 'POST' && url.pathname === '/api/store/source') {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const body = await readBody(request);
      const repo = SAFE_TEXT(body.repo, 300).replace(/\/$/, '').replace(/\.git$/, '');
      const branch = SAFE_TEXT(body.branch, 64) || 'main';
      const mirror = typeof body.mirror === 'string' ? body.mirror.trim() : '';
      if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('模板源需为 GitHub 仓库地址（https://github.com/用户/仓库）');
      if (!/^[\w.-]{1,64}$/.test(branch)) throw new Error('分支名无效');
      if (mirror && !/^[a-z0-9][a-z0-9.-]*(:\d+)?$/.test(mirror)) throw new Error('加速站地址无效（形如 docker.1ms.run）');
      const previous = readStoreConfig();
      const local = readJsonCached(LOCAL_CONFIG_FILE) || {};
      local.store = { repo, branch, mirror };
      await writeJsonConfig(LOCAL_CONFIG_FILE, local);
      // 仅当仓库/分支变化时才清缓存重新下载；加速站变化即时生效
      if (repo !== previous.repo || branch !== previous.branch) await rm(STORE_DIR, { recursive: true, force: true });
      return addActivity('save', '商店模板源', true, `${repo}@${branch}${mirror ? ` · 加速站 ${mirror}` : ' · 直连'}`);
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/store/job/')) {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const jobId = url.pathname.slice('/api/store/job/'.length);
      if (!/^[a-f0-9]{32}$/.test(jobId)) throw new Error('任务 ID 无效');
      const job = installJobs.get(jobId);
      if (!job) return send(response, 404, { error: '任务不存在或已被清理' }, origin);
      return send(response, 200, { status: job.status, output: job.output.slice(-20000) }, origin);
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/store/logo/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/store/logo/'.length));
      if (!validAppId(id)) return send(response, 400, { error: '应用 ID 无效' }, origin);
      setCors(response, origin);
      setSecurityHeaders(response);
      const logo = await readFile(safeStorePath('apps', id, 'logo.png')).catch(() => null);
      if (!logo) { response.statusCode = 404; return response.end(); }
      response.setHeader('Content-Type', 'image/png');
      response.setHeader('Cache-Control', 'max-age=86400');
      response.statusCode = 200;
      response.end(logo);
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/store/app/')) {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const id = decodeURIComponent(url.pathname.slice('/api/store/app/'.length));
      if (!validAppId(id)) throw new Error('应用 ID 无效');
      await ensureStore();
      const versions = await storeVersions(id);
      if (!versions.length) throw new Error('该应用没有可用版本');
      const version = versions[versions.length - 1];
      const meta = await storeAppMeta(id);
      return send(response, 200, { ...meta, version, formFields: await storeFormFields(id, version), mirror: readStoreConfig().mirror }, origin);
    }

    // 安装预览：与真实安装共用同一渲染逻辑（参数校验 + .env + 镜像加速改写）
    if (request.method === 'POST' && url.pathname === '/api/store/render') {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const body = await readBody(request);
      const id = typeof body.id === 'string' ? body.id : '';
      if (!validAppId(id)) throw new Error('应用 ID 无效');
      await ensureStore();
      const versions = await storeVersions(id);
      if (!versions.length) throw new Error('该应用没有可用版本');
      const version = versions[versions.length - 1];
      const rendered = await renderStoreInstall(id, version, body.params);
      return send(response, 200, { compose: rendered.compose, env: rendered.envText, mirror: readStoreConfig().mirror }, origin);
    }

    if (request.method === 'POST' && url.pathname === '/api/store/refresh') {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      await rm(STORE_DIR, { recursive: true, force: true });
      await downloadStore();
      const storeConfig = readStoreConfig();
      return addActivity('refresh', '应用商店', true, `模板源已更新（${storeConfig.repo}@${storeConfig.branch}）`);
    }

    // 实时日志（SSE）：docker logs -f，token 走查询参数（EventSource 无法携带请求头）
    if (request.method === 'GET' && url.pathname.startsWith('/api/containers/') && url.pathname.endsWith('/follow')) {
      if (url.searchParams.get('token') !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const name = decodeURIComponent(url.pathname.split('/')[3] || '');
      const tailParam = url.searchParams.get('tail');
      const tail = ['100', '250', '1000'].includes(tailParam || '') ? tailParam : '250';
      await requireContainer(name);
      setCors(response, origin);
      setSecurityHeaders(response);
      response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.flushHeaders();
      const child = trackChild(spawn('wsl.exe', ['-d', DISTRO, '--exec', 'docker', 'logs', '-f', '--tail', tail, name], { windowsHide: true }));
      const push = (payload) => { try { response.write(`data: ${JSON.stringify(payload)}\n\n`); } catch { /* 连接已断开 */ } };
      let pending = '';
      const onChunk = (chunk) => {
        pending += chunk.toString('utf8');
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || '';
        for (const line of lines) if (line) push({ line });
      };
      child.stdout.on('data', onChunk);
      child.stderr.on('data', onChunk);
      child.on('error', () => push({ error: '日志进程启动失败' }));
      child.on('close', () => { push({ done: true }); response.end(); });
      const keepAlive = setInterval(() => { try { response.write(': ping\n\n'); } catch { /* 忽略 */ } }, 15000);
      request.on('close', () => { clearInterval(keepAlive); child.kill(); });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/files/list') {
      if (request.headers['x-wpanel-token'] !== TOKEN) return send(response, 403, { error: '会话无效' }, origin);
      const path = normalizeLinuxPath(url.searchParams.get('path') || '');
      if (!path) throw new Error('路径无效');
      return send(response, 200, { path, roots: FILE_ROOTS, ...(await listDir(path)) }, origin);
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
      setSecurityHeaders(response);
      response.setHeader('Content-Type', 'application/octet-stream');
      response.setHeader('Content-Length', info.size);
      response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeRfc5987(path.split('/').pop() || 'file')}`);
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
      // follow=true：同名目标若是指向允许根之外的符号链接，直接拒绝写入
      const unc = await checkedUnc(target);
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
      if (activity && activity.__raw) return send(response, 200, activity.__raw, origin);
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

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用：请先运行「停止WPanel.bat」，或设置 WPANEL_PORT 换一个端口。`);
  } else {
    console.error(`控制服务启动失败：${error.message}`);
  }
  process.exit(1);
});

// 退出时回收子进程（日志跟随、镜像拉取/导出、商店安装任务）
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const child of children) {
      try { child.kill(); } catch { /* 已退出 */ }
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
