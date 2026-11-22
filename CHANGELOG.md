# Changelog

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
