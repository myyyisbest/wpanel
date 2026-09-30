# WPanel

> **WSL2 与 Docker 的本机驾驶舱** —— 为 Windows 而生的轻量管理面板：WSL 生命周期、容器编排、应用商店、零 agent 文件管理，以及只提建议、不碰键盘的 AI 副驾驶。

[![CI](https://github.com/myyyisbest/wpanel/actions/workflows/ci.yml/badge.svg)](https://github.com/myyyisbest/wpanel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%2011-0078D4)
![Node](https://img.shields.io/badge/node-%E2%89%A522.13-339933)

WPanel 运行在 **Windows 侧**，通过 `wsl.exe` 与 `\\wsl.localhost` 直接管理 WSL2 发行版、发行版内的原生 Docker Engine 与文件系统 —— **不需要在 Linux 里安装任何 agent 组件**。

> **适用**：Windows 11 + WSL2 + 发行版内原生 `dockerd`（systemd 托管）+ Node.js ≥ 22.13
> **不适用**：Docker Desktop 用户、多主机/远程管理场景

![总览](docs/screenshots/overview-light.png)

---

## 目录

- [它解决什么问题](#它解决什么问题)
- [快速开始](#快速开始)
  - [第 0 步：前置检查](#第-0-步前置检查)
  - [第 1 步：在 Windows 上装好 WSL2](#第-1-步在-windows-上装好-wsl2)
  - [第 2 步：确认发行版启用了 systemd](#第-2-步确认发行版启用了-systemd)
  - [第 3 步：在发行版里安装原生 Docker Engine](#第-3-步在发行版里安装原生-docker-engine)
  - [第 4 步：安装 Node.js（Windows 侧）](#第-4-步安装-nodejswindows-侧)
  - [第 5 步：安装并启动 WPanel](#第-5-步安装并启动-wpanel)
  - [可选：开机自启](#可选开机自启)
  - [安装排错](#安装排错)
- [功能](#功能)
- [安全模型](#安全模型)
- [配置](#配置)
- [架构](#架构)
- [开发](#开发)
- [Roadmap](#roadmap)
- [致谢](#致谢)
- [License](#license)

## 文档

本 README 覆盖安装与功能概览。更细的内容在 **[Wiki](https://github.com/myyyisbest/wpanel/wiki)**：

| 页面 | 内容 |
|---|---|
| [安装指南](https://github.com/myyyisbest/wpanel/wiki/安装指南) | WSL2 → systemd → Docker Engine → Node → WPanel 的完整步骤与排错表 |
| [功能手册](https://github.com/myyyisbest/wpanel/wiki/功能手册) | 八个页面逐一说明，含各项限制 |
| [配置参考](https://github.com/myyyisbest/wpanel/wiki/配置参考) | 全部环境变量、`data/*.json`、运行时文件 |
| [安全模型](https://github.com/myyyisbest/wpanel/wiki/安全模型) | 做了什么防护，边界在哪里 |
| [常见问题](https://github.com/myyyisbest/wpanel/wiki/常见问题) | 启动、WSL、文件管理、商店、AI 各类问题 |
| [开发指南](https://github.com/myyyisbest/wpanel/wiki/开发指南) | 目录结构、代码约定、截图流水线、CI |

> Wiki 页面的源文件在 [`docs/wiki/`](docs/wiki/)，随主仓库一起评审；用 `tools/publish-wiki.ps1` 发布。

---

## 它解决什么问题

在 Windows 上跑 Docker，通常有两条路：Docker Desktop（重、要授权、WSL 与 Docker 是两套割裂的体验），或者自己开终端敲 `wsl` + `docker` 命令。WPanel 面向后者：**给「WSL2 + 原生 dockerd」这套组合补一个本机 Web 面板**，让日常运维不用记命令。

| | 说明 |
|---|---|
| **比 DPanel 多** | WSL2 生命周期管理（启动 / 安全关闭）、主机（WSL）文件管理、systemd 服务控制、文件直读零 agent |
| **对齐 DPanel** | 容器生命周期、实时日志、镜像 / 卷管理、Compose 编排、应用商店 |
| **明确不做** | 域名转发、多机管理、容器内文件管理（DPanel 已做得很好）、公网远程访问 |
| **不适用** | Docker Desktop 用户（WPanel 依赖发行版内的原生 `dockerd` + systemd） |

---

## 快速开始

> 下面的顺序不是随意的：**WSL2 是本项目的地基**。WPanel 的每一项能力 —— 容器、Compose、应用商店、文件管理 —— 都建立在「Windows 能访问一个启用了 systemd 的 WSL2 发行版，且发行版里有原生 Docker」这个前提之上。地基没打好，面板只会显示「Ubuntu 未运行」。

### 第 0 步：前置检查

以**管理员身份**打开 PowerShell，确认 WSL 已安装且版本足够新：

```powershell
wsl --version
```

预期输出包含 `WSL 版本: 2.x.x`。若提示 `Invalid command line option: --version`，说明 WSL 过旧，先升级：

```powershell
wsl --update
```

> **系统要求**：Windows 11（22H2 及以上）。Windows 10 需要 2004+ 且手动启用虚拟机平台，本文以 Windows 11 为准。

### 第 1 步：在 Windows 上装好 WSL2

**1.1 一键安装（推荐）**

在管理员 PowerShell 中执行：

```powershell
wsl --install
```

这条命令会依次完成：启用「适用于 Linux 的 Windows 子系统」与「虚拟机平台」两个可选功能 → 下载安装 WSL2 内核 → 安装默认的 Ubuntu 发行版 → 提示重启。

**重启 Windows** 后，Ubuntu 会自动启动并要求设置 **UNIX 用户名**与**密码**（这个账号就是 WPanel 文件管理所使用的身份，请记牢）。

**1.2 指定发行版（可选）**

```powershell
# 查看可安装的发行版
wsl --list --online

# 安装指定版本（WPanel 默认按发行版名匹配，默认值 Ubuntu）
wsl --install -d Ubuntu-24.04
```

**1.3 确认 WSL2 与默认发行版**

```powershell
wsl --set-default-version 2      # 新装发行版一律使用 WSL2
wsl --list --verbose             # 确认 VERSION 列为 2，且目标发行版带 * 号（默认发行版）
```

WPanel 默认连接名为 `Ubuntu` 的发行版。如果你的发行版叫别的名字（如 `Ubuntu-24.04`），后面用环境变量 `WPANEL_DISTRO` 指定即可，**不必改名**。

**1.4 换国内镜像源（可选，但强烈建议）**

Ubuntu 官方源在国内速度较差，首次 `apt update` 可能非常慢：

```bash
# 在 Ubuntu 终端内执行
sudo cp /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list.d/ubuntu.sources.bak
sudo sed -i 's|http://archive.ubuntu.com|https://mirrors.tuna.tsinghua.edu.cn|g; s|http://security.ubuntu.com|https://mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/ubuntu.sources
sudo apt update && sudo apt upgrade -y
```

> Ubuntu 24.04 起源文件为 `ubuntu.sources`（deb822 格式）；22.04 为 `/etc/apt/sources.list`，把路径换成它即可。

### 第 2 步：确认发行版启用了 systemd

WPanel 通过 `systemctl` 启停 `docker.service`，**systemd 必须可用**。

- **用 `wsl --install` 安装的当前版本 Ubuntu，systemd 默认已启用**，通常无需额外配置。
- 其他发行版、或较旧的镜像仍使用 WSL init，需要手动开启。

**2.1 检查**

```bash
systemctl is-system-running     # 输出 running / degraded 即为已启用
```

若报 `System has not been booted with systemd as init system`，按下面开启：

```bash
sudo tee /etc/wsl.conf > /dev/null <<'EOF'
[boot]
systemd=true
EOF
```

然后在 **PowerShell** 中彻底重启 WSL：

```powershell
wsl --shutdown
```

重新进入发行版后再次验证：

```bash
systemctl is-system-running
systemctl list-unit-files --type=service | head
```

> 若发行版缺少 systemd 包（Debian/Ubuntu/Kali 一般已内置）：
> `sudo apt-get update && sudo apt-get install -y systemd systemd-sysv`

### 第 3 步：在发行版里安装原生 Docker Engine

> **注意**：这里装的是 **Docker Engine（docker-ce）**，不是 Docker Desktop。WPanel 需要发行版内以 systemd 托管的原生 `dockerd`。

**3.1 卸载可能冲突的非官方包**

```bash
sudo apt remove $(dpkg --get-selections docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc | cut -f1)
```

提示「没有这些包」属正常，忽略即可。

**3.2 添加 Docker 官方 apt 仓库**

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
```

**3.3 安装并启动**

```bash
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker.service
sudo systemctl status docker --no-pager
```

**3.4 验证**

```bash
sudo docker run --rm hello-world
```

看到 `Hello from Docker!` 即成功。

**3.5 允许当前用户免 sudo 使用 docker（可选）**

WPanel 自身的操作以 root 身份执行，**不依赖**这一步；但你在终端里手敲 `docker` 会方便很多：

```bash
sudo usermod -aG docker $USER
```

执行后需要 `wsl --shutdown` 重新进入发行版才生效。

### 第 4 步：安装 Node.js（Windows 侧）

WPanel 的前端与控制服务都跑在 **Windows 上**，需要 **Node.js ≥ 22.13**：

```powershell
winget install OpenJS.NodeJS.LTS
```

或从 [nodejs.org](https://nodejs.org/) 下载 LTS 安装包。安装完成后**新开一个** PowerShell 窗口验证：

```powershell
node -v      # 应输出 v22.13.0 或更高
npm -v
```

启动脚本**无需额外安装 PowerShell**：四个 `.bat` 会优先调用 PowerShell 7（`pwsh.exe`），找不到时自动回退到 Windows 自带的 PowerShell 5.1（`powershell.exe`）。若你偏好 PowerShell 7：

```powershell
winget install Microsoft.PowerShell
```

### 第 5 步：安装并启动 WPanel

```powershell
git clone https://github.com/myyyisbest/wpanel.git
cd wpanel
npm install
npm run build

.\启动WPanel.bat          # 启动并自动打开 http://localhost:8765
.\停止WPanel.bat          # 停止面板（不影响 WSL / Docker / 容器）
```

首次打开页面后，如果 Ubuntu 尚未运行，在「总览」页点 **启动 Ubuntu** 即可。

**常用脚本一览**

| 脚本 | 作用 |
|---|---|
| `启动WPanel.bat` | 后台拉起控制服务（8766）与前端（8765），等待就绪后打开浏览器 |
| `停止WPanel.bat` | 只结束 WPanel 自己的进程，不碰 WSL、Docker 和容器 |
| `安装开机自启.bat` | 登录 Windows 后后台静默自启（优先注册计划任务，无管理员权限时回退到启动文件夹） |
| `卸载开机自启.bat` | 移除上面两种自启方式 |

### 可选：开机自启

```powershell
.\安装开机自启.bat        # 建议以管理员身份运行，可直接注册计划任务
.\卸载开机自启.bat
```

### 安装排错

| 现象 | 原因与处理 |
|---|---|
| 页面提示「无法连接 Windows 控制服务」 | 控制服务未启动或端口被占用。运行 `启动WPanel.bat`，或查看 `logs/controller.err.log` |
| 总览显示「Ubuntu 未运行」 | 发行版没起来。执行 `wsl -d Ubuntu -- true` 或在面板点「启动 Ubuntu」 |
| 总览显示「systemd 未启用」 | 回到[第 2 步](#第-2-步确认发行版启用了-systemd) |
| Docker 卡片显示「未运行」 | `wsl -d Ubuntu -u root -- systemctl status docker` 查看；必要时 `systemctl enable --now docker.service` |
| 发行版名不是 `Ubuntu` | 设置 `WPANEL_DISTRO` 环境变量，或在 `启动WPanel.bat` 之前 `set WPANEL_DISTRO=Ubuntu-24.04` |
| 文件管理里 `/home` 打不开或权限不足 | 确认发行版已启动；WPanel 以发行版**默认用户**身份访问文件共享，`/root`、`/etc` 等 root 属地不可操作 |
| 提示「端口 8766 已被占用」 | 关闭占用进程，或设置 `WPANEL_PORT` 换端口（同时需用 `NEXT_PUBLIC_WPANEL_API` 重新构建前端） |
| `启动WPanel.bat` 报找不到 PowerShell | `pwsh.exe` 与 `powershell.exe` 都不在 PATH。后者随系统自带（位于 `%SystemRoot%\System32\WindowsPowerShell\v1.0\`），请检查 PATH 是否被裁剪 |
| 提示「依赖尚未安装 / 生产版本尚未构建」 | 依次执行 `npm install` 与 `npm run build` |

---

## 功能

### 总览

Ubuntu / Docker 运行状态、内存与 CPU（最近 5 分钟本机采样趋势）、WSL 根分区磁盘用量、运行时长、systemd 关键服务（可配置、可一键启停）、Docker 磁盘占用（镜像 / 容器 / 卷 / 构建缓存），以及最近操作。顶部提供 **启动 Ubuntu**、**安全关闭 WSL**、**停止 Docker** 三个总控动作。

![总览](docs/screenshots/overview-light.png)

### 容器

卡片 / 列表双视图，支持按名称搜索。每个容器提供启动、停止、重启、查看日志、删除；运行中的容器可进入**命令盒**（实验性，见[安全模型](#安全模型)）。端口徽章可直接跳到 `localhost:<端口>`。带 `com.docker.compose.project` 标签的容器会自动按 Compose 项目分组展示。

卡片视图（状态与端口一目了然）：

![容器卡片视图](docs/screenshots/containers-cards-light.png)

列表视图（信息密度更高，容器较多时便于扫视）：

![容器列表视图](docs/screenshots/containers-list-light.png)

### 实时日志

SSE 流式跟随 `docker logs -f`，可在 100 / 250 / 1000 行之间切换，支持一键复制全文；连接断开自动结束子进程。

![容器日志](docs/screenshots/container-logs-light.png)

### 镜像与卷

镜像列表（ID / 大小 / 创建时间）、单条删除、**导出为 tar**、**导入 tar**（上限 2GB）、清理悬空镜像与未使用镜像；卷列表（驱动 / 被引用数 / 占用大小）、删除、清理未使用卷。手动拉取镜像时自动套用应用商店的镜像加速站设置。

![镜像与卷](docs/screenshots/images-volumes-light.png)

### Compose 编排

自动扫描编排目录（默认 `~/compose`）下的 Compose 项目，逐项展示容器运行数，支持 `up -d` / `down`（可选连带删除卷）/ 日志查看 / **在线编辑 compose 文件** / 删除项目（含文件夹，双重确认）。也支持手动新建项目。

![Compose 编排](docs/screenshots/compose-light.png)

### 应用商店

默认内置 [1Panel 官方商店源](https://github.com/1Panel-dev/appstore)，兼容其模板格式（**自动忽略模板中的脚本类字段，只取 compose 与变量定义**）。支持自定义模板源与分支、可配置 Docker 镜像加速站。流程是：选应用 → 填参数 → **预览最终 compose 与 .env** → 后台一键部署，安装日志实时输出。

![应用商店](docs/screenshots/store-light.png)

![安装预览](docs/screenshots/store-install-light.png)

### 文件管理

通过 `\\wsl.localhost` 共享**直接读写 WSL 文件系统**，发行版内无需任何 agent。默认只开放 `/home`（可用 `WPANEL_ROOTS` 扩展）。支持目录浏览、在线编辑（≤1MB 文本）、上传（≤100MB）/ 下载、新建文件夹 / 文件、重命名、删除、图片预览。

![文件管理](docs/screenshots/files-light.png)

### AI 助手

自行配置任意 OpenAI 兼容接口（如 DeepSeek、OpenAI、本地 Ollama）即可使用三项能力：

1. **容器日志诊断** —— 拉取容器状态与最近 120 行日志，给出根因与处置建议；
2. **Compose 生成** —— 用自然语言描述需求，直接生成可用的 `compose.yaml`，可一键保存为编排项目；
3. **运维操作提议** —— 把「把停掉的 mage 容器重新启动」这类需求翻译成动作列表。

> **AI 只有建议权，没有执行权。** 所有动作都必须你逐条确认，才走白名单接口执行。

![AI 助手](docs/screenshots/ai-light.png)

### 日志记录

全部操作审计留痕（含失败操作），服务端分页（每页 30 条）与关键字搜索，日志文件超过 5MB 自动轮转。

![日志记录](docs/screenshots/activity-light.png)

### 主题

深色 / 浅色 / 跟随系统三态，选择记忆在浏览器本地。前面各节都是浅色截图，这里是同一套界面在深色下的表现：

| 总览 | 容器（卡片） |
|---|---|
| ![总览-深色](docs/screenshots/overview-dark.png) | ![容器卡片-深色](docs/screenshots/containers-cards-dark.png) |

| 容器（列表） | 实时日志 |
|---|---|
| ![容器列表-深色](docs/screenshots/containers-list-dark.png) | ![容器日志-深色](docs/screenshots/container-logs-dark.png) |

| 镜像与卷 | Compose 编排 |
|---|---|
| ![镜像与卷-深色](docs/screenshots/images-volumes-dark.png) | ![Compose 编排-深色](docs/screenshots/compose-dark.png) |

| 应用商店 | 安装预览 |
|---|---|
| ![应用商店-深色](docs/screenshots/store-dark.png) | ![安装预览-深色](docs/screenshots/store-install-dark.png) |

| 文件管理 | AI 助手 |
|---|---|
| ![文件管理-深色](docs/screenshots/files-dark.png) | ![AI 助手-深色](docs/screenshots/ai-dark.png) |

| 日志记录 | |
|---|---|
| ![日志记录-深色](docs/screenshots/activity-dark.png) | |

---

## 安全模型

WPanel 是一个**本机工具**，设计目标是「不把本机 Docker 的 root 权限暴露到网络上」。具体措施：

- **只监听 `127.0.0.1`**：控制服务不绑定任何外部网卡。
- **来源白名单**：浏览器请求需带受信任的 `Origin`（默认 `http://localhost:8765` / `http://127.0.0.1:8765`），否则 403。
- **Host 校验**：只接受 `127.0.0.1:8766` / `localhost:8766`，阻断 DNS rebinding 类读取。
- **会话令牌**：每次启动随机生成，所有变更操作与敏感读取都需要 `X-WPanel-Token`。
- **固定白名单命令**：后端不存在「任意命令执行」接口，所有 `wsl.exe` / `docker` 调用都是代码里写死的子命令 + 经过校验的参数。
- **文件接口双重防线**：根目录白名单（`WPANEL_ROOTS`）+ 路径标准化（拒绝 `..` 与反斜杠）构成词法层；再用 `realpath` 解析父目录（读/写时连目标一起解析）做规范化层复核，兜住词法层看不见的符号链接跳转。
- **危险操作二次确认**：删除镜像 / 卷、关闭 WSL、卸载应用、删除 Compose 项目等都需前端确认，且全部写入审计日志。
- **安全响应头**：`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`。
- **凭据本地存放**：AI 密钥存于 `data/ai.local.json`（不进 git，接口回显只返回「是否已配置」）。

**已知边界（请知悉）**

| 边界 | 说明 |
|---|---|
| 本地进程不受令牌约束 | 令牌用于防跨站请求伪造，不构成对本机其他程序的认证。能在这台机器上运行代码的程序，本就可以直接调用 `docker` —— 这不是 WPanel 引入的新风险，但请勿把面板端口转发到公网。 |
| 容器命令盒可执行任意命令 | 「命令盒」会在目标容器内以容器默认用户执行单条命令。它受会话令牌保护且仅本机可达，但**能力上等价于进入容器终端**，请在可信环境下使用。 |
| 商店模板来自第三方 | 默认模板源是 1Panel 官方仓库。WPanel 会忽略模板中的脚本字段，但 compose 内容本身仍来自上游，安装前建议先看「预览」。 |
| 符号链接在当前平台不可达 | Windows 侧经 UNC 共享访问 WSL 时**无法跟随 Linux 符号链接**：`/bin`、`/lib`、`/etc/os-release` 这类链接的读取一律返回 `ENOENT`，而同一目标的真实路径（如 `/usr/bin/bash`）读写正常。这使符号链接逃逸在底层就失败（保守拒绝），代价是**你无法在文件管理里通过链接进入目标目录**，请直接使用真实路径。 |
| 镜像加速站 | 默认 `docker.1ms.run`。它会看到你拉取的镜像名，介意可留空改为直连。 |

---

## 配置

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `WPANEL_PORT` | `8766` | 控制服务端口 |
| `WPANEL_DISTRO` | `Ubuntu` | 目标 WSL 发行版名 |
| `WPANEL_ROOTS` | `/home` | 文件管理允许的根目录（逗号分隔） |
| `WPANEL_COMPOSE_DIR` | 发行版默认用户 `$HOME/compose` | Compose 项目扫描目录 |
| `WPANEL_UI_ORIGINS` | `http://localhost:8765,http://127.0.0.1:8765` | 前端来源白名单（逗号分隔） |
| `WPANEL_ALLOWED_HOSTS` | `127.0.0.1:8766,localhost:8766` | 控制服务可接受的 Host（逗号分隔） |
| `WPANEL_STOP_UNITS` | 空 | 停止 Docker / 关闭 WSL 时额外一并停止的 `.service` 单元 |
| `WPANEL_STORE_REPO` / `WPANEL_STORE_BRANCH` | `1Panel-dev/appstore` @ `main` | 应用商店模板源默认值 |
| `NEXT_PUBLIC_WPANEL_API` | `http://127.0.0.1:8766` | 前端要访问的控制服务地址（**构建时注入**） |

`data/wpanel.local.json`（不进 git）可扩展总览页监控的 systemd 服务，**这些服务在「安全关闭 WSL」时也会被一并停止**：

```json
{
  "services": [
    { "key": "postgresql", "name": "PostgreSQL", "unit": "postgresql.service" }
  ]
}
```

应用商店的模板源与镜像加速站可在界面里直接修改，同样持久化到该文件的 `store` 段。

---

## 架构

```
┌───────────────────────── Windows ─────────────────────────┐
│                                                            │
│   浏览器  http://localhost:8765                            │
│      │                                                     │
│      ├─ 前端  vinext / Next.js 16 + React 19（UI 端口 8765）│
│      │        │                                            │
│      │        └── X-WPanel-Token ──┐                       │
│      │                             ▼                       │
│      └─ 控制服务  server.mjs（127.0.0.1:8766）             │
│                   │          │                             │
│          wsl.exe ─┘          └─ \\wsl.localhost\Ubuntu\...  │
└───────────────────┬──────────────────────┬─────────────────┘
                    │                      │
┌───────────────────▼──── WSL2 发行版 ─────▼─────────────────┐
│  systemd                                                   │
│   ├─ docker.service  ──▶ 容器 / 镜像 / 卷 / 网络           │
│   ├─ 你在 wpanel.local.json 里配置的其他服务                │
│   └─ 文件系统（UNC 共享直读，零 agent）                     │
└────────────────────────────────────────────────────────────┘
```

- **控制服务**（`server.mjs`，约 1.3k 行零依赖 Node）负责所有特权操作：调用 `wsl.exe`、执行 `docker` 子命令、读写 UNC 路径、维护审计日志与安装任务。
- **前端**是纯展示层，不直接接触 shell；所有动作都打到控制服务。
- **没有 agent**：文件读写走 WSL 的 `\\wsl.localhost` 共享，不往发行版里塞任何常驻进程。

---

## 开发

```bash
npm run dev         # 前端开发模式（vinext dev，默认 3000 端口）
npm run controller  # 单独启动控制服务（WPANEL_PORT 可覆盖端口）
npm run build       # 生产构建
npm run start       # 生产模式启动前端
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit（build 走 Vite 不做类型检查，这条单独兜住类型回归）
```

> `next.config.ts` 看似是空文件但**不可删除**：vinext 会主动查找并读取它。真正的构建配置在 `vite.config.ts`（`__WPANEL_API__` 注入就在这里）。

### 重新生成界面截图

`docs/screenshots/` 下的图由脚本生成，无需真实 WSL / Docker 环境：

```bash
node tools/screenshot/mock-api.mjs                            # 模拟控制服务 :8799
NEXT_PUBLIC_WPANEL_API=http://127.0.0.1:8799 npm run dev      # 前端 :8765
node tools/screenshot/capture.mjs                             # 采集浅色 + 深色全套截图
```

详见 [`tools/screenshot/`](tools/screenshot/)。

---

## Roadmap

- [x] v0.1：容器 / 镜像 / 卷 / Compose / 应用商店 / 文件管理 / 服务控制 / AI 助手 / 容器命令盒
- [ ] 容器交互式终端（PTY，当前命令盒为单命令执行）
- [ ] 应用商店支持本地自定义模板包
- [ ] 界面多语言

---

## 致谢

设计参考了 [DPanel](https://github.com/donknap/dpanel) 与 [Dockge](https://github.com/louislam/dockge) 的交互思路；应用商店模板格式兼容 [1Panel AppStore](https://github.com/1Panel-dev/appstore)。

## License

[MIT](LICENSE)
