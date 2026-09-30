/*
 * 截图用模拟控制服务
 * ---------------------------------------------------------------
 * 用途：在没有 WSL2 / Docker 的机器上渲染真实前端，采集 README 与 Wiki 使用的界面截图。
 * 它只实现 server.mjs 的「读接口」形状，返回固定演示数据，不执行任何真实操作。
 *
 *   node tools/screenshot/mock-api.mjs        # 监听 127.0.0.1:8799
 *   WPANEL_MOCK_PORT=9000 node tools/screenshot/mock-api.mjs
 *
 * 前端需以 NEXT_PUBLIC_WPANEL_API=http://127.0.0.1:8799 构建（见 capture.mjs）。
 */
import http from 'node:http';

const HOST = '127.0.0.1';
const PORT = Number(process.env.WPANEL_MOCK_PORT) || 8799;
const TOKEN = 'demo-token';

const CONTAINERS = [
  { id: '9f1c2ab74e5d0b3f8a6c1e2d4f7b9a0c3d5e6f7a8b9c0d1e2f3a4b5c6d7e8f90', name: 'mysql', image: 'mysql:8.4', state: 'running', status: 'Up 2 days (healthy)', ports: '0.0.0.0:3306->3306/tcp', project: 'blog', running: true },
  { id: '3b7d9e1a5c2f4b6d8e0a1c3e5f7b9d0a2c4e6f8b0d1a3c5e7f9b1d3a5c7e9f01', name: 'redis', image: 'redis:7.4-alpine', state: 'running', status: 'Up 2 days', ports: '0.0.0.0:6379->6379/tcp', project: 'blog', running: true },
  { id: 'c4e6f8a0b2d4c6e8f0a2b4d6c8e0f2a4b6d8c0e2f4a6b8d0c2e4f6a8b0d2c4e6', name: 'halo', image: 'halohub/halo:2.20', state: 'running', status: 'Up 2 days (healthy)', ports: '0.0.0.0:8090->8090/tcp', project: 'halo', running: true },
  { id: 'a1b3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b3', name: 'portainer', image: 'portainer/portainer-ce:2.21.5', state: 'running', status: 'Up 2 days', ports: '0.0.0.0:9443->9443/tcp, 0.0.0.0:8000->8000/tcp', project: '', running: true },
  { id: 'd2e4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f2a4b6c8d0e2f4a6b8c0d2e4', name: 'postgres', image: 'postgres:16-alpine', state: 'exited', status: 'Exited (0) 6 hours ago', ports: '5432/tcp', project: 'crm', running: false },
  { id: 'f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f2a4b6c8d0e2f4a6b8c0d2e4f6a8', name: 'nginx-gateway', image: 'nginx:1.27-alpine', state: 'exited', status: 'Exited (137) 3 days ago', ports: '0.0.0.0:8080->80/tcp', project: '', running: false },
];

const STATUS = {
  timestamp: new Date('2026-09-20T12:40:00+08:00').toISOString(),
  host: 'DESKTOP-7K2M9Q',
  distro: 'Ubuntu',
  ubuntu: {
    running: true, systemd: true, ip: '172.24.16.88',
    memoryUsedMb: 2472, memoryTotalMb: 7942, cpuPercent: 14.6,
    uptimeSec: 231480, diskUsedMb: 96418, diskTotalMb: 262144,
  },
  services: { list: [{ key: 'docker', name: 'Docker', state: 'active' }, { key: 'postgresql', name: 'PostgreSQL', state: 'active' }] },
  docker: {
    running: true, version: '27.3.1', runningContainers: 4, totalContainers: 6,
    df: [
      { Type: 'Images', Total: 14, Size: '3.86GB' },
      { Type: 'Containers', Total: 6, Size: '92.4MB' },
      { Type: 'Local Volumes', Total: 5, Size: '1.31GB' },
      { Type: 'Build Cache', Total: 0, Size: '0B' },
    ],
  },
  containers: CONTAINERS,
};

const ACTIVITY = [
  { at: '2026-09-20T12:31:08+08:00', action: 'restart', target: 'halo', success: true, message: 'halo' },
  { at: '2026-09-20T12:18:44+08:00', action: 'install', target: 'store uptime-kuma', success: true, message: 'v1.23.16 部署完成' },
  { at: '2026-09-20T11:52:19+08:00', action: 'save', target: '/home/dev/compose/blog/compose.yaml', success: true, message: '文件已保存' },
  { at: '2026-09-20T11:40:02+08:00', action: 'download', target: 'docker.1ms.run/redis:7.4-alpine', success: true, message: '镜像拉取完成' },
  { at: '2026-09-20T11:12:37+08:00', action: 'start', target: 'Ubuntu', success: true, message: 'Ubuntu 与 Docker 已启动' },
  { at: '2026-09-20T10:58:51+08:00', action: 'delete', target: 'image 4a2c9f1e8b0d', success: true, message: 'Deleted: sha256:4a2c9f1e8b0d' },
  { at: '2026-09-20T10:44:23+08:00', action: 'prune', target: '悬空镜像', success: true, message: 'Total reclaimed space: 1.284GB' },
  { at: '2026-09-20T10:20:11+08:00', action: 'upload', target: '/home/dev/compose/crm/.env', success: true, message: '.env（1.2 KB）' },
  { at: '2026-09-20T09:58:06+08:00', action: 'stop', target: 'nginx-gateway', success: true, message: 'nginx-gateway' },
  { at: '2026-09-20T09:31:47+08:00', action: 'error', target: '/api/containers/legacy-app/start', success: false, message: '容器不存在' },
  { at: '2026-09-20T09:02:15+08:00', action: 'exec', target: 'mysql', success: true, message: 'mysqladmin status' },
  { at: '2026-09-20T08:47:33+08:00', action: 'save', target: 'AI 设置', success: true, message: '已保存（deepseek-chat）' },
];

const IMAGES = [
  { id: '4a2c9f1e8b0d', repository: 'mysql', tag: '8.4', size: '612MB', createdSince: '3 weeks ago' },
  { id: '7d1e3b5a9c2f', repository: 'redis', tag: '7.4-alpine', size: '41.2MB', createdSince: '2 weeks ago' },
  { id: 'b8f0c2e4a6d8', repository: 'halohub/halo', tag: '2.20', size: '398MB', createdSince: '5 days ago' },
  { id: '2c4e6a8b0d1f', repository: 'postgres', tag: '16-alpine', size: '271MB', createdSince: '6 weeks ago' },
  { id: 'e0a2c4e6f8b1', repository: 'nginx', tag: '1.27-alpine', size: '48.9MB', createdSince: '2 months ago' },
  { id: '5f7b9d1e3a5c', repository: 'portainer/portainer-ce', tag: '2.21.5', size: '196MB', createdSince: '1 month ago' },
  { id: '1a3c5e7f9b2d', repository: 'louislam/uptime-kuma', tag: '1.23.16', size: '243MB', createdSince: '9 days ago' },
  { id: '8b0d2f4a6c8e', repository: 'docker.1ms.run/mysql', tag: '8.0', size: '584MB', createdSince: '2 months ago' },
  { id: '3d5f7a9b1c3e', repository: '<none>', tag: '<none>', size: '184MB', createdSince: '3 weeks ago' },
  { id: 'c6e8a0b2d4f6', repository: '<none>', tag: '<none>', size: '92.7MB', createdSince: '5 weeks ago' },
];

const VOLUMES = [
  { name: 'blog_mysql-data', driver: 'local', links: '1', size: '842MB' },
  { name: 'blog_redis-data', driver: 'local', links: '1', size: '12.4MB' },
  { name: 'halo_data', driver: 'local', links: '1', size: '418MB' },
  { name: 'crm_pgdata', driver: 'local', links: '0', size: '61.8MB' },
  { name: 'uptime-kuma_data', driver: 'local', links: '1', size: '3.9MB' },
];

const COMPOSE_DIR = '/home/dev/compose';
const COMPOSE_PROJECTS = [
  { name: 'blog', file: 'compose.yaml' },
  { name: 'crm', file: 'docker-compose.yml' },
  { name: 'halo', file: 'compose.yaml' },
  { name: 'uptime-kuma', file: 'compose.yaml' },
];

const COMPOSE_FILE_TEXT = `services:
  mysql:
    image: docker.1ms.run/mysql:8.4
    container_name: mysql
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: \${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: blog
    volumes:
      - mysql-data:/var/lib/mysql
    ports:
      - "3306:3306"
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1"]
      interval: 10s
      retries: 6

  redis:
    image: docker.1ms.run/redis:7.4-alpine
    container_name: redis
    restart: unless-stopped
    command: redis-server --appendonly yes
    volumes:
      - redis-data:/data
    ports:
      - "6379:6379"

volumes:
  mysql-data:
  redis-data:
`;

const COMPOSE_LOGS = `redis   | 1:M 20 Sep 2026 12:28:04.117 * Background saving terminated with success
mysql   | 2026-09-20T12:28:11.402418Z 0 [System] [MY-010931] [Server] ready for connections. Version: '8.4.2'
mysql   | 2026-09-20T12:28:11.402551Z 0 [System] [MY-011323] [Server] X Plugin ready for connections.
redis   | 1:M 20 Sep 2026 12:29:00.006 * 100 changes in 300 seconds. Saving...
redis   | 1:M 20 Sep 2026 12:29:00.018 * Background saving started by pid 42
mysql   | 2026-09-20T12:30:02.771203Z 0 [Note] [MY-013172] [Server] Received SHUTDOWN from user root.
redis   | 1:M 20 Sep 2026 12:29:00.114 * RDB: 0 MB of memory used by copy-on-write
redis   | 1:M 20 Sep 2026 12:29:00.121 * Background saving terminated with success`;

const CONTAINER_LOGS = `2026-09-20T12:28:04.117842Z * Running mode=standalone, port=6379.
2026-09-20T12:28:04.118001Z # Server initialized
2026-09-20T12:28:04.120933Z * Ready to accept connections tcp
2026-09-20T12:29:00.006114Z * 100 changes in 300 seconds. Saving...
2026-09-20T12:29:00.018220Z * Background saving started by pid 42
2026-09-20T12:29:00.114007Z * RDB: 0 MB of memory used by copy-on-write
2026-09-20T12:29:00.121883Z * Background saving terminated with success
2026-09-20T12:31:44.556201Z * 1 changes in 900 seconds. Saving...`;

const STORE_APPS = [
  { id: 'mysql', name: 'MySQL', title: '最流行的开源关系型数据库', description: 'MySQL 是使用最广泛的开源关系型数据库管理系统之一，性能稳定、生态完善。', tags: ['数据库'], type: 'database', website: 'https://www.mysql.com', github: 'https://github.com/mysql/mysql-server', document: 'https://dev.mysql.com/doc/', color: '#00758F' },
  { id: 'redis', name: 'Redis', title: '高性能内存键值数据库', description: 'Redis 是一个开源的内存数据结构存储，可用作数据库、缓存与消息代理。', tags: ['数据库', '缓存'], type: 'database', website: 'https://redis.io', github: 'https://github.com/redis/redis', document: 'https://redis.io/docs/', color: '#D82C20' },
  { id: 'postgresql', name: 'PostgreSQL', title: '功能强大的开源对象关系数据库', description: 'PostgreSQL 支持复杂查询、外键、触发器与事务完整性，扩展性极强。', tags: ['数据库'], type: 'database', website: 'https://www.postgresql.org', github: 'https://github.com/postgres/postgres', document: 'https://www.postgresql.org/docs/', color: '#336791' },
  { id: 'halo', name: 'Halo', title: '强大易用的开源建站工具', description: 'Halo 是一款现代化的开源博客与 CMS 系统，插件生态丰富。', tags: ['网站', 'CMS'], type: 'website', website: 'https://halo.run', github: 'https://github.com/halo-dev/halo', document: 'https://docs.halo.run', color: '#4B5CC4' },
  { id: 'uptime-kuma', name: 'Uptime Kuma', title: '自托管的 uptime 监控面板', description: 'Uptime Kuma 是一款开源自托管监控工具，支持 HTTP、TCP、Ping 等多种探活方式。', tags: ['监控', '工具'], type: 'tool', website: 'https://uptime.kuma.pet', github: 'https://github.com/louislam/uptime-kuma', document: 'https://github.com/louislam/uptime-kuma/wiki', color: '#5CDD8B' },
  { id: 'minio', name: 'MinIO', title: '高性能 S3 兼容对象存储', description: 'MinIO 提供与 Amazon S3 兼容的对象存储服务，适合私有化部署。', tags: ['存储'], type: 'storage', website: 'https://min.io', github: 'https://github.com/minio/minio', document: 'https://min.io/docs', color: '#C72C48' },
  { id: 'gitea', name: 'Gitea', title: '轻量级自托管 Git 服务', description: 'Gitea 是一个社区驱动的轻量级代码托管平台，资源占用低。', tags: ['开发工具'], type: 'tool', website: 'https://gitea.com', github: 'https://github.com/go-gitea/gitea', document: 'https://docs.gitea.com', color: '#609926' },
  { id: 'n8n', name: 'n8n', title: '可扩展的工作流自动化平台', description: 'n8n 支持可视化编排数百种服务，实现自动化流程。', tags: ['自动化'], type: 'tool', website: 'https://n8n.io', github: 'https://github.com/n8n-io/n8n', document: 'https://docs.n8n.io', color: '#EA4B71' },
  { id: 'wordpress', name: 'WordPress', title: '全球使用最广的内容管理系统', description: 'WordPress 拥有海量主题与插件，适合快速搭建站点。', tags: ['网站', 'CMS'], type: 'website', website: 'https://wordpress.org', github: 'https://github.com/WordPress/WordPress', document: 'https://wordpress.org/documentation/', color: '#21759B' },
  { id: 'alist', name: 'AList', title: '支持多存储的文件列表程序', description: 'AList 支持本地存储与多家网盘挂载，统一 Web 浏览体验。', tags: ['存储'], type: 'storage', website: 'https://alist.nn.ci', github: 'https://github.com/alist-org/alist', document: 'https://alist.nn.ci/zh/guide/', color: '#70C0E8' },
  { id: 'frp', name: 'frp', title: '内网穿透反向代理工具', description: 'frp 是一个专注于内网穿透的高性能反向代理应用。', tags: ['网络'], type: 'tool', website: 'https://gofrp.org', github: 'https://github.com/fatedier/frp', document: 'https://gofrp.org/docs/', color: '#3B7DD8' },
  { id: 'clickhouse', name: 'ClickHouse', title: '列式存储的实时分析数据库', description: 'ClickHouse 面向在线分析处理，查询性能优异。', tags: ['数据库', '分析'], type: 'database', website: 'https://clickhouse.com', github: 'https://github.com/ClickHouse/ClickHouse', document: 'https://clickhouse.com/docs', color: '#FFCC01' },
];

const STORE_FORM_FIELDS = [
  { envKey: 'PANEL_APP_PORT_HTTP', label: '端口', default: '3306', required: true, type: 'number', rule: 'paramPort' },
  { envKey: 'PANEL_DB_ROOT_PASSWORD', label: 'root 密码', default: 'wpanel123', required: true, type: 'text', rule: 'paramPassword' },
  { envKey: 'PANEL_DB_NAME', label: '数据库名', default: 'blog', required: false, type: 'text', rule: '' },
];

const FILE_TREE = {
  '/home': [
    { name: 'dev', type: 'dir', linkDir: false, size: 4096, mtime: Date.parse('2026-09-20T11:52:19+08:00') },
    { name: 'docker', type: 'dir', linkDir: false, size: 4096, mtime: Date.parse('2026-09-14T18:03:00+08:00') },
    { name: 'ubuntu', type: 'dir', linkDir: false, size: 4096, mtime: Date.parse('2026-06-02T08:15:00+08:00') },
  ],
  '/home/dev': [
    { name: 'compose', type: 'dir', linkDir: false, size: 4096, mtime: Date.parse('2026-09-20T11:52:19+08:00') },
    { name: 'projects', type: 'dir', linkDir: false, size: 4096, mtime: Date.parse('2026-09-18T09:12:00+08:00') },
    { name: 'backups', type: 'dir', linkDir: false, size: 4096, mtime: Date.parse('2026-09-15T22:04:00+08:00') },
    { name: 'current', type: 'link', linkDir: true, size: 0, mtime: Date.parse('2026-09-20T10:00:00+08:00') },
    { name: 'deploy.sh', type: 'file', linkDir: false, size: 3128, mtime: Date.parse('2026-09-19T16:41:00+08:00') },
    { name: 'notes.md', type: 'file', linkDir: false, size: 7420, mtime: Date.parse('2026-09-17T21:30:00+08:00') },
    { name: 'mysql-backup-20260919.sql', type: 'file', linkDir: false, size: 18432000, mtime: Date.parse('2026-09-19T03:00:00+08:00') },
    { name: 'topology.png', type: 'file', linkDir: false, size: 268430, mtime: Date.parse('2026-09-12T14:22:00+08:00') },
    { name: '.bashrc', type: 'file', linkDir: false, size: 3771, mtime: Date.parse('2026-06-02T08:15:00+08:00') },
  ],
};

const SAMPLE_TEXT = `#!/usr/bin/env bash
# 一键部署 blog 编排栈：拉取镜像 → 启动服务 → 健康检查
set -euo pipefail

cd "$(dirname "$0")"

echo "==> 拉取镜像"
docker compose pull

echo "==> 启动服务"
docker compose up -d

echo "==> 等待健康检查"
until [ "$(docker inspect -f '{{.State.Health.Status}}' mysql)" = "healthy" ]; do
  sleep 2
done

echo "==> 完成，访问 http://localhost:8090"
`;

const INSPECT = {
  name: 'mysql',
  image: 'mysql:8.4',
  status: 'running',
  startedAt: '2026-09-18T09:14:22+08:00',
  restartCount: 0,
  restartPolicy: 'unless-stopped',
  ports: ['0.0.0.0:3306 → 3306/tcp'],
  mounts: ['blog_mysql-data → /var/lib/mysql (rw)', '/etc/localtime → /etc/localtime (ro)'],
  networks: ['blog_default'],
  env: ['MYSQL_ROOT_PASSWORD=******', 'MYSQL_DATABASE=blog', 'TZ=Asia/Shanghai'],
};

function svgLogo(name, color) {
  const letter = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 1).toUpperCase() || 'A';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <rect width="96" height="96" rx="22" fill="${color}"/>
  <text x="48" y="62" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="44" font-weight="600" fill="#ffffff" text-anchor="middle">${letter}</text>
</svg>`;
}

// 截图用本地演示服务：放开 CORS，便于任意端口的预览前端直连
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-WPanel-Token', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

function send(response, status, body) {
  response.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${HOST}:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  if (request.method === 'OPTIONS') { response.writeHead(204, CORS); return response.end(); }

  if (pathname === '/api/session') return send(response, 200, { token: TOKEN });
  if (pathname === '/api/status') return send(response, 200, STATUS);

  if (pathname === '/api/activity') {
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize')) || 30));
    const keyword = (url.searchParams.get('search') || '').trim().toLowerCase();
    const filtered = keyword ? ACTIVITY.filter((item) => `${item.action} ${item.target} ${item.message}`.toLowerCase().includes(keyword)) : ACTIVITY;
    const start = (page - 1) * pageSize;
    return send(response, 200, { total: filtered.length, page, pageSize, items: filtered.slice(start, start + pageSize) });
  }

  if (pathname === '/api/images') return send(response, 200, { images: IMAGES });
  if (pathname === '/api/volumes') return send(response, 200, { volumes: VOLUMES });
  if (pathname === '/api/compose/projects') return send(response, 200, { dir: COMPOSE_DIR, projects: COMPOSE_PROJECTS });
  if (pathname === '/api/compose/logs') return send(response, 200, { name: url.searchParams.get('project') || '', logs: COMPOSE_LOGS });
  if (pathname === '/api/ai/settings') return send(response, 200, { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', hasKey: true });

  if (pathname === '/api/store/apps') {
    return send(response, 200, { source: 'https://github.com/1Panel-dev/appstore@main', mirror: 'docker.1ms.run', apps: STORE_APPS });
  }
  if (pathname.startsWith('/api/store/app/')) {
    const id = pathname.slice('/api/store/app/'.length);
    const meta = STORE_APPS.find((item) => item.id === id) || STORE_APPS[0];
    const detail = { ...meta };
    delete detail.color; // color 只用于生成演示 logo，不返回给前端
    return send(response, 200, { ...detail, version: '8.4.2', formFields: STORE_FORM_FIELDS, mirror: 'docker.1ms.run' });
  }
  if (pathname.startsWith('/api/store/logo/')) {
    const id = pathname.slice('/api/store/logo/'.length);
    const meta = STORE_APPS.find((item) => item.id === id);
    if (!meta) { response.writeHead(404, CORS); return response.end(); }
    response.writeHead(200, { ...CORS, 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=86400' });
    return response.end(svgLogo(meta.name, meta.color));
  }
  if (pathname === '/api/store/render') {
    await readBody(request);
    return send(response, 200, {
      compose: COMPOSE_FILE_TEXT,
      env: 'CONTAINER_NAME=mysql\nPANEL_APP_PORT_HTTP=3306\nPANEL_DB_ROOT_PASSWORD=wpanel123\nPANEL_DB_NAME=blog\n',
      mirror: 'docker.1ms.run',
    });
  }

  if (pathname === '/api/files/list') {
    const target = url.searchParams.get('path') || '/home/dev';
    const entries = FILE_TREE[target] || [];
    return send(response, 200, { path: target, roots: ['/home'], entries });
  }
  if (pathname === '/api/files/read') {
    const target = url.searchParams.get('path') || '/home/dev/deploy.sh';
    return send(response, 200, { path: target, name: target.split('/').pop(), size: SAMPLE_TEXT.length, mtime: Date.parse('2026-09-19T16:41:00+08:00'), content: SAMPLE_TEXT });
  }

  const inspectMatch = pathname.match(/^\/api\/containers\/([^/]+)\/inspect$/);
  if (inspectMatch) {
    const name = inspectMatch[1];
    const container = CONTAINERS.find((item) => item.name === name);
    return send(response, 200, { ...INSPECT, name, image: container?.image || INSPECT.image, status: container?.running ? 'running' : 'exited' });
  }
  const logsMatch = pathname.match(/^\/api\/containers\/([^/]+)\/logs$/);
  if (logsMatch) return send(response, 200, { name: logsMatch[1], logs: CONTAINER_LOGS });

  if (pathname.startsWith('/api/store/job/')) return send(response, 200, { status: 'done', output: 'Container blog-mysql  Started\n[进程退出码 0]' });

  if (request.method === 'POST') {
    if (pathname === '/api/ai/diagnose') {
      return send(response, 200, { content: '根因：容器 mysql 在 12:30 收到 SHUTDOWN 指令后退出，退出码 0，属于正常停止而非崩溃。\n\n建议：\n1. 若为预期维护，直接 start 容器即可恢复；\n2. 若为异常退出，检查宿主机内存是否触发 OOM；\n3. 确认 restart 策略为 unless-stopped，避免下次重启后不再拉起。' });
    }
    if (pathname === '/api/ai/plan') {
      return send(response, 200, { actions: [{ action: 'restart', target: 'redis' }, { action: 'start', target: 'postgres' }] });
    }
    if (pathname === '/api/ai/generate-compose') {
      return send(response, 200, { content: COMPOSE_FILE_TEXT });
    }
    return send(response, 200, { ok: true, activity: { at: new Date().toISOString(), action: 'demo', target: pathname, success: true, message: '演示模式：未执行真实操作' } });
  }

  return send(response, 404, { error: '未找到接口（截图模拟服务）' });
});

server.listen(PORT, HOST, () => {
  console.log(`WPanel mock API listening on http://${HOST}:${PORT}`);
});
