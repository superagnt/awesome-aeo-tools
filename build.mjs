#!/usr/bin/env node
/**
 * Writes the tools table in README.md from data.json, and holds data.json to
 * the list's rules: every tool has the pages it was read from and the day they
 * were read, and every value it states has the page and the words on that
 * page behind it, words that hold the value: each engine it names, the entry
 * plan's name and price, and an MCP server's, API's or CLI's own word.
 *
 *   node build.mjs           checks data.json, then rewrites README.md's table
 *   node build.mjs --check   changes nothing; exits 1 when data.json breaks a
 *                            rule or README.md's table isn't data.json's
 *
 * Node 20 or later, no dependencies.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = join(HERE, 'data.json')
const README = join(HERE, 'README.md')
const START = '<!-- tools:start: written by build.mjs from data.json, edit data.json instead -->'
const END = '<!-- tools:end -->'
const MIN_TOOLS = 20
const MAX_TOOLS = 40
const CURRENCIES = { USD: '$', EUR: '€', GBP: '£' }
const ACCESS = [
  ['mcp', 'MCP server'],
  ['api', 'API'],
  ['cli', 'CLI'],
]

/** What a Yes's quote says it is: an MCP server, an API, a command-line tool. */
const ACCESS_WORDS = {
  mcp: /\bmcp\b|model context protocol/i,
  api: /\bapis?\b/i,
  cli: /\bcli\b|command[- ]line|\bnpx\b|\bnpm\b/i,
}

/**
 * What a quote holds for each engine's common name, since a page writes one
 * engine many ways ("Google AIO", "Copilot"). A name outside these is held as
 * it is written, and Bing's AI Mode is Microsoft's, never Google's.
 */
const ENGINE_WORDS = {
  ChatGPT: /chat\s?gpt/i,
  'Google AI Overviews': /\bai[\s-]?overviews?\b|\baio\b/i,
  'Google AI Mode': /(?<!bing[\s-])\bai[\s-]?mode\b/i,
  Gemini: /\bgemini\b/i,
  Perplexity: /\bperplexity\b/i,
  Claude: /\bclaude\b/i,
  'Microsoft Copilot': /\bco-?pilot\b/i,
  Grok: /\bgrok\b/i,
  DeepSeek: /\bdeep\s?seek\b/i,
  'Meta AI': /\bmeta ai\b/i,
  Mistral: /\bmistral\b/i,
}
const holdsEngine = (quote, name) => (ENGINE_WORDS[name] ?? new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).test(quote)

/** A price as the table and a check write it: whole dollars, or cents to two places. */
const amountOf = (price) => (Number.isInteger(price) ? String(price) : price.toFixed(2))

const isDay = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const day = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(day.getTime()) && day.toISOString().startsWith(value)
}
const isPage = (value) => {
  try {
    return typeof value === 'string' && new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
const isText = (value, max) => typeof value === 'string' && value.trim() !== '' && value.length <= max

/** Whether a page is the tool's own: on its site's domain or under it, or on a place its `domains` names (a host, or a host and path, such as github.com/acme). */
const ownPage = (tool, page) => {
  const url = new URL(page)
  const host = url.host.replace(/^www\./, '')
  const own = [new URL(tool.url).host.replace(/^www\./, ''), ...(tool.domains ?? [])]
  return own.some((place) => {
    const [base, ...path] = place.split('/')
    const onHost = host === base || host.endsWith(`.${base}`)
    return onHost && (!path.length || `${url.pathname}/`.startsWith(`/${path.join('/')}/`))
  })
}

/** Every rule a tool breaks, each a line that names it. */
const problemsOf = (tool, i) => {
  const at = `tools[${i}] ${typeof tool?.name === 'string' ? tool.name : ''}`.trim()
  const problems = []
  const say = (what) => problems.push(`${at}: ${what}`)
  if (!isText(tool?.name, 60)) say('no name')
  if (!isPage(tool?.url)) return [...problems, `${at}: no https url`]
  if (!isDay(tool.checked)) say(`checked "${tool.checked}" isn't a day (YYYY-MM-DD)`)
  else if (tool.checked > new Date().toISOString().slice(0, 10)) say(`checked ${tool.checked} is after today`)
  if (!Array.isArray(tool.sources) || !tool.sources.length || !tool.sources.every(isPage)) say('sources must list the https pages it was read from')
  for (const page of tool.sources ?? []) if (isPage(page) && !ownPage(tool, page)) say(`source ${page} isn't one of the tool's own pages`)
  if (tool.domains !== undefined && (!Array.isArray(tool.domains) || !tool.domains.every((place) => isText(place, 100)))) say('domains must list hosts')
  if (tool.ours !== undefined && tool.ours !== true) say('ours is true or left out')
  const cited = (field, value) => {
    if (!isPage(value.url)) return say(`${field} needs the page it was read on (url)`)
    if (!(tool.sources ?? []).includes(value.url)) say(`${field}: its page ${value.url} isn't in sources`)
    if (!isText(value.quote, 300)) say(`${field} needs the words on that page behind it (quote, at most 300 characters)`)
    if (value.note !== undefined && !isText(value.note, 60)) say(`${field}: its note is a line of 60 characters at most`)
  }
  for (const [field, label] of ACCESS) {
    const value = tool[field]
    if (typeof value?.has !== 'boolean') say(`${field} needs has: true or false (${label})`)
    else if (value.has) {
      cited(field, value)
      if (isText(value.quote, 300) && !ACCESS_WORDS[field].test(value.quote)) say(`${field}: its quote names no ${label}`)
    } else if (value.url !== undefined || value.quote !== undefined || value.note !== undefined) say(`${field} is false, so it cites nothing`)
  }
  const entry = tool.entry
  if (typeof entry !== 'object' || entry === null) say('no entry plan')
  else {
    if (!isText(entry.plan, 40)) say("entry needs the plan's name")
    if (entry.price === null) {
      if (entry.billed !== null || entry.currency !== null) say('entry has no price, so billed and currency are null')
    } else {
      if (typeof entry.price !== 'number' || !(entry.price >= 0)) say('entry.price is a number, or null when the page gives no price')
      else if (entry.price > 0 && entry.billed !== 'monthly' && entry.billed !== 'yearly') say('entry.billed is monthly or yearly: how the page bills that monthly price')
      if (!Object.hasOwn(CURRENCIES, entry.currency)) say(`entry.currency is one of ${Object.keys(CURRENCIES).join(', ')}`)
    }
    cited('entry', entry)
    if (isText(entry.quote, 300)) {
      if (isText(entry.plan, 40) && !entry.quote.toLowerCase().includes(entry.plan.toLowerCase())) say(`entry: its quote doesn't name the plan ${entry.plan}`)
      if (typeof entry.price === 'number' && entry.price >= 0 && !entry.quote.replace(/,/g, '').includes(amountOf(entry.price))) say(`entry: its quote doesn't hold the price ${amountOf(entry.price)}`)
    }
  }
  const engines = tool.engines
  if (typeof engines !== 'object' || engines === null || !Array.isArray(engines.names) || !engines.names.every((name) => isText(name, 40))) say('engines needs names, the AI engines its pages name')
  else if (engines.names.length) {
    cited('engines', engines)
    if (isText(engines.quote, 300)) for (const name of engines.names) if (!holdsEngine(engines.quote, name)) say(`engines: its quote doesn't name ${name}`)
  } else if (engines.url !== undefined || engines.quote !== undefined) say('engines names none, so it cites nothing')
  return problems
}

/** The list's own rules, then each tool's. */
const check = (data) => {
  const tools = data?.tools
  if (!Array.isArray(tools)) return ['data.json has no tools']
  const problems = tools.flatMap(problemsOf)
  if (tools.length < MIN_TOOLS || tools.length > MAX_TOOLS) problems.push(`${tools.length} tools: the list holds ${MIN_TOOLS} to ${MAX_TOOLS}`)
  const names = tools.map((tool) => String(tool?.name).toLowerCase())
  for (const name of new Set(names.filter((name, i) => names.indexOf(name) !== i))) problems.push(`${name} is in the list twice`)
  const ours = tools.filter((tool) => tool?.ours === true)
  if (ours.length !== 1 || ours[0].name !== 'supereo') problems.push('supereo, and only supereo, is ours: true')
  return problems
}

/**
 * The order the README states: supereo first, since superagnt makes it; then
 * the tools with an MCP server, then with an API, then with a CLI, then the
 * rest, each group A to Z.
 */
const group = (tool) => (tool.ours ? 0 : tool.mcp.has ? 1 : tool.api.has ? 2 : tool.cli.has ? 3 : 4)
const ordered = (tools) => [...tools].sort((a, b) => group(a) - group(b) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))

const cell = (text) => text.replace(/\|/g, '\\|')
const link = (text, url) => `[${cell(text)}](${url})`
const withNote = (text, note) => (note ? `${text}, ${cell(note)}` : text)

const priceOf = (entry) => {
  if (entry.price === null) return `No public price (${entry.plan})`
  if (entry.price === 0) return `Free (${entry.plan})`
  return `${CURRENCIES[entry.currency]}${amountOf(entry.price)}/mo${entry.billed === 'yearly' ? ' billed yearly' : ''} (${entry.plan})`
}

const rowOf = (tool) =>
  [
    link(tool.name, tool.url),
    ...ACCESS.map(([field]) => (tool[field].has ? withNote(link('Yes', tool[field].url), tool[field].note) : 'No')),
    withNote(link(priceOf(tool.entry), tool.entry.url), tool.entry.note),
    tool.engines.names.length ? withNote(link(tool.engines.names.join(', '), tool.engines.url), tool.engines.note) : 'Not named',
    tool.checked,
  ].join(' | ')

/** The table and the line over it, as README.md holds them between its markers. */
const tableOf = (data) => {
  const tools = ordered(data.tools)
  const days = [...new Set(tools.map((tool) => tool.checked))].sort()
  const when = days.length === 1 ? `on ${days[0]}` : `from ${days[0]} to ${days.at(-1)}`
  return [
    START,
    `${tools.length} tools, each read from its own pages ${when}.`,
    '',
    `| Tool | ${ACCESS.map(([, label]) => label).join(' | ')} | Entry plan | AI engines | Checked |`,
    `|---|${ACCESS.map(() => '---').join('|')}|---|---|---|`,
    ...tools.map((tool) => `| ${rowOf(tool)} |`),
    END,
  ].join('\n')
}

const main = () => {
  const checkOnly = process.argv.includes('--check')
  const data = JSON.parse(readFileSync(DATA, 'utf8'))
  const problems = check(data)
  const readme = readFileSync(README, 'utf8')
  const start = readme.indexOf(START)
  const end = readme.indexOf(END)
  if (start === -1 || end < start) problems.push(`README.md needs the markers ${START} and ${END}`)
  if (problems.length) {
    for (const problem of problems) console.error(`✗ ${problem}`)
    process.exit(1)
  }
  const written = `${readme.slice(0, start)}${tableOf(data)}${readme.slice(end + END.length)}`
  if (checkOnly) {
    if (written !== readme) {
      console.error("✗ README.md's table isn't data.json's: run node build.mjs")
      process.exit(1)
    }
    console.log(`✓ data.json: ${data.tools.length} tools, each with its sources, its checked day and the page and words behind every value; README.md's table is its own`)
    return
  }
  if (written !== readme) writeFileSync(README, written)
  console.log(`${written === readme ? 'README.md is up to date' : 'wrote README.md'}: ${data.tools.length} tools`)
}

main()
