# WPanel Wiki

> **WSL2 与 Docker 的本机驾驶舱** —— 运行在 Windows 侧，通过 `wsl.exe` 与 `\\wsl.localhost` 管理 WSL2 发行版、发行版内的原生 Docker Engine 与文件系统，**无需在 Linux 中安装任何 agent**。

![总览](https://raw.githubusercontent.com/myyyisbest/wpanel/main/docs/screenshots/overview-light.png)

## 从这里开始

| 页面 | 内容 |
|---|---|
| [安装指南](安装指南) | **先装 WSL2，再装 Docker，最后装 WPanel** —— 含排错表 |
| [功能手册](功能手册) | 总览 / 容器 / 日志 / 镜像与卷 / Compose / 应用商店 / 文件管理 / AI 助手 / 日志记录 |
| [配置参考](配置参考) | 全部环境变量、`data/wpanel.local.json`、端口与来源白名单 |
| [安全模型](安全模型) | 它为什么是安全的，以及它的边界在哪里 |
| [常见问题](常见问题) | 启动失败、发行版名不匹配、权限不足、商店拉取失败等 |
| [开发指南](开发指南) | 本地开发、构建、截图流水线、CI |

## 30 秒了解它是什么

- **面向谁**：Windows 11 + WSL2 + **原生 `dockerd`**（systemd 托管）的用户。
- **不面向谁**：Docker Desktop 用户、多主机 / 远程管理场景。
- **它做什么**：给「WSL2 + 原生 Docker」补一个本机 Web 面板 —— WSL 启停、容器运维、Compose 编排、应用商店、主机文件管理、操作审计，以及一个只提建议不动手的 AI 副驾驶。
- **它不做什么**：域名转发、多机管理、容器内文件管理、公网远程访问。

## 最小上手路径

```powershell
# 1) Windows 侧：装好 WSL2（当前版本 Ubuntu 默认已启用 systemd）
wsl --install
wsl --set-default-version 2
wsl --list --verbose

# 2) 发行版内：装原生 Docker Engine（不是 Docker Desktop）
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker.service

# 3) Windows 侧：装 WPanel
git clone https://github.com/myyyisbest/wpanel.git
cd wpanel
npm install
npm run build
.\启动WPanel.bat
```

打开 <http://localhost:8765>。详细步骤与排错见 [安装指南](安装指南)。

## 架构一图

```
浏览器 ── http://localhost:8765 ──▶ 前端（vinext / Next.js 16 + React 19）
                                        │ X-WPanel-Token
                                        ▼
                          控制服务 server.mjs（127.0.0.1:8766）
                            │                    │
                    wsl.exe │                    │ \\wsl.localhost\Ubuntu\...
                            ▼                    ▼
                    WSL2 发行版：systemd ─ docker.service ─ 容器 / 镜像 / 卷 / 文件系统
```

控制服务承担全部特权操作，前端是纯展示层，所有动作都打到控制服务，**后端只有固定白名单命令，没有任意命令执行接口**。
