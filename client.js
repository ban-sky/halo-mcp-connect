/**
 * Client half of `halo-mcp-connect`.
 *
 * Renders the Halo connection card on this bundle's own page (slot
 * `plugins.bundle.config`, keyed by the bundle package name). The Host half
 * (`index.js`) validates and persists the values by re-applying the `mcp-halo`
 * entry through Loader, so saving here reconnects the MCP client and refreshes
 * the `mcp__halo__*` tools without restarting `dsh web`.
 *
 * The token is write-only: the Host reports whether one is stored, never the
 * stored value itself.
 *
 * @module halo-mcp-connect/client
 */

window.__ModuleLoader__.load({
  id: 'halo-mcp-connect',
  factory(require) {
    const React = require('react')
    const { useCallback, useEffect, useState } = React
    const h = React.createElement

    const NS = 'halo-mcp-connect'
    const ROUTE = 'api/halo-mcp-connect/config'

    const zh = {
      'title': 'Halo 博客连接',
      'desc': '填写 Halo 站点地址与 MCP 访问密钥。保存后会立即重连并刷新 MCP 工具，无需重启 dsh web。',
      'url.label': '站点地址',
      'url.placeholder': 'https://blog.example.com',
      'url.hint': '填站点根地址即可，保存时会自动补成 <地址>/mcp。',
      'token.label': 'MCP 访问密钥',
      'token.placeholder.keep': '已保存，留空则保持不变',
      'token.placeholder.new': '粘贴 Halo 控制台生成的 MCP 密钥',
      'token.hint': '在 Halo 控制台的 MCP 插件里创建密钥，并勾选“允许全部工具”才能写入文章。',
      'token.stored': '已保存密钥',
      'token.missing': '尚未保存密钥',
      'clear': '清除密钥',
      'save': '保存并重连',
      'saving': '正在重连…',
      'reload': '重新读取',
      'loading': '正在读取…',
      'tools': '已注册工具：{count} 个',
      'tools.none': '当前没有注册任何 Halo 工具',
      'saved': '已保存，MCP 客户端已重连。',
      'saved.notools': '配置已保存，但暂未发现工具；请检查地址与密钥。',
      'error.load': '读取配置失败：{message}',
      'error.save': '保存失败：{message}',
      'error.unknown': '未知错误',
    }

    const en = {
      'title': 'Halo blog connection',
      'desc': 'Set the Halo site address and MCP access key. Saving reconnects and refreshes the MCP tools immediately — no dsh web restart needed.',
      'url.label': 'Site address',
      'url.placeholder': 'https://blog.example.com',
      'url.hint': 'Use the site root; the MCP endpoint <address>/mcp is filled in automatically.',
      'token.label': 'MCP access key',
      'token.placeholder.keep': 'A key is stored; leave blank to keep it',
      'token.placeholder.new': 'Paste a key generated in the Halo console',
      'token.hint': 'Create the key in the Halo MCP plugin and enable “allow all tools” to write posts.',
      'token.stored': 'Key stored',
      'token.missing': 'No key stored',
      'clear': 'Clear key',
      'save': 'Save and reconnect',
      'saving': 'Reconnecting…',
      'reload': 'Reload',
      'loading': 'Loading…',
      'tools': 'Registered tools: {count}',
      'tools.none': 'No Halo tools are registered right now',
      'saved': 'Saved — the MCP client reconnected.',
      'saved.notools': 'Saved, but no tools were discovered yet. Check the address and key.',
      'error.load': 'Could not read the configuration: {message}',
      'error.save': 'Could not save: {message}',
      'error.unknown': 'Unknown error',
    }

    const CSS = `
.hmc-card{box-sizing:border-box;display:flex;flex-direction:column;gap:14px;width:100%;padding:18px 20px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2)}
.hmc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.hmc-title{margin:0;font-size:15px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary)}
.hmc-desc{margin:4px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.hmc-status{flex:none;display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.hmc-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#22c55e)}
.hmc-dot.off{background:var(--dsw-alias-state-warning-primary,#f59e0b)}
.hmc-field{display:flex;flex-direction:column;gap:6px}
.hmc-label{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.hmc-input{box-sizing:border-box;width:100%;height:34px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit}
.hmc-input:focus{outline:none;border-color:var(--dsw-alias-border-l1);box-shadow:0 0 0 2px var(--dsw-alias-interactive-bg-hover)}
.hmc-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.hmc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.hmc-button{display:inline-flex;align-items:center;justify-content:center;height:32px;padding:0 14px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer;font-family:inherit}
.hmc-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.hmc-button:disabled{opacity:.45;cursor:default}
.hmc-button.primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1);border-color:transparent}
.hmc-message{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-success-primary,#22c55e)}
.hmc-message.error{color:var(--dsw-alias-state-error-primary)}
`

    /**
     * Fetch with a bounded wait, so a hung route cannot leave the card spinning.
     * @param {string} route - Route path.
     * @param {RequestInit} [init] - Fetch options.
     * @returns {Promise<Record<string, unknown>>} Host value.
     */
    const request = async (route, init) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 20000)
      let response
      try {
        response = await fetch(route, { credentials: 'same-origin', signal: controller.signal, ...init })
      } catch (cause) {
        const reason = cause instanceof Error && cause.name === 'AbortError' ? '请求超时（20 秒）' : String(cause)
        const error = new Error(reason)
        error.code = 'network'
        throw error
      } finally {
        clearTimeout(timer)
      }
      const payload = await response.json().catch(() => undefined)
      if (!response.ok || payload?.ok !== true) {
        const message = payload?.error?.message ?? `HTTP ${response.status}`
        const error = new Error(message)
        error.code = payload?.error?.code
        throw error
      }
      return payload.value
    }

    /**
     * Read the connection card state from the Host.
     * @returns {Promise<Record<string, unknown>>} Host value.
     */
    const readConfig = () => request(ROUTE, { headers: { accept: 'application/json' } })

    /**
     * Persist the edited fields and let the Host reconnect.
     * @param {Record<string, unknown>} body - Fields to write.
     * @returns {Promise<Record<string, unknown>>} Host value.
     */
    const writeConfig = (body) =>
      request(ROUTE, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      })

    /**
     * The bundle's configuration card.
     * @param {{t: (key: string, params?: Record<string, unknown>) => string}} props - Slot props.
     * @returns {import('react').ReactElement} Card.
     */
    function HaloConnectionCard(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => zh[key] ?? key
      const [loading, setLoading] = useState(true)
      const [saving, setSaving] = useState(false)
      const [value, setValue] = useState(null)
      const [url, setUrl] = useState('')
      const [token, setToken] = useState('')
      const [clearToken, setClearToken] = useState(false)
      const [message, setMessage] = useState(null)
      const [error, setError] = useState(null)

      const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
          const next = await readConfig()
          setValue(next)
          setUrl(typeof next.url === 'string' ? next.url : '')
        } catch (cause) {
          setError(t('error.load', { message: cause instanceof Error ? cause.message : String(cause) }))
        } finally {
          setLoading(false)
        }
      }, [t])

      useEffect(() => {
        load()
      }, [load])

      const submit = useCallback(async () => {
        setSaving(true)
        setMessage(null)
        setError(null)
        try {
          const body = { url }
          if (token.trim() !== '') body.token = token.trim()
          if (clearToken) body.clearToken = true
          const result = await writeConfig(body)
          setToken('')
          setClearToken(false)
          setValue((previous) => ({ ...(previous ?? {}), ...result }))
          if (typeof result.url === 'string' && result.url !== '') setUrl(result.url)
          const count = typeof result.tools === 'number' ? result.tools : 0
          setMessage(count > 0 ? `${t('saved')} ${t('tools', { count })}` : t('saved.notools'))
        } catch (cause) {
          setError(t('error.save', { message: cause instanceof Error ? cause.message : String(cause) }))
        } finally {
          setSaving(false)
        }
      }, [clearToken, t, token, url])

      const hasToken = value?.hasToken === true
      const toolCount = typeof value?.tools === 'number' ? value.tools : 0

      return h(
        'section',
        { className: 'hmc-card', 'data-plugin': 'halo-mcp-connect' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'hmc-head' },
          h(
            'div',
            null,
            h('h3', { className: 'hmc-title' }, t('title')),
            h('p', { className: 'hmc-desc' }, t('desc')),
          ),
          h(
            'span',
            { className: 'hmc-status' },
            h('span', { className: `hmc-dot${toolCount > 0 ? '' : ' off'}` }),
            toolCount > 0 ? t('tools', { count: toolCount }) : t('tools.none'),
          ),
        ),
        error !== null ? h('p', { className: 'hmc-message error' }, error) : null,
        message !== null ? h('p', { className: 'hmc-message' }, message) : null,
        h(
          'label',
          { className: 'hmc-field' },
          h('span', { className: 'hmc-label' }, t('url.label')),
          h('input', {
            className: 'hmc-input',
            type: 'url',
            spellCheck: false,
            autoComplete: 'off',
            placeholder: t('url.placeholder'),
            value: url,
            disabled: loading || saving,
            onChange: (event) => setUrl(event.target.value),
          }),
          h('p', { className: 'hmc-hint' }, t('url.hint')),
        ),
        h(
          'label',
          { className: 'hmc-field' },
          h(
            'span',
            { className: 'hmc-label' },
            t('token.label'),
            ' ',
            h(
              'span',
              { className: 'hmc-hint' },
              hasToken ? t('token.stored') : t('token.missing'),
            ),
          ),
          h('input', {
            className: 'hmc-input',
            type: 'password',
            spellCheck: false,
            autoComplete: 'off',
            placeholder: hasToken ? t('token.placeholder.keep') : t('token.placeholder.new'),
            value: token,
            disabled: loading || saving,
            onChange: (event) => setToken(event.target.value),
          }),
          h('p', { className: 'hmc-hint' }, t('token.hint')),
        ),
        h(
          'div',
          { className: 'hmc-row' },
          h(
            'button',
            {
              type: 'button',
              className: 'hmc-button primary',
              disabled: loading || saving || url.trim() === '',
              onClick: () => { void submit() },
            },
            saving ? t('saving') : t('save'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'hmc-button',
              disabled: loading || saving,
              onClick: () => { void load() },
            },
            loading ? t('loading') : t('reload'),
          ),
          hasToken
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'hmc-button',
                  disabled: loading || saving,
                  onClick: () => setClearToken((previous) => !previous),
                },
                `${t('clear')}${clearToken ? ' ✓' : ''}`,
              )
            : null,
        ),
      )
    }

    /**
     * Register the Client side of the plugin.
     * @param {import('@deepseek-ai/cordis').Context} ctx - Client context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'halo-mcp-connect: dictionaries')
      ctx.slots.inject('plugins.bundle.config', () =>
        ctx.slots.register(
          { name: 'plugins.bundle.config', key: 'halo-mcp-connect', locale: NS },
          HaloConnectionCard,
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    }
  },
})
