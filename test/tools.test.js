import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { server } from '../index.js'

let client

before(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test-client', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
})

after(async () => {
  await client.close()
  await server.close()
})

function stubFetch(handler) {
  const real = globalThis.fetch
  globalThis.fetch = handler
  return () => {
    globalThis.fetch = real
  }
}

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

test('lists all 7 tools with full hint annotations and input schemas', async () => {
  const { tools } = await client.listTools()
  assert.equal(tools.length, 7)
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, tool.name)
    assert.equal(tool.annotations?.destructiveHint, false, tool.name)
    assert.equal(tool.annotations?.idempotentHint, true, tool.name)
    assert.equal(typeof tool.annotations?.openWorldHint, 'boolean', tool.name)
    assert.ok(tool.inputSchema, tool.name)
  }
})

test('list_providers returns the tracked services', async () => {
  const res = await client.callTool({ name: 'list_providers', arguments: {} })
  const { providers } = res.structuredContent
  assert.ok(providers.length >= 20)
  assert.ok(providers.some((p) => p.key === 'netflix' && p.label === 'Netflix'))
})

test('calendar_feed_url and rss_feed_url build feed URLs', async () => {
  const cal = await client.callTool({ name: 'calendar_feed_url', arguments: { provider: 'Netflix' } })
  assert.equal(cal.structuredContent.url, 'https://www.galaxymovies.app/api/cal/netflix')
  const rss = await client.callTool({ name: 'rss_feed_url', arguments: { provider: 'hulu' } })
  assert.equal(rss.structuredContent.url, 'https://www.galaxymovies.app/api/rss/hulu')
})

test('feed URL tools reject unknown provider keys with the valid list', async () => {
  const res = await client.callTool({ name: 'rss_feed_url', arguments: { provider: 'nope' } })
  assert.equal(res.isError, true)
  assert.match(res.content[0].text, /netflix/)
})

test('get_arrivals slices the diff and drops departures', async () => {
  const restore = stubFetch(async (url) => {
    assert.match(url, /^https:\/\/www\.galaxymovies\.app\/api\/streaming-changes\?provider=netflix$/)
    return jsonResponse({
      provider: 'netflix',
      label: 'Netflix',
      updatedAt: '2026-11-16T00:00:00Z',
      added: [{ title: 'A' }, { title: 'B' }],
      coming: [{ title: 'C' }],
      left: [{ title: 'D' }],
      leavingSoon: [{ title: 'E' }],
      attribution: 'Powered by Galaxy Movies',
    })
  })
  try {
    const res = await client.callTool({ name: 'get_arrivals', arguments: { provider: 'netflix', limit: 1 } })
    assert.equal(res.structuredContent.added.length, 1)
    assert.equal(res.structuredContent.coming.length, 1)
    assert.equal(res.structuredContent.left, undefined)
    assert.equal(res.structuredContent.leavingSoon, undefined)
  } finally {
    restore()
  }
})

test('get_streaming_changes passes provider=all through', async () => {
  let called
  const restore = stubFetch(async (url) => {
    called = url
    return jsonResponse({ providers: ['netflix'] })
  })
  try {
    await client.callTool({ name: 'get_streaming_changes', arguments: { provider: 'all' } })
    assert.match(called, /provider=all$/)
  } finally {
    restore()
  }
})

test('get_streaming_changes rejects an unknown provider before fetching', async () => {
  const restore = stubFetch(async () => {
    throw new Error('fetch should not run')
  })
  try {
    const res = await client.callTool({ name: 'get_streaming_changes', arguments: { provider: 'bogus' } })
    assert.equal(res.isError, true)
    assert.match(res.content[0].text, /Valid providers:/)
  } finally {
    restore()
  }
})

test('where_to_watch forwards query params to the where API', async () => {
  let called
  const restore = stubFetch(async (url) => {
    called = url
    return jsonResponse({ title: 'Fight Club', providers: [] })
  })
  try {
    await client.callTool({
      name: 'where_to_watch',
      arguments: { query: 'fight club', year: 1999, region: 'US', type: 'movie' },
    })
    const u = new URL(called)
    assert.equal(u.pathname, '/api/ext/where')
    assert.equal(u.searchParams.get('title'), 'fight club')
    assert.equal(u.searchParams.get('year'), '1999')
    assert.equal(u.searchParams.get('region'), 'US')
    assert.equal(u.searchParams.get('type'), 'movie')
  } finally {
    restore()
  }
})

test('API errors surface as tool errors with the response detail', async () => {
  const restore = stubFetch(async () => jsonResponse({ error: 'Unknown provider', providers: ['netflix'] }, 404))
  try {
    const res = await client.callTool({ name: 'get_streaming_changes', arguments: { provider: 'netflix' } })
    assert.equal(res.isError, true)
    assert.match(res.content[0].text, /Unknown provider/)
  } finally {
    restore()
  }
})
