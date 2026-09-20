/*
 * 界面截图采集脚本
 * ---------------------------------------------------------------
 * 前置：
 *   1) node tools/screenshot/mock-api.mjs                     # 模拟控制服务 :8799
 *   2) NEXT_PUBLIC_WPANEL_API=http://127.0.0.1:8799 npm run dev   # 前端 :8765
 *   3) node tools/screenshot/capture.mjs                       # 输出到 docs/screenshots/
 *
 * 依赖 playwright-core（可用 WPANEL_PLAYWRIGHT 指定模块目录）；
 * 浏览器优先使用 WPANEL_CHROME，其次 ms-playwright 缓存中的 Chromium。
 */
import { createRequire } from 'node:module';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

const BASE = process.env.WPANEL_UI || 'http://localhost:8765';
const OUT_DIR = path.resolve('docs/screenshots');
const CHROME_CANDIDATES = [
  process.env.WPANEL_CHROME,
  path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1226', 'chrome-win64', 'chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

function loadPlaywright() {
  const roots = [process.env.WPANEL_PLAYWRIGHT, 'playwright-core', path.resolve('node_modules/playwright-core')].filter(Boolean);
  for (const root of roots) {
    try { return require(root); } catch { /* 尝试下一个 */ }
  }
  throw new Error('未找到 playwright-core，请设置 WPANEL_PLAYWRIGHT 指向其安装目录');
}

const { chromium } = loadPlaywright();
const executablePath = CHROME_CANDIDATES.find((item) => existsSync(item));
if (!executablePath) throw new Error('未找到可用的 Chromium/Chrome 可执行文件');

mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORT = { width: 1440, height: 900 };

async function settle(page, extra = 900) {
  await page.waitForTimeout(extra);
}

async function gotoView(page, label) {
  await page.getByRole('button', { name: label, exact: true }).first().click();
  await settle(page);
}

async function shoot(page, name, { fullPage = false } = {}) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage });
  console.log(`  ✓ ${name}.png${fullPage ? ' (full)' : ''}`);
}

const browser = await chromium.launch({ executablePath, args: ['--font-render-hinting=none', '--hide-scrollbars'] });

for (const theme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1.5, locale: 'zh-CN', colorScheme: theme });
  await context.addInitScript((value) => {
    try { localStorage.setItem('wpanel-theme', value); } catch { /* 忽略 */ }
  }, theme);
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await settle(page, 1600);

  console.log(`[${theme}]`);

  // 总览
  await shoot(page, `overview-${theme}`);

  // 容器：卡片视图
  await gotoView(page, '容器');
  await shoot(page, `containers-cards-${theme}`);

  // 容器：列表视图
  await page.getByRole('button', { name: '列表', exact: true }).first().click();
  await settle(page, 700);
  await shoot(page, `containers-list-${theme}`);

  // 容器日志弹窗
  await page.getByRole('button', { name: '日志', exact: true }).first().click();
  await settle(page, 1200);
  await shoot(page, `container-logs-${theme}`);
  await page.keyboard.press('Escape');
  await settle(page, 500);

  // 镜像与卷
  await gotoView(page, '镜像');
  await shoot(page, `images-volumes-${theme}`, { fullPage: true });

  // Compose 编排
  await gotoView(page, '编排');
  await shoot(page, `compose-${theme}`);

  // 应用商店
  await gotoView(page, '应用商店');
  await settle(page, 1400);
  await shoot(page, `store-${theme}`);

  // 应用商店：安装预览
  const firstCard = page.locator('.store-card, article').filter({ hasText: 'MySQL' }).first();
  if (await firstCard.count()) {
    await firstCard.click();
    await settle(page, 1400);
    await shoot(page, `store-install-${theme}`);
    await page.keyboard.press('Escape');
    await settle(page, 500);
  }

  // AI 助手
  await gotoView(page, 'AI 助手');
  await shoot(page, `ai-${theme}`);

  // 文件管理（进入 /home/dev 展示目录内容）
  await gotoView(page, '文件管理');
  await settle(page, 900);
  const devRow = page.getByRole('button', { name: 'dev', exact: true }).first();
  if (await devRow.count()) {
    await devRow.click();
    await settle(page, 1100);
  }
  await shoot(page, `files-${theme}`);

  // 日志记录
  await gotoView(page, '日志记录');
  await shoot(page, `activity-${theme}`, { fullPage: true });

  await context.close();
}

await browser.close();
console.log(`\n截图已输出到 ${OUT_DIR}`);
