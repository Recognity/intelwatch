# intelwatch AI Layer — BYOK Implementation

## Overview
Add AI-powered analysis and strategic recommendations to intelwatch.

## AI Config
Same BYOK pattern:
```yaml
# ~/.intelwatch/config.yml
ai:
  provider: openai
  api_key: sk-xxx
  model: gpt-4o-mini
```

## New/Enhanced Commands

### `intelwatch ai-summary [--tracker <id>]`
Instead of raw data tables, generates a natural language intelligence brief:

```
📊 Weekly Intelligence Brief — March 2, 2026

GIFI (gifi.fr):
GIFI had a rough week. A product recall for children's toys containing 
asbestos traces dominated press coverage (reported by franceinfo, Le Monde).
They closed their Meyzieu location. On the positive side, their €0.79 
solar garden lights went viral on social media. Their website remains 
technically weak (no HSTS, 671KB uncompressed HTML, 14 images without alt).

Recommendation: If you compete with GIFI, now is the time to push on 
safety messaging and technical SEO advantage.
```

### `intelwatch ai-brief --market <niche>`
Full market analysis:
- Identifies top 10 players via Brave Search
- Auto-creates competitor trackers for each
- Runs initial checks
- AI generates a market overview: who dominates, gaps, opportunities

### `intelwatch pitch <competitor> [--for <your-site>]`
Generates a competitive pitch document:
- "Here's why [your-site] is better/worse than [competitor] on these points"
- Includes specific data from the latest check
- Sales-ready format (can be sent to prospects)
- Markdown or HTML output

### `intelwatch ai-predict <tracker-id>`
Based on historical snapshots, AI analyzes trends:
- "GIFI has been adding ~15 new pages/week for the last month"
- "Their press sentiment is trending negative since the toy recall"
- "They're likely preparing a spring campaign (new garden category pages)"

## Enhanced `intelwatch digest` with AI
When AI key is set, digest includes:
- Natural language summary instead of raw change list
- Threat assessment per competitor
- Recommended actions
- One-liner you can forward to your team

## AI Client
Shared pattern with seoscan/wpfleet.

## Constraints
- AI optional, raw data always available without key
- Cost estimate shown
- AI summaries cached (don't regenerate for same snapshot)
- Market brief limited to 10 competitors (cost control)

## Done Criteria
- `intelwatch ai-summary` generates readable intelligence brief
- `intelwatch pitch` generates sales-ready competitor comparison
- `intelwatch digest` enhanced with AI when key present
- Works with OpenAI and Anthropic
