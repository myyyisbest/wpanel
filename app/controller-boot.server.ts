import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

// 控制服务自愈：UI 服务在响应时检查本机控制器，失联则以分离进程拉起 server.mjs。
// 安全不变量：仅请求字面量环回地址 127.0.0.1 + 数字端口 + 固定路径，不接受任何用户输入。
const rawPort = process.env.WPANEL_PORT || '8766';
const CONTROLLER_PORT = /^\d{1,5}$/.test(rawPort) ? rawPort : '8766';
const CONTROLLER_BASE = `http://127.0.0.1:${CONTROLLER_PORT}`;

async function healthy(): Promise<boolean> {
  try {
    const response = await fetch(`${CONTROLLER_BASE}/api/session`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

let inFlight: Promise<boolean> | null = null;

export async function ensureController(): Promise<boolean> {
  if (await healthy()) return true;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const root = process.cwd();
      // 防呆：仅当运行目录确实是 WPanel 项目时才尝试拉起
      if (!existsSync(path.join(root, 'server.mjs'))) return false;
      const child = spawn(process.execPath, ['server.mjs'], {
        cwd: root,
        detached: true,
        stdio: 'ignore',
        env: process.env,
        windowsHide: true,
      });
      child.unref();
      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (await healthy()) return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setTimeout(() => { inFlight = null; }, 5000);
    }
  })();
  return inFlight;
}
