/**
 * Host half of `halo-mcp-connect`.
 *
 * The bundle mounts `@deepseek-ai/dsh-mcp-client` as the `mcp-halo` row, so
 * the Halo blog's MCP tools arrive as `mcp__halo__*`. The MCP client's Config
 * has no `volatile` fields, so DSH's generic settings form never renders it —
 * that is why the plugin page had no configuration card.
 *
 * This host half owns a small authenticated route instead:
 *
 *   GET  /api/halo-mcp-connect/config   read url / token presence / timeouts
 *   PUT  /api/halo-mcp-connect/config   write them and re-apply the entry
 *
 * The write goes through `configEditor.edit`, which persists the profile patch
 * and reconciles the entry through the normal Loader path. Loader disposes the
 * old MCP client and applies a fresh one, so the connection (and its tool
 * list) refreshes without restarting `dsh web` — the hot reload the user
 * asked for. The token is never sent back to the browser; the form only knows
 * whether one is stored.
 *
 * Two safety rules keep a bad endpoint or key from bricking the entry:
 * the candidate endpoint is probed with a real MCP `initialize` call before
 * anything is persisted, and the saved config always carries
 * `failOnStartupError: false`, so a later connection failure degrades to
 * "connected, zero tools" instead of a dead Loader entry.
 *
 * @module halo-mcp-connect
 */

/** Loader row id mounted by `cordis.patch.yml`. */
const ENTRY_ID = 'mcp-halo'

/** Exact route below the shared `/api` channel; must match `client.js`. */
const ROUTE = '/api/halo-mcp-connect/config'

/** `mcp__<serverName>__<tool>` prefix of the mounted MCP server. */
const TOOL_PREFIX = 'mcp__halo__'

/** Version echoed in the pre-flight `clientInfo`. */
const VERSION = '1.3.0'

/** MCP protocol revision this client speaks during the probe. */
const PROTOCOL_VERSION = '2025-06-18'

const MAX_URL_LENGTH = 2048
const MAX_TOKEN_LENGTH = 4096
const PREFLIGHT_TIMEOUT_MS = 10_000
const DEFAULT_TOOL_TIMEOUT_MS = 60_000

/**
 * Register the Host side of the plugin.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 */
export function apply(ctx) {
  ctx.inject(['configEditor', 'connection'], (child) => {
    child.effect(
      () =>
        child.connection.fetch.register({
          path: ROUTE,
          methods: ['GET', 'PUT'],
          requestBody: 'buffered',
          fetch: (request) => handle(child, request),
        }),
      'halo-mcp-connect: config route',
    )
  })
}

/**
 * Serve one request of the config route.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 * @param {Request} request - Incoming request.
 * @returns {Promise<Response>} JSON response.
 */
async function handle(ctx, request) {
  if (request.method === 'GET') {
    const entry = findEntry(ctx)
    return json(200, { ok: true, value: entry === undefined ? emptyView(ctx) : viewOf(ctx, entry) })
  }
  let input
  try {
    const payload = await request.json()
    input = isRecord(payload) ? payload : {}
  } catch {
    return json(400, failure('invalid-input', '请求体不是合法的 JSON'))
  }
  try {
    const value = await save(ctx, input)
    return json(200, { ok: true, value })
  } catch (error) {
    if (error instanceof ConfigError) {
      return json(error.status, failure(error.code, error.message))
    }
    if (error instanceof PreflightError) {
      return json(502, failure('preflight-failed', error.message))
    }
    const message = error instanceof Error ? error.message : String(error)
    if (/no longer active/i.test(message)) {
      return json(
        409,
        failure(
          'entry-inactive',
          'MCP 客户端当前处于失败状态，无法直接保存。请先在插件页禁用并重新启用本插件（或重启 dsh web），然后重试。',
        ),
      )
    }
    return json(400, failure('save-failed', message))
  }
}

/**
 * Locate the active `mcp-halo` Loader entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 * @returns {import('@deepseek-ai/cordis-plugin-loader').Entry | undefined} Entry.
 */
function findEntry(ctx) {
  return ctx.configEditor.entries().find((entry) => entry.options.id === ENTRY_ID)
}

/**
 * Empty view used while the entry is missing (e.g. the bundle was removed).
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 * @returns {Record<string, unknown>} View without the token.
 */
function emptyView(ctx) {
  return {
    entryId: ENTRY_ID,
    active: false,
    url: '',
    serverName: 'halo',
    hasToken: false,
    toolCallTimeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
    failOnStartupError: false,
    tools: countTools(ctx),
  }
}

/**
 * Project the stored config into a browser-safe view.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 * @param {import('@deepseek-ai/cordis-plugin-loader').Entry} entry - Active entry.
 * @returns {Record<string, unknown>} View without the token.
 */
function viewOf(ctx, entry) {
  const config = entry.options.config ?? {}
  const headers = isRecord(config.headers) ? config.headers : {}
  return {
    entryId: entry.options.id,
    active: true,
    url: typeof config.url === 'string' ? config.url : '',
    serverName: typeof config.serverName === 'string' ? config.serverName : 'halo',
    hasToken: headerToken(headers) !== undefined,
    toolCallTimeoutMs:
      typeof config.toolCallTimeoutMs === 'number' ? config.toolCallTimeoutMs : DEFAULT_TOOL_TIMEOUT_MS,
    failOnStartupError: config.failOnStartupError === true,
    tools: countTools(ctx),
  }
}

/**
 * Read the `Authorization` header case-insensitively.
 * @param {Record<string, unknown>} headers - Header map.
 * @returns {string | undefined} Raw header value.
 */
function headerToken(headers) {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'authorization' && typeof value === 'string' && value.trim() !== '') {
      return value
    }
  }
  return undefined
}

/**
 * Persist an edited config and let Loader re-apply the entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 * @param {Record<string, unknown>} input - `{ url?, token?, clearToken?, toolCallTimeoutMs? }`.
 * @returns {Promise<Record<string, unknown>>} Fresh view.
 */
async function save(ctx, input) {
  const entry = findEntry(ctx)
  if (entry === undefined) throw new ConfigError(404, 'entry-missing', `MCP 入口 ${ENTRY_ID} 未激活；请确认 bundle 已启用。`)

  const current = entry.options.config ?? {}
  const currentHeaders = isRecord(current.headers) ? current.headers : {}

  const url = input.url === undefined ? undefined : normalizedUrl(input.url)
  const candidateUrl = url ?? (typeof current.url === 'string' ? current.url : undefined)
  if (candidateUrl === undefined) throw new ConfigError(400, 'invalid-input', '请填写站点地址')

  const token = wantedToken(input)
  const clearToken = input.clearToken === true

  let toolCallTimeoutMs
  if (input.toolCallTimeoutMs !== undefined) {
    toolCallTimeoutMs = Number(input.toolCallTimeoutMs)
    if (!Number.isInteger(toolCallTimeoutMs) || toolCallTimeoutMs < 1000 || toolCallTimeoutMs > 600000) {
      throw new ConfigError(400, 'invalid-input', 'toolCallTimeoutMs 必须是 1000..600000 之间的整数')
    }
  }

  const effectiveToken = clearToken ? undefined : (token ?? bearerOf(headerToken(currentHeaders)))
  if (!clearToken && effectiveToken === undefined) {
    throw new ConfigError(400, 'invalid-input', '请填写 MCP 访问密钥')
  }
  if (!clearToken) {
    await preflight(candidateUrl, effectiveToken)
  }

  await edit(ctx, entry, (previous) => {
    const next = { ...previous }
    if (url !== undefined) next.url = url
    if (toolCallTimeoutMs !== undefined) next.toolCallTimeoutMs = toolCallTimeoutMs
    // A failed connection must never kill the entry: degrade to zero tools.
    next.failOnStartupError = false
    const headers = { ...(isRecord(previous.headers) ? previous.headers : {}) }
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'authorization') Reflect.deleteProperty(headers, key)
    }
    if (token !== undefined) headers.Authorization = `Bearer ${token}`
    if (clearToken) Reflect.deleteProperty(headers, 'Authorization')
    next.headers = headers
    return next
  })

  await settleTools(ctx)
  const refreshed = findEntry(ctx)
  const view = refreshed === undefined ? emptyView(ctx) : viewOf(ctx, refreshed)
  return {
    saved: true,
    url: view.url,
    tools: view.tools,
    hasToken: view.hasToken,
  }
}

/**
 * Extract a non-empty access token from the request body.
 * @param {Record<string, unknown>} input - Request body.
 * @returns {string | undefined} Bare token.
 */
function wantedToken(input) {
  if (input.token === undefined || input.token === null) return undefined
  if (typeof input.token !== 'string') throw new ConfigError(400, 'invalid-input', 'token 必须是字符串')
  let token = input.token.trim()
  if (token.toLowerCase().startsWith('bearer ')) token = token.slice(7).trim()
  if (token === '') return undefined
  if (token.length > MAX_TOKEN_LENGTH) throw new ConfigError(400, 'invalid-input', 'token 过长')
  return token
}

/**
 * Strip the `Bearer ` prefix from a stored header value.
 * @param {string | undefined} header - Header value.
 * @returns {string | undefined} Bare token.
 */
function bearerOf(header) {
  if (header === undefined) return undefined
  const text = header.trim()
  if (text.toLowerCase().startsWith('bearer ')) return text.slice(7).trim()
  return text === '' ? undefined : text
}

/**
 * Run `configEditor.edit`, reviving a failed entry once when possible.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 * @param {import('@deepseek-ai/cordis-plugin-loader').Entry} entry - Target entry.
 * @param {(previous: Record<string, unknown>) => Record<string, unknown>} change - Editor.
 * @returns {Promise<void>} Resolves once Loader accepted the config.
 */
async function edit(ctx, entry, change) {
  try {
    await ctx.configEditor.edit(entry, (previous) => change(isRecord(previous) ? previous : {}))
    return
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/no longer active/i.test(message)) throw error
  }
  const revived = await revive(ctx)
  const again = findEntry(ctx)
  if (!revived || again === undefined) {
    throw new ConfigError(
      409,
      'entry-inactive',
      'MCP 客户端当前处于失败状态，自动恢复未成功。请先在插件页禁用并重新启用本插件，然后重试。',
    )
  }
  await ctx.configEditor.edit(again, (previous) => change(isRecord(previous) ? previous : {}))
}

/**
 * Try to re-create a failed entry by toggling it through the plugin manager.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 * @returns {Promise<boolean>} Whether the entry looks active again.
 */
async function revive(ctx) {
  const manager = ctx.get('pluginManager')
  if (manager === undefined) return false
  try {
    const plugins = await manager.listPlugins()
    const info = plugins.find((item) => item.patchId === ENTRY_ID)
    if (info === undefined) return false
    await manager.setPluginEnabled(info.entryId, false)
    await sleep(300)
    await manager.setPluginEnabled(info.entryId, true)
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const entry = findEntry(ctx)
      if (entry !== undefined && entry.fiber !== undefined && entry.fiber.state === 2) return true
      await sleep(200)
    }
    return false
  } catch {
    return false
  }
}

/**
 * Probe the candidate endpoint with a real MCP `initialize` request.
 * @param {string} url - MCP endpoint.
 * @param {string} token - Bare access token.
 * @returns {Promise<void>} Resolves when the endpoint answered as MCP.
 */
async function preflight(url, token) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'halo-mcp-connect', version: VERSION },
    },
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS)
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body,
      signal: controller.signal,
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new PreflightError(`无法连接 ${url}：${reason}`)
  } finally {
    clearTimeout(timer)
  }
  if (response.status === 401 || response.status === 403) {
    throw new PreflightError('密钥无效或未授权（HTTP ' + response.status + '），请在 Halo 控制台重新生成 MCP 密钥。')
  }
  if (response.status === 404) {
    throw new PreflightError('MCP 端点不存在（HTTP 404），站点地址通常以 /mcp 结尾。')
  }
  if (!response.ok) {
    throw new PreflightError(`MCP 初始化失败（HTTP ${response.status}）。`)
  }
  const text = await response.text().catch(() => '')
  if (/"error"\s*:/.test(text) && !/"result"\s*:/.test(text)) {
    const match = text.match(/"message"\s*:\s*"([^"]*)"/)
    throw new PreflightError(`MCP 初始化被拒绝${match === null ? '' : `：${match[1]}`}。`)
  }
}

/**
 * Normalize a Halo site address into an MCP endpoint.
 * @param {unknown} value - Candidate URL.
 * @returns {string} Normalized URL string.
 */
function normalizedUrl(value) {
  if (typeof value !== 'string') throw new ConfigError(400, 'invalid-input', 'url 必须是字符串')
  const text = value.trim()
  if (text === '') throw new ConfigError(400, 'invalid-input', 'url 不能为空')
  if (text.length > MAX_URL_LENGTH) throw new ConfigError(400, 'invalid-input', 'url 过长')
  let parsed
  try {
    parsed = new URL(text)
  } catch {
    throw new ConfigError(400, 'invalid-input', 'url 不是合法的绝对地址')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConfigError(400, 'invalid-input', 'url 仅支持 http/https')
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new ConfigError(400, 'invalid-input', 'url 不能包含用户名或密码')
  }
  if (parsed.pathname === '' || parsed.pathname === '/') parsed.pathname = '/mcp'
  parsed.hash = ''
  return parsed.toString()
}

/**
 * Count the Halo MCP tools currently registered by the mounted client.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 * @returns {number} Number of `mcp__halo__*` tool schemas, 0 when unavailable.
 */
function countTools(ctx) {
  const registry = ctx.get('tools')
  if (registry === undefined || typeof registry.schemas !== 'function') return 0
  try {
    return registry.schemas().filter((schema) => typeof schema?.name === 'string' && schema.name.startsWith(TOOL_PREFIX)).length
  } catch {
    return 0
  }
}

/**
 * Give the re-applied MCP client a moment to finish connecting so the response
 * can report the refreshed tool count.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 * @returns {Promise<void>} Resolves after the tool count settles or 10 s.
 */
async function settleTools(ctx) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (countTools(ctx) > 0) return
    await sleep(200)
  }
}

/**
 * @param {number} ms - Delay in milliseconds.
 * @returns {Promise<void>} Resolves after the delay.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * @param {unknown} value - Candidate.
 * @returns {value is Record<string, unknown>} Whether it is a plain object.
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validation error carrying an HTTP status.
 */
class ConfigError extends Error {
  /**
   * @param {number} status - HTTP status.
   * @param {string} code - Machine-readable code.
   * @param {string} message - Human-readable message.
   */
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

/**
 * Endpoint probe failure.
 */
class PreflightError extends Error {}

/**
 * Build a JSON response.
 * @param {number} status - HTTP status.
 * @param {unknown} body - JSON body.
 * @returns {Response} Response.
 */
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

/**
 * Build an error payload.
 * @param {string} code - Machine-readable code.
 * @param {string} message - Human-readable message.
 * @returns {{ok: false, error: {code: string, message: string}}} Payload.
 */
function failure(code, message) {
  return { ok: false, error: { code, message } }
}
