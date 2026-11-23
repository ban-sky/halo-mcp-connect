# Changelog

## 1.3.0

- 修复“无法保存”：保存前用候选地址与密钥真实调用一次 MCP `initialize`，
  401/403 提示“密钥无效或未授权”，404 提示端点不对，校验失败不写配置。
- 站点地址自动规范化：只填根地址时补 `/mcp`，去掉 hash。
- 固定写入 `failOnStartupError: false`：连接失败只退化为 0 个工具，不再把入口变成 failed 状态导致后续都无法保存。
- 入口处于 failed 时，保存会尝试通过插件管理器重启该条目并在成功后重试一次；
  仍失败则明确提示“先在插件页禁用再启用本插件”。
- 读取/清除 `Authorization` 时大小写不敏感；保存响应带回规范化后的地址，卡片同步更新。
- 客户端请求增加 20 秒超时，避免卡片一直转圈。

## 1.2.0

- 新增 Host 半身 `index.js`：`GET/PUT /api/halo-mcp-connect/config`，校验地址/密钥/超时并通过
  `configEditor.edit()` 持久化，走 Loader 热应用。
- 新增 Client 半身 `client.js`：在插件页 `plugins.bundle.config` 槽位渲染“Halo 博客连接”卡片，
  可填写站点地址与 MCP 密钥、清除密钥、保存并重连、重新读取。
- 保存配置即热重连并重新拉取工具列表，不再需要重启 `dsh web`。
- 修复插件页没有配置入口的问题（mcp-client 的 Config 没有 volatile 字段，无法生成通用表单）。

## 1.1.0

- 站点地址与 MCP Token 改为在 DSH 插件配置页填写，仓库内不再包含密钥。
- 新增 README、LICENSE 与安装/排障说明。

## 1.0.0

- 首个版本：通过 `@deepseek-ai/dsh-mcp-client` 连接 Halo MCP 服务。
