# Wiki 源文件

这里的 Markdown 是 [WPanel Wiki](https://github.com/myyyisbest/wpanel/wiki) 的**源文件**，随主仓库一起评审、一起提交。

| 文件 | Wiki 页面 |
|---|---|
| `Home.md` | 首页 |
| `安装指南.md` | 安装指南 |
| `功能手册.md` | 功能手册 |
| `配置参考.md` | 配置参考 |
| `安全模型.md` | 安全模型 |
| `常见问题.md` | 常见问题 |
| `开发指南.md` | 开发指南 |
| `_Sidebar.md` | 左侧导航（GitHub Wiki 保留页） |
| `_Footer.md` | 页脚（GitHub Wiki 保留页） |

文件名即页面标题（`_Sidebar` / `_Footer` 除外）。本文件（`README.md`）只是目录说明，**不会被发布为 Wiki 页面**。

## 发布到 GitHub Wiki

```powershell
.\tools\publish-wiki.ps1
.\tools\publish-wiki.ps1 -WhatIf              # 只看变更，不提交
.\tools\publish-wiki.ps1 -Message 'docs: ...' # 自定义提交信息
```

### 首次发布前的前置条件

GitHub 只有在**同时满足**下面两点后，才会创建 `wpanel.wiki.git` 仓库：

1. 仓库已启用 Wiki —— **Settings → Features → 勾选 "Wikis"**；
2. **在网页上创建过至少一个页面** —— 打开 <https://github.com/myyyisbest/wpanel/wiki>，点 "Create the first page"，随便写点内容保存即可。

之后 `publish-wiki.ps1` 就能正常克隆、覆盖并推送了。

> 为什么不用 API 自动启用？GitHub REST API 没有「创建/启用 Wiki」的接口，这一步只能在网页上点。

## 约定

- 页面间的链接写成 `[标题](页面名)`，例如 `[安装指南](安装指南)`；
- 图片引用主仓库的 raw 地址，保证 wiki 与 README 用同一套截图：
  `https://raw.githubusercontent.com/myyyisbest/wpanel/main/docs/screenshots/xxx.png`
- 改完页面后先提交主仓库，再运行发布脚本 —— 这样「源文件变更」和「Wiki 同步」在历史里是可追溯的。
