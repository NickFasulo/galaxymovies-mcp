#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)))
const SITE = 'https://www.galaxymovies.app'
const ATTRIBUTION = 'Powered by Galaxy Movies — keep attribution when republishing (https://www.galaxymovies.app).'

// Mirrors embeddableProviders(): US providers whose daily diffs carry "coming"
// data. Keep in sync with the API's 404 { providers: [...] } payload.
const PROVIDERS = [
  { key: 'netflix', label: 'Netflix' },
  { key: 'amazon-prime-video', label: 'Amazon Prime Video' },
  { key: 'hulu', label: 'Hulu' },
  { key: 'disney-plus', label: 'Disney+' },
  { key: 'apple-tv', label: 'Apple TV' },
  { key: 'max', label: 'HBO Max' },
  { key: 'peacock', label: 'Peacock' },
  { key: 'paramount-plus', label: 'Paramount+' },
  { key: 'tubi', label: 'Tubi' },
  { key: 'pluto-tv', label: 'Pluto TV' },
  { key: 'roku-channel', label: 'The Roku Channel' },
  { key: 'starz', label: 'Starz' },
  { key: 'amc-plus', label: 'AMC+' },
  { key: 'mgm-plus', label: 'MGM+' },
  { key: 'crunchyroll', label: 'Crunchyroll' },
  { key: 'discovery-plus', label: 'Discovery+' },
  { key: 'plex', label: 'Plex' },
  { key: 'kanopy', label: 'Kanopy' },
  { key: 'shudder', label: 'Shudder' },
  { key: 'criterion', label: 'Criterion Channel' },
]
const PROVIDER_KEYS = new Set(PROVIDERS.map((p) => p.key))

function providerKey(value) {
  const key = String(value).toLowerCase().trim()
  if (!PROVIDER_KEYS.has(key)) {
    throw new Error(`Unknown provider '${value}'. Valid providers: ${[...PROVIDER_KEYS].join(', ')}`)
  }
  return key
}

async function fetchJson(path) {
  let res
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch(`${SITE}${path}`, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'user-agent': `galaxymovies-mcp/${pkg.version} (+${SITE})`, accept: 'application/json' },
      })
    } catch (e) {
      if (attempt === 0) continue
      throw new Error(`Galaxy Movies API unreachable: ${e.message}`)
    }
    if (res.status >= 500 && attempt === 0) continue
    break
  }
  if (res.status === 429) {
    const retry = res.headers.get('retry-after')
    throw new Error(`Galaxy Movies API rate limited${retry ? ` — retry after ${retry}s` : ', retry shortly'}`)
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = body?.providers ? ` Valid providers: ${body.providers.join(', ')}` : ''
    throw new Error(`${body?.error || `API error ${res.status}`}${detail}`)
  }
  return body
}

function ok(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  }
}

function err(e) {
  return { content: [{ type: 'text', text: String(e?.message || e) }], isError: true }
}

const server = new McpServer({ name: 'galaxymovies', version: pkg.version })

const providerParam = z.string().describe(`Streaming service key — call list_providers for valid keys`)
const limitParam = z.number().int().min(1).max(50).optional().describe('Max items per list (default: all)')

server.registerTool(
  'list_providers',
  {
    title: 'List streaming providers',
    description: `List the streaming services Galaxy Movies tracks (keys + labels). ${ATTRIBUTION}`,
  },
  async () => ok({ providers: PROVIDERS, attribution: ATTRIBUTION }),
)

server.registerTool(
  'get_streaming_changes',
  {
    title: 'Get streaming catalog changes',
    description:
      `What was added, is coming soon, left, or is leaving soon on a US streaming service. ` +
      `Pass a provider key or 'all'. ${ATTRIBUTION}`,
    inputSchema: { provider: z.string().describe("Provider key, or 'all' for every service") },
  },
  async ({ provider }) => {
    try {
      const key = provider === 'all' ? 'all' : providerKey(provider)
      return ok(await fetchJson(`/api/streaming-changes?provider=${key}`))
    } catch (e) {
      return err(e)
    }
  },
)

server.registerTool(
  'get_arrivals',
  {
    title: 'Get new and upcoming titles',
    description: `Titles recently added or announced as coming soon on a streaming service. ${ATTRIBUTION}`,
    inputSchema: { provider: providerParam, limit: limitParam },
  },
  async ({ provider, limit }) => {
    try {
      const d = await fetchJson(`/api/streaming-changes?provider=${providerKey(provider)}`)
      const slice = (arr) => (limit ? arr.slice(0, limit) : arr)
      return ok({
        provider: d.provider,
        label: d.label,
        updatedAt: d.updatedAt,
        added: slice(d.added),
        coming: slice(d.coming),
        attribution: d.attribution,
      })
    } catch (e) {
      return err(e)
    }
  },
)

server.registerTool(
  'get_departures',
  {
    title: 'Get departing titles',
    description: `Titles that left or are leaving soon on a streaming service. ${ATTRIBUTION}`,
    inputSchema: { provider: providerParam, limit: limitParam },
  },
  async ({ provider, limit }) => {
    try {
      const d = await fetchJson(`/api/streaming-changes?provider=${providerKey(provider)}`)
      const slice = (arr) => (limit ? arr.slice(0, limit) : arr)
      return ok({
        provider: d.provider,
        label: d.label,
        updatedAt: d.updatedAt,
        left: slice(d.left),
        leavingSoon: slice(d.leavingSoon),
        attribution: d.attribution,
      })
    } catch (e) {
      return err(e)
    }
  },
)

server.registerTool(
  'where_to_watch',
  {
    title: 'Find where a title streams',
    description:
      `Resolve a movie or TV show to the services streaming it (subscription, free, ads, rent, buy). ${ATTRIBUTION}`,
    inputSchema: {
      query: z.string().min(1).describe('Title to look up, e.g. "fight club"'),
      year: z.number().int().optional().describe('Release year to disambiguate'),
      region: z.string().length(2).optional().describe('2-letter country code (default: US)'),
      type: z.enum(['movie', 'tv']).optional().describe('Restrict to movies or TV shows'),
    },
  },
  async ({ query, year, region, type }) => {
    try {
      const params = new URLSearchParams({ title: query })
      if (year) params.set('year', String(year))
      if (region) params.set('region', region)
      if (type) params.set('type', type)
      return ok(await fetchJson(`/api/ext/where?${params}`))
    } catch (e) {
      return err(e)
    }
  },
)

server.registerTool(
  'calendar_feed_url',
  {
    title: 'Get calendar feed URL',
    description: `ICS calendar URL of streaming arrivals/departures for a service — subscribable in any calendar app. ${ATTRIBUTION}`,
    inputSchema: { provider: providerParam },
  },
  async ({ provider }) => {
    try {
      const key = providerKey(provider)
      return ok({ provider: key, url: `${SITE}/api/cal/${key}` })
    } catch (e) {
      return err(e)
    }
  },
)

server.registerTool(
  'rss_feed_url',
  {
    title: 'Get RSS feed URL',
    description: `RSS feed URL of streaming arrivals/departures for a service. ${ATTRIBUTION}`,
    inputSchema: { provider: providerParam },
  },
  async ({ provider }) => {
    try {
      const key = providerKey(provider)
      return ok({ provider: key, url: `${SITE}/api/rss/${key}` })
    } catch (e) {
      return err(e)
    }
  },
)

await server.connect(new StdioServerTransport())
