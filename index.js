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
 * @module halo-mcp-connect
 */

/** Loader row id mounted by `cordis.patch.yml`. */
const ENTRY_ID = 'mcp-halo'

/** Exact route below the shared `/api` channel; must match `client.js`. */
const ROUTE = '/api/halo-mcp-connect/config'

/** `mcp__<serverName>__<tool>` prefix of the mounted MCP server. */
const TOOL_PREFIX = 'mcp__halo__'

const MAX_URL_LENGTH = 2048
const MAX_TOKEN_LENGTH = 4096

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
  const entry = findEntry(ctx)
  if (entry === undefined) {
    return json(404, failure('entry-missing', `MCP 入口 ${ENTRY_ID} 未激活；请确认 bundle 已启用。`))
  }
  if (request.method === 'GET') {
    return json(200, { ok: true, value: viewOf(ctx, entry) })
  }
  try {
    const payload = await request.json()
    const value = await save(ctx, payload)
    return json(200, { ok: true, value })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
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
    url: typeof config.url === 'string' ? config.url : '',
    serverName: typeof config.serverName === 'string' ? config.serverName : 'halo',
    hasToken: typeof headers.Authorization === 'string' && headers.Authorization.length > 0,
    toolCallTimeoutMs: typeof config.toolCallTimeoutMs === 'number' ? config.toolCallTimeoutMs : 60000,
    failOnStartupError: config.failOnStartupError === true,
    tools: countTools(ctx),
  }
}

/**
 * Persist an edited config and let Loader re-apply the entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 * @param {unknown} payload - `{ url?, token?, clearToken?, toolCallTimeoutMs?, failOnStartupError? }`.
 * @returns {Promise<Record<string, unknown>>} Fresh view.
 */
async function save(ctx, payload) {
  const input = isRecord(payload) ? payload : {}
  const entry = findEntry(ctx)
  if (entry === undefined) throw new Error(`MCP 入口 ${ENTRY_ID} 未激活`)

  /** @type {string | undefined} */
  let url
  if (input.url !== undefined) {
    url = validatedUrl(input.url)
  }

  /** @type {string | undefined} */
  let token
  if (input.token !== undefined && input.token !== null && input.token !== '') {
    if (typeof input.token !== 'string') throw new Error('token 必须是字符串')
    token = input.token.trim()
    if (token.length > MAX_TOKEN_LENGTH) throw new Error('token 过长')
    if (token.toLowerCase().startsWith('bearer ')) token = token.slice(7).trim()
    if (token === '') throw new Error('token 不能为空')
  }
  const clearToken = input.clearToken === true

  let toolCallTimeoutMs
  if (input.toolCallTimeoutMs !== undefined) {
    toolCallTimeoutMs = Number(input.toolCallTimeoutMs)
    if (!Number.isInteger(toolCallTimeoutMs) || toolCallTimeoutMs < 1000 || toolCallTimeoutMs > 600000) {
      throw new Error('toolCallTimeoutMs 必须是 1000..600000 之间的整数')
    }
  }

  let failOnStartupError
  if (input.failOnStartupError !== undefined) {
    failOnStartupError = input.failOnStartupError === true
  }

  await ctx.configEditor.edit(entry, (current) => {
    const next = { ...current }
    if (url !== undefined) next.url = url
    if (toolCallTimeoutMs !== undefined) next.toolCallTimeoutMs = toolCallTimeoutMs
    if (failOnStartupError !== undefined) next.failOnStartupError = failOnStartupError
    const headers = { ...(isRecord(current.headers) ? current.headers : {}) }
    if (token !== undefined) headers.Authorization = `Bearer ${token}`
    if (clearToken) Reflect.deleteProperty(headers, 'Authorization')
    next.headers = headers
    return next
  })

  await settleTools(ctx)
  const refreshed = findEntry(ctx)
  return {
    saved: true,
    tools: countTools(ctx),
    hasToken: refreshed === undefined ? token !== undefined && !clearToken : viewOf(ctx, refreshed).hasToken,
  }
}

/**
 * Validate a MCP endpoint URL.
 * @param {unknown} value - Candidate URL.
 * @returns {string} Normalized URL string.
 */
function validatedUrl(value) {
  if (typeof value !== 'string') throw new Error('url 必须是字符串')
  const text = value.trim()
  if (text.length === 0) throw new Error('url 不能为空')
  if (text.length > MAX_URL_LENGTH) throw new Error('url 过长')
  let parsed
  try {
    parsed = new URL(text)
  } catch {
    throw new Error('url 不是合法的绝对地址')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('url 仅支持 http/https')
  if (parsed.username !== '' || parsed.password !== '') throw new Error('url 不能包含用户名或密码')
  return text
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
 * @returns {Promise<void>} Resolves after the tool count settles or 6 s.
 */
async function settleTools(ctx) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (countTools(ctx) > 0) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

/**
 * @param {unknown} value - Candidate.
 * @returns {value is Record<string, unknown>} Whether it is a plain object.
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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
