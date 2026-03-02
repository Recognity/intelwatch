export function generateMarkdownReport(data) {
  const lines = [];
  const date = new Date(data.generatedAt).toLocaleString();

  lines.push('# IntelWatch Intelligence Report');
  lines.push(`\n_Generated: ${date}_\n`);
  lines.push('---\n');

  // Summary
  const totalChanges =
    data.competitors.reduce((s, c) => s + c.changes.length, 0) +
    data.keywords.reduce((s, k) => s + k.changes.length, 0) +
    data.brands.reduce((s, b) => s + b.changes.length, 0);

  lines.push('## Summary\n');
  lines.push(`| Category | Tracked | Changes |`);
  lines.push(`|----------|---------|---------|`);
  lines.push(`| Competitors | ${data.competitors.length} | ${data.competitors.reduce((s, c) => s + c.changes.length, 0)} |`);
  lines.push(`| Keywords | ${data.keywords.length} | ${data.keywords.reduce((s, k) => s + k.changes.length, 0)} |`);
  lines.push(`| Brands | ${data.brands.length} | ${data.brands.reduce((s, b) => s + b.changes.length, 0)} |`);
  lines.push(`| **Total** | **${data.competitors.length + data.keywords.length + data.brands.length}** | **${totalChanges}** |`);
  lines.push('');

  // Competitor section
  if (data.competitors.length > 0) {
    lines.push('## Competitors\n');

    // Threat level table
    const sorted = [...data.competitors].sort((a, b) => b.threatScore - a.threatScore);
    lines.push('### Threat Levels\n');
    lines.push('| Competitor | Threat | Pages | Tech | Jobs | Changes |');
    lines.push('|------------|--------|-------|------|------|---------|');
    for (const { tracker, snapshot, changes, threatScore } of sorted) {
      const threat = threatScore >= 8 ? '🔴 HIGH' : threatScore >= 4 ? '🟡 MED' : '🟢 LOW';
      lines.push(
        `| [${tracker.name || tracker.url}](${tracker.url}) | ${threat} (${threatScore}/10) | ${snapshot.pageCount || 0} | ${(snapshot.techStack || []).length} | ${snapshot.jobs?.estimatedOpenings || '?'} | ${changes.length} |`
      );
    }
    lines.push('');

    for (const { tracker, snapshot, changes, threatScore } of data.competitors) {
      lines.push(`### ${tracker.name || tracker.url}`);
      lines.push(`\n- **URL:** ${tracker.url}`);
      lines.push(`- **Last checked:** ${new Date(snapshot.checkedAt).toLocaleString()}`);
      lines.push(`- **Pages:** ${snapshot.pageCount || 0}`);
      lines.push(`- **Threat score:** ${threatScore}/10`);

      if (snapshot.techStack?.length > 0) {
        const byCategory = {};
        for (const t of snapshot.techStack) {
          (byCategory[t.category] = byCategory[t.category] || []).push(t.name);
        }
        lines.push(`\n**Tech Stack:**`);
        for (const [cat, names] of Object.entries(byCategory)) {
          lines.push(`- ${cat}: ${names.join(', ')}`);
        }
      }

      if (snapshot.pricing?.prices?.length > 0) {
        lines.push(`\n**Pricing:** ${snapshot.pricing.prices.slice(0, 5).join(' | ')}`);
      }

      if (snapshot.jobs) {
        lines.push(`\n**Jobs:** ~${snapshot.jobs.estimatedOpenings} open positions (${snapshot.jobs.url})`);
      }

      const metaPage = snapshot.keyPages?.['/'];
      if (metaPage?.title) {
        lines.push(`\n**Homepage title:** ${metaPage.title}`);
      }

      if (changes.length > 0) {
        lines.push(`\n**Changes (${changes.length}):**`);
        for (const c of changes) {
          const emoji = c.type === 'new' ? '🟢' : c.type === 'removed' ? '🔴' : '🟡';
          lines.push(`- ${emoji} [${c.field}] ${c.value}`);
        }
      }

      lines.push('');
    }
  }

  // Keyword section
  if (data.keywords.length > 0) {
    lines.push('## Keyword Rankings\n');

    for (const { tracker, snapshot, changes } of data.keywords) {
      lines.push(`### "${tracker.keyword}"`);
      lines.push(`\n_Checked: ${new Date(snapshot.checkedAt).toLocaleString()}_\n`);

      if (snapshot.results?.length > 0) {
        lines.push('| # | Domain | Title |');
        lines.push('|---|--------|-------|');
        for (const r of snapshot.results.slice(0, 10)) {
          const star = r.isFeaturedSnippet ? ' ⭐' : '';
          lines.push(`| ${r.position} | ${r.domain}${star} | ${(r.title || '').slice(0, 60)} |`);
        }
        lines.push('');
      }

      if (changes.length > 0) {
        lines.push('**Changes:**');
        for (const c of changes) {
          const emoji = c.type === 'new' ? '🟢' : c.type === 'removed' ? '🔴' : '🟡';
          lines.push(`- ${emoji} ${c.value}`);
        }
      }

      lines.push('');
    }
  }

  // Brand section
  if (data.brands.length > 0) {
    lines.push('## Brand Mentions\n');

    for (const { tracker, snapshot, changes } of data.brands) {
      lines.push(`### "${tracker.brandName}"`);
      lines.push(`\n_${snapshot.mentionCount || 0} mentions found — checked: ${new Date(snapshot.checkedAt).toLocaleString()}_\n`);

      const mentions = snapshot.mentions || [];
      const negative = mentions.filter(m => m.sentiment === 'negative' || m.sentiment === 'slightly_negative');

      if (negative.length > 0) {
        lines.push(`⚠️ **${negative.length} negative mention(s) detected:**`);
        for (const m of negative.slice(0, 3)) {
          lines.push(`- [${m.title?.slice(0, 60)}](${m.url}) — ${m.domain}`);
        }
        lines.push('');
      }

      if (mentions.length > 0) {
        lines.push('**Recent mentions:**');
        for (const m of mentions.slice(0, 5)) {
          const sentEmoji = m.sentiment === 'positive' ? '😊' : m.sentiment === 'negative' ? '😞' : '😐';
          lines.push(`- ${sentEmoji} [${(m.title || m.url).slice(0, 80)}](${m.url}) [${m.category}]`);
        }
      }

      if (changes.length > 0) {
        lines.push('\n**New mentions:**');
        for (const c of changes.filter(c => c.field === 'mention')) {
          lines.push(`- 🟢 ${c.value}`);
        }
      }

      lines.push('');
    }
  }

  lines.push('---');
  lines.push('_Generated by [intelwatch](https://github.com/intelwatch/intelwatch) — competitive intelligence from the terminal_');

  return lines.join('\n');
}
