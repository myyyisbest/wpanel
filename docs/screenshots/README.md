# 界面截图

本目录的图片由 `tools/screenshot/` 下的脚本自动生成，**无需真实的 WSL2 / Docker 环境**：

```bash
node tools/screenshot/mock-api.mjs                            # 模拟控制服务 :8799
NEXT_PUBLIC_WPANEL_API=http://127.0.0.1:8799 npm run dev      # 前端 :8765
node tools/screenshot/capture.mjs                             # 采集浅色 + 深色全套截图
```

渲染的是**真实前端组件与真实样式**，数据来自 `mock-api.mjs` 中的演示数据集（`DESKTOP-7K2M9Q` / `Ubuntu` 等均为虚构示例），因此截图中的容器、镜像、应用列表不代表任何真实主机状态。

## 清单

| 文件 | 内容 |
|---|---|
| `overview-{light,dark}.png` | 总览：状态卡、内存 / CPU 趋势、磁盘、systemd 服务、Docker 占用、最近操作 |
| `containers-cards-{light,dark}.png` | 容器页 · 卡片视图 |
| `containers-list-{light,dark}.png` | 容器页 · 列表视图 |
| `container-logs-{light,dark}.png` | 容器实时日志弹窗 |
| `images-volumes-{light,dark}.png` | 镜像与卷 |
| `compose-{light,dark}.png` | Compose 编排项目列表 |
| `store-{light,dark}.png` | 应用商店 |
| `store-install-{light,dark}.png` | 应用安装参数与预览 |
| `ai-{light,dark}.png` | AI 助手 |
| `files-{light,dark}.png` | 文件管理 |
| `activity-{light,dark}.png` | 日志记录 |

## 新增或调整截图

1. 需要新页面时，在 `tools/screenshot/capture.mjs` 的循环里补一段 `gotoView(page, '导航名')` + `shoot(page, 'name-${theme}')`；
2. 需要新数据时，改 `tools/screenshot/mock-api.mjs` 里对应的常量（如 `CONTAINERS`、`STORE_APPS`）；
3. 改完重跑上面三条命令即可。

脚本以 1440×900 视口、1.5 倍像素密度输出，兼顾清晰度与仓库体积。
