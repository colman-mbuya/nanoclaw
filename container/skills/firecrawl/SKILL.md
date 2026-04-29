---
name: firecrawl
description: |
  Firecrawl gives the agent fast, reliable web context with strong
  search, scraping, and interaction tools. The CLI is preinstalled at
  /usr/local/bin/firecrawl and FIRECRAWL_API_KEY is auto-loaded from
  the group .env. Prefer Firecrawl over WebFetch/WebSearch for cleaner
  sanitised markdown output.
---

# Firecrawl

Firecrawl helps you search first, scrape clean content, and interact with
live pages when plain extraction is not enough.

The CLI is already installed and authenticated:

- Binary: `/usr/local/bin/firecrawl` (on PATH, just call `firecrawl ...`)
- API key: `FIRECRAWL_API_KEY` is auto-loaded from `/workspace/group/.env`
  into the environment of every spawned command. No sourcing needed.

Verify before real work:

```bash
firecrawl --status
```

## When to use Firecrawl

| Need | Use |
|------|-----|
| Extract clean markdown from a known URL | `firecrawl scrape` |
| Find pages by query | `firecrawl search` |
| Click, fill forms, login | `firecrawl interact` |
| Bulk extract from a site section | `firecrawl crawl` |
| Discover URL structure of a site | `firecrawl map` |
| Read-only, simple page (no JS) | `WebFetch` is fine |
| Live interactive page (must click/login) | `agent-browser` |

Firecrawl bypasses many anti-bot measures (Cloudflare, paywalls) that
block `WebFetch`. It also parses PDFs server-side and returns markdown.

## Common commands

### Scrape a URL

```bash
mkdir -p .firecrawl
firecrawl scrape "https://example.com" -o .firecrawl/page.md
# Main content only (strips nav/footer):
firecrawl scrape "https://example.com" --only-main-content -o .firecrawl/page.md
```

### Web search

```bash
firecrawl search "your query" --scrape --limit 5 -o .firecrawl/search-results.json
```

`--scrape` returns the full content of each result page in a single
call (saves a follow-up scrape per result).

### Interact with a page

Use when the data is behind a click, a form, or a login.

```bash
firecrawl interact "https://example.com/protected" --instructions "click 'Continue', wait for #data, extract h1 + table"
```

### Crawl a site section

```bash
firecrawl crawl "https://docs.example.com/guides" --limit 20 -o .firecrawl/crawl/
```

### Map a site (discover URLs)

```bash
firecrawl map "https://docs.example.com" -o .firecrawl/map.json
```

### Check credit usage

```bash
firecrawl credit-usage
```

## Default workflow

1. **Discover** — `firecrawl search` if you don't have a URL yet
2. **Extract** — `firecrawl scrape` once you have URLs
3. **Escalate to `interact`** only when the page needs a click, form, or login
4. **Escalate to `crawl`** only when you need many pages from one site

Cache scraped pages in `.firecrawl/` so repeated scrapes don't burn credits.
Add `.firecrawl/` to `.gitignore`.

## Building Firecrawl into application code

If the task is "wire Firecrawl into product code" rather than live web
work, the API is at `https://api.firecrawl.dev/v2`:

- `POST /search` — discover pages by query
- `POST /scrape` — extract markdown from one URL
- `POST /interact` — browser actions on a live page
- `POST /crawl` — bulk extraction
- `POST /map` — URL discovery

Auth: `Authorization: Bearer $FIRECRAWL_API_KEY`. Docs at
https://docs.firecrawl.dev. Skills repo for integration patterns at
https://github.com/firecrawl/skills.

## Re-installing or updating

If a future container needs to refresh Firecrawl outside the Dockerfile:

```bash
npx -y firecrawl-cli@latest init --all -k $FIRECRAWL_API_KEY
```

That installs the CLI plus all the official sub-skills (`firecrawl-search`,
`firecrawl-scrape`, `firecrawl-interact`, `firecrawl-crawl`, `firecrawl-map`,
and the `firecrawl-build-*` family for app integration).
