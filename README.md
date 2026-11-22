# halo-mcp-connect

把 [DSH](https://github.com/deepseek-ai/dsh) 连接到 Halo 博客的 MCP 服务，让智能体直接搜索、阅读和撰写文章，管理页面、分类、标签、评论与附件。

```
DSH (MCP 客户端) ──HTTP──▶ Halo /mcp (MCP 服务插件) ──▶ Halo REST API
```

本仓库是一个 DSH bundle，包含三部分：

| 部分 | 文件 | 作用 |
| --- | --- | --- |
| 配置补丁 | `cordis.patch.yml` | 向 profile 插入 `mcp-halo`（`@deepseek-ai/dsh-mcp-client`）和本 bundle 的 Host 半身 |
| Host 半身 | `index.js` | 提供 `GET/PUT /api/halo-mcp-connect/config`，校验参数并通过 `configEditor.edit()` 重写 `mcp-halo` 配置 |
| Client 半身 | `client.js` | 在「设置 → 插件 → halo-mcp-connect」页面渲染“Halo 博客连接”卡片（地址、密钥、重连） |

保存配置时 DSH 的 Loader 会重新应用 `mcp-halo` 条目，MCP 客户端随之重连并重新拉取工具列表——**不需要重启 `dsh web`**。

## 前置条件

1. Halo ≥ 2.26，并安装 [MCP 服务插件](https://github.com/halo-dev/plugin-mcp-server)。
2. 在 Halo 控制台创建访问密钥：**插件 → MCP 服务 → 访问密钥 → 新建**。
   - 想写文章，需要勾选「允许全部工具」（或至少选中 `halo_create_post`、`halo_update_post`、
     `halo_set_post_publish_state`、`halo_recycle_post`、`halo_restore_post`）。
   - 密钥只在创建时显示一次，请立即保存。
3. 确认站点地址，MCP 端点为 `https://<你的站点>/mcp`。

## 安装

方式一：DSH Web 侧栏 → **插件** → 安装 → 选择本目录。

方式二：命令行安装到 `web` profile：

```bash
dsh plugin --profile web add /path/to/halo-mcp-connect
```

安装后刷新浏览器页面，让新的 Client 半身加载。

## 配置

打开 **设置 → 插件 → halo-mcp-connect**，在“Halo 博客连接”卡片里填写：

| 字段 | 说明 |
| --- | --- |
| 站点地址 | `https://<你的站点>/mcp`，也可只填站点地址，保存时自动补 `/mcp` |
| MCP 访问密钥 | 只写不读：保存后回显“已保存密钥”，留空表示保持不变 |
| 清除密钥 | 勾选后保存会删除已保存的 `Authorization` |
| 保存并重连 | 写入配置并等待工具重新注册，显示当前工具数量 |
| 重新读取 | 重新读取当前配置与工具数量 |

命令行等价方式（改 `$DSH_HOME/profiles/web/cordis.patch.yml` 后保存同样会触发热加载）：

```yaml
- id: mcp-halo
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: halo
    transport: streamable-http
    url: https://<你的站点>/mcp
    headers:
      Authorization: 'Bearer hmcp_xxx'
    toolCallTimeoutMs: 60000
```

## 可用工具

连接成功后，工具以 `mcp__halo__<name>` 的形式出现，共 69 个（取决于密钥授权范围）：

- 文章：`halo_list_posts`、`halo_get_post`、`halo_search_content`、`halo_create_post`、
  `halo_update_post`、`halo_set_post_publish_state`、`halo_recycle_post`、`halo_restore_post`
- 页面：`halo_list_single_pages`、`halo_get_single_page`、`halo_create_single_page`、
  `halo_update_single_page`、`halo_set_single_page_publish_state` 等
- 分类 / 标签：`halo_list_categories`、`halo_create_category`、`halo_update_category`、
  `halo_delete_category`、`halo_list_tags`、`halo_create_tag` 等
- 评论 / 回复：`halo_list_comments`、`halo_list_comment_replies`、`halo_set_comment_approval`、
  `halo_set_reply_approval`、`halo_delete_comment`、`halo_delete_reply`
- 附件：`halo_list_attachments`、`halo_get_attachment`、`halo_upload_attachment`、
  `halo_upload_attachment_from_url`、`halo_delete_attachment`
- 主题：`halo_list_theme_setting_groups`、`halo_get_theme_setting_group`、
  `halo_update_theme_setting_group`、模板列表 / 读取
- 其他插件：`PluginLinks__*`、`PluginMoments__*`

## 排障

- **插件页没有配置卡片**：确认 bundle 已启用且 `client.js` 被浏览器加载（刷新页面）；
  本卡片挂在 `plugins.bundle.config` 槽位，键为包名 `halo-mcp-connect`。
- **只有读工具**：密钥没放开写工具，去 Halo 控制台编辑该密钥并勾选「允许全部工具」，
  然后在卡片里点一次“保存并重连”。
- **保存后工具数没变**：MCP 服务端宣告 `tools.listChanged=false`，热重连会重新 `tools/list`；
  若仍为 0，检查地址、Token 与站点可达性，或在卡片里点“重新读取”。
- **401 / 连接失败**：检查 Token 是否带 `Bearer ` 前缀、端点是否为 `/mcp`、站点是否可从本机访问。

## 安全

- 本仓库的 `cordis.patch.yml` 不含任何 Token；真实密钥保存在 profile 的
  `cordis.patch.yml` 或本 bundle 的补丁里，请勿提交回仓库。
- 保存的密钥只写不读，Host 接口不会返回明文。
- 只读场景不要勾选「允许全部工具」，按需授权更安全。
- 写操作会直接影响线上内容，智能体调用前请确认。

## 版本

- `1.2.0` — 新增 Host/Client 半身：插件页“Halo 博客连接”配置卡片，保存即热重连、刷新 MCP 工具。
- `1.1.0` — 配置化改造：站点地址与 MCP Token 移至补丁层；补充文档与发布说明。
- `1.0.0` — 首个可用版本。

## License

MIT © ban-sky
