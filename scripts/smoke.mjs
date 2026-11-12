// Drives the server over stdio via the SDK client — exercises every tool once.
// Usage: node scripts/smoke.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['index.js'],
  stderr: 'inherit',
})
const client = new Client({ name: 'smoke', version: '0.0.0' })
await client.connect(transport)

const { tools } = await client.listTools()
console.log(`tools: ${tools.map((t) => t.name).join(', ')}`)

let failed = 0
async function call(name, args, check) {
  const res = await client.callTool({ name, arguments: args })
  const text = res.content?.[0]?.text || ''
  const parsed = res.isError ? null : JSON.parse(text)
  const pass = !res.isError && check(parsed)
  console.log(`${pass ? 'ok ' : 'FAIL'} ${name} ${res.isError ? '-> ' + text.slice(0, 120) : ''}`)
  if (!pass) failed++
  return parsed
}

await call('list_providers', {}, (d) => d.providers.length === 20)
await call('get_streaming_changes', { provider: 'netflix' }, (d) => Array.isArray(d.added) && Array.isArray(d.coming))
await call('get_streaming_changes', { provider: 'all' }, (d) => d.providers && d.providers.netflix)
await call('get_arrivals', { provider: 'hulu', limit: 3 }, (d) => d.added.length <= 3 && d.coming.length <= 3)
await call('get_departures', { provider: 'max' }, (d) => Array.isArray(d.left) && Array.isArray(d.leavingSoon))
await call('where_to_watch', { query: 'fight club' }, (d) => d.providers && d.tmdbId === 550)
await call('calendar_feed_url', { provider: 'disney-plus' }, (d) => d.url.endsWith('/api/cal/disney-plus'))
await call('rss_feed_url', { provider: 'tubi' }, (d) => d.url.endsWith('/api/rss/tubi'))

// error paths: bad provider must surface the valid list; unknown title must error
const bad = await client.callTool({ name: 'calendar_feed_url', arguments: { provider: 'bogus' } })
const badOk = bad.isError && bad.content[0].text.includes('netflix')
console.log(`${badOk ? 'ok ' : 'FAIL'} bad provider -> error with valid list`)
if (!badOk) failed++

const noHit = await client.callTool({ name: 'where_to_watch', arguments: { query: 'zzzznotarealtitleqqq' } })
console.log(`${noHit.isError ? 'ok ' : 'FAIL'} unknown title -> error`)
if (!noHit.isError) failed++

await client.close()
console.log(failed ? `\n${failed} FAILED` : '\nsmoke passed')
process.exit(failed ? 1 : 0)
