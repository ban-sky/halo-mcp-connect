# halo-mcp-connect

把 [DSH](https://github.com/deepseek-ai/dsh) 连接到 Halo 博客的 MCP 服务，让智能体直接搜索、阅读和撰写文章，管理页面、分类、标签、评论与附件。

```
DSH (MCP 客户端) ──HTTP──▶ Halo /mcp (MCP 服务插件) ──▶ Halo REST API
```

本仓库是一个**纯配置**的 DSH bundle：不含任何可执行代码，只向 DSH profile 插入一个
`@deepseek-ai/dsh-mcp-client` 实例。站点地址、MCP Token、超时等参数都在 DSH 的插件配置页里填写。

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

安装后需重启 `dsh web` 才会加载新的 MCP 连接。

## 配置

### 插件配置页（推荐）

**设置 → 插件 → Halo 博客 → 配置**，填写：

| 字段 | 值 |
| --- | --- |
| `url` | `https://<你的站点>/mcp` |
| `headers` | `{"Authorization": "Bearer hmcp_xxx"}` |
| `toolCallTimeoutMs` | `60000`（按需调整） |

### 或覆盖 profile 配置

编辑 `$DSH_HOME/profiles/web/cordis.patch.yml`，加入按 id 覆盖的条目：

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

改完重启 `dsh web`。

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

- **只有读工具**：密钥没放开写工具，去 Halo 控制台编辑该密钥并勾选「允许全部工具」。
- **改完密钥工具没变**：MCP 服务端宣告 `tools.listChanged=false`，DSH 只在连接时同步工具列表，
  重启 `dsh web` 即可。
- **401 / 连接失败**：检查 Token 是否带 `Bearer ` 前缀、端点是否为 `/mcp`、站点是否可从本机访问。

## 安全

- 本仓库的 `cordis.patch.yml` 不含任何 Token，请勿把自己的密钥提交回仓库。
- 只读场景不要勾选「允许全部工具」，按需授权更安全。
- 写操作会直接影响线上内容，智能体调用前请确认。

## 版本

- `1.1.0` — 配置化改造：站点地址与 MCP Token 移至插件配置页；补充文档与发布说明。
- `1.0.0` — 首个可用版本。

## License

MIT © ban-sky
