import { writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const POSTS_DIR = join(__dirname, '..', 'content', 'posts')

const ANGLES = [
  'new features or updates with upstream references',
  'development progress or roadmap with CVE mentions',
  'community highlights or contributions',
  'comparison to other operating systems',
  'tutorials or how-to tips with relevant CVEs',
  'philosophy and design decisions',
  'performance benchmarks or optimizations',
  'security or privacy aspects with current upstream CVEs',
]

type OpenRouterResponse = {
  error?: { message?: string }
  message?: string
  choices?: Array<{ message?: { content?: string } }>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isOpenRouterResponse(value: unknown): value is OpenRouterResponse {
  if (!isObject(value)) return false
  return true
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

async function runOpenRouter(prompt: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required')

  const model = process.env.OPENROUTER_MODEL || 'openrouter/free'
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  const rawBody = await response.text()
  let payload: OpenRouterResponse | null = null

  try {
    const parsed: unknown = JSON.parse(rawBody)
    payload = isOpenRouterResponse(parsed) ? parsed : null
  } catch {
    payload = null
  }

  if (!response.ok) {
    const responseSnippet = rawBody.slice(0, 500)
    throw new Error(
      payload?.error?.message ||
      payload?.message ||
      responseSnippet ||
      `OpenRouter request failed with status ${response.status}`,
    )
  }

  const output = payload?.choices?.[0]?.message?.content?.trim()
  if (!output) throw new Error('OpenRouter returned empty response')
  return output
}

async function main() {
  const angle = ANGLES[Math.floor(Math.random() * ANGLES.length)]
  const subject = process.env.CONTENT_PROMPT || 'acreetionos (acreetionos.org)'

  const now = new Date()
  const dateStr = now.toISOString().split('T')[0]

  const prompt = `[SYSTEM]
You are a markdown blog post generator for AcreetionOS. Your ENTIRE response must be ONLY the structured format below — no greetings, no explanations, no conversation, no backticks, no extra text whatsoever. Just the raw output.

[FORMAT]
TITLE: <the title>
DESCRIPTION: <one-line SEO description>
TAGS: <comma-separated tags>
CONTENT:
<full markdown content starting with ## heading>

[TOPIC]
Write about ${subject}, focusing on ${angle}.

Include: 3-5 substantive paragraphs, code snippets where relevant, reference to real CVEs. Technically accurate, informative, genuine open-source community voice.`

  console.log(`Generating post about "${subject}" (angle: ${angle})...`)
  const output = await runOpenRouter(prompt)

  // Try structured format first
  let title = 'Untitled Post'
  let description = 'A post about acreetionos.'
  let tags = ['update']
  let markdown = output

  const titleMatch = output.match(/^TITLE:\s*(.+)/im)
  const descMatch = output.match(/^DESCRIPTION:\s*(.+)/im)
  const tagsMatch = output.match(/^TAGS:\s*(.+)/im)

  // Find CONTENT: and take everything after it
  const contentSplit = output.split(/^CONTENT:\s*\n/im)
  const hasContent = contentSplit.length > 1

  if (titleMatch) title = titleMatch[1].trim()
  if (descMatch) description = descMatch[1].trim()
  if (tagsMatch) tags = tagsMatch[1].split(',').map((t) => t.trim())
  if (hasContent) markdown = contentSplit[1].trim()

  // Fallback: if no structured format was found, try to extract a title
  // from the first # Heading or first line
  if (!titleMatch && !hasContent) {
    const headingMatch = output.match(/^#\s+(.+)/m)
    if (headingMatch) title = headingMatch[1].trim()
    // Remove any conversational intro before the first heading
    const firstHeading = output.search(/^#/m)
    if (firstHeading > 0) markdown = output.slice(firstHeading).trim()
    else markdown = output
  }

  const slug = slugify(title)
  const filename = `${dateStr}-${slug}.md`

  const frontmatter = `---
title: "${title}"
description: "${description}"
pubDate: ${now.toISOString()}
tags:
${tags.map((t) => `  - ${t}`).join('\n')}
---

${markdown}
`

  await mkdir(POSTS_DIR, { recursive: true })
  const filepath = join(POSTS_DIR, filename)
  await writeFile(filepath, frontmatter, 'utf-8')

  console.log(`\n  ✓ Generated: ${filename}`)
  console.log(`  Title: ${title}`)
  console.log(`  Angle: ${angle}\n`)
}

main().catch((err) => {
  const error = (typeof err === 'object' && err !== null ? err : {}) as {
    message?: unknown
    stderr?: unknown
    stdout?: unknown
  }
  const toStringValue = (value: unknown) => {
    if (typeof value === 'string') return value
    if (value && typeof value === 'object') {
      try {
        return JSON.stringify(value)
      } catch {
        return String(value)
      }
    }
    return String(value ?? '')
  }
  const hasBillingBalanceError = (value: unknown) => {
    const text = toStringValue(value)
    return /billing.*insufficient balance|insufficient balance.*billing/i.test(text)
  }

  if ([error.message, error.stderr, error.stdout].some(hasBillingBalanceError)) {
    console.warn('Warning: OpenRouter billing balance is insufficient, skipping this generation run.')
    process.exit(0)
  }

  console.error(`Fatal: ${error.message || err}`)
  process.exit(1)
})
