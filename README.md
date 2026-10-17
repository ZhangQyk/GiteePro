# Gitee Pro

一个「原生壳 + 本地 Web 前端 SPA」的 Gitee（码云）移动客户端，通过私人令牌（access_token）登录，覆盖网页端常用的仓库浏览与文件管理能力，并内置 README / 提交 / Issue / Pull 等多个浏览维度。

## 项目结构

```
Gitee Pro/
├── build.gradle                 # 根构建脚本（阿里云镜像）
├── settings.gradle
├── app/
│   ├── build.gradle             # compileSdk 33 / minSdk 19 / targetSdk 26
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/jfmod/GiteePro/
│       │   ├── MainActivity.java    # WebView 壳 + NativeBridge（JS 桥）+ 沉浸式状态栏
│       │   └── GiteeProvider.java   # 轻量 FileProvider（打开下载文件）
│       ├── assets/
│       │   ├── index.html           # SPA 页面结构
│       │   ├── app.js               # SPA 全部业务逻辑
│       │   └── style.css            # 样式（含夜间主题）
│       └── res/                     # 布局 / 主题 / 图标等
```

## 功能

- **登录**：粘贴私人令牌 `access_token` 登录；登录态保存在本机，再次打开自动登录。登录页含安全声明，令牌直连 Gitee 官方接口、不上传第三方。
- **外观**：日间 / 夜间主题切换，沉浸式状态栏与导航栏随主题自动变色、深浅图标自适应；应用图标为 Gitee 官方 Logo 标。
- **仓库列表**：全部 / 我创建的 / 我参与的 / 公开 / 私有 分类筛选，关键词搜索。
- **仓库管理**：新建仓库、删除仓库、Star / 取消 Star、复制克隆地址、在浏览器打开。
- **仓库详情（Tab 页）**：
  - **文件**：分支 / 标签切换、目录浏览（面包屑导航）、代码搜索；
  - **README**：Markdown 渲染（标题 / 代码块 / 列表 / 引用 / 图片 / 链接等）；
  - **提交**：提交历史列表（支持按文件查看历史）；
  - **Issue**：开启 / 已关闭 / 全部筛选、列表、新建 Issue；
  - **Pull**：Pull Request 列表。
- **代码搜索**：全库文件名匹配 + 当前目录文件内容匹配。
- **文件操作**：
  - 查看（行号 + 简单高亮，二进制文件提示不可预览）；
  - 编辑并在线保存（自动生成提交）；
  - 新建 / 上传（本地文件选择器）/ 下载 / 删除；
  - 重命名、复制文件内容、复制路径、查看文件历史。

## 构建

- 在 **AIDE** 中直接「打开项目」选择本目录，或命令行执行 `./gradlew assembleDebug`。
- 首次构建若报 SDK 路径错误，请修改 `local.properties` 的 `sdk.dir`。

## 获取私人令牌

1. 登录 `https://gitee.com` → 打开 `https://gitee.com/profile/personal_access_tokens`。
2. 生成新令牌，建议勾选 `projects`、`user_info` 等 scopes（至少需要仓库相关权限）。
3. 复制令牌，回到 App 登录页粘贴，点「令牌登录」。

## 接口说明

所有请求由原生 `HttpURLConnection` 转发到 Gitee 开放 API：

- 基础地址：`https://gitee.com/api/v5`
- 认证：登录后自动在请求 URL 追加 `access_token`；写操作附带 `X-CSRF-Token`（从首页 `<meta name="csrf-token">` 抓取）。
- 主要端点：`/user`、`/user/repos`、`/search/repositories`、`/repos/{owner}/{repo}`、`/repos/{owner}/{repo}/contents/{path}`、`/branches`、`/tags`、`/commits`、`/issues`、`/pulls`、`/readme`、`/git/trees`、`/user/starred/{owner}/{repo}` 等。

## 说明与注意

- 本应用仅供学习 Gitee 开放 API 与混合开发技术，请遵守 Gitee 服务条款，勿滥用。
- 令牌只保存在本机，不上传第三方服务器。
- 前端文件存放在 `assets/`，可像普通网页一样自行修改扩展功能。
