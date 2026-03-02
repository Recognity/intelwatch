export function generateHtmlReport(data) {
  const date = new Date(data.generatedAt).toLocaleString();
  const totalChanges =
    data.competitors.reduce((s, c) => s + c.changes.length, 0) +
    data.keywords.reduce((s, k) => s + k.changes.length, 0) +
    data.brands.reduce((s, b) => s + b.changes.length, 0);

  const sortedCompetitors = [...data.competitors].sort((a, b) => b.threatScore - a.threatScore);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IntelWatch Report — ${date}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0f1117;
      --surface: #1a1d27;
      --surface2: #22263a;
      --border: #2d3148;
      --text: #e2e8f0;
      --text-muted: #8892a4;
      --accent: #6366f1;
      --accent2: #818cf8;
      --green: #22c55e;
      --yellow: #f59e0b;
      --red: #ef4444;
      --blue: #3b82f6;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      min-height: 100vh;
    }

    .header {
      background: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%);
      border-bottom: 1px solid var(--border);
      padding: 40px 48px;
      position: relative;
      overflow: hidden;
    }

    .header::before {
      content: '';
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: radial-gradient(circle at 30% 50%, rgba(99,102,241,0.15) 0%, transparent 50%);
      pointer-events: none;
    }

    .header-inner { position: relative; z-index: 1; max-width: 1200px; margin: 0 auto; }
    .header h1 { font-size: 2rem; font-weight: 700; letter-spacing: -0.5px; }
    .header h1 span { color: var(--accent2); }
    .header-meta { color: var(--text-muted); margin-top: 8px; font-size: 0.9rem; }
    .header-meta strong { color: var(--text); }

    .container { max-width: 1200px; margin: 0 auto; padding: 40px 48px; }

    /* Stats cards */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-bottom: 40px;
    }
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      text-align: center;
    }
    .stat-card .value { font-size: 2.5rem; font-weight: 700; color: var(--accent2); line-height: 1; }
    .stat-card .label { color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px; margin-top: 6px; }

    /* Sections */
    .section { margin-bottom: 48px; }
    .section-title {
      font-size: 1.3rem;
      font-weight: 700;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--text);
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }

    /* Cards */
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      margin-bottom: 20px;
      overflow: hidden;
    }
    .card-header {
      padding: 16px 20px;
      background: var(--surface2);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .card-header h3 { font-size: 1rem; font-weight: 600; }
    .card-header a { color: var(--accent2); text-decoration: none; }
    .card-header a:hover { text-decoration: underline; }
    .card-body { padding: 20px; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th {
      text-align: left;
      padding: 10px 14px;
      background: var(--surface2);
      color: var(--text-muted);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
      border-bottom: 1px solid var(--border);
    }
    td { padding: 10px 14px; border-bottom: 1px solid var(--border); vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(255,255,255,0.02); }

    /* Badges */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 10px;
      border-radius: 100px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge-high { background: rgba(239,68,68,0.15); color: #fca5a5; border: 1px solid rgba(239,68,68,0.3); }
    .badge-med { background: rgba(245,158,11,0.15); color: #fcd34d; border: 1px solid rgba(245,158,11,0.3); }
    .badge-low { background: rgba(34,197,94,0.15); color: #86efac; border: 1px solid rgba(34,197,94,0.3); }
    .badge-new { background: rgba(34,197,94,0.1); color: var(--green); }
    .badge-changed { background: rgba(245,158,11,0.1); color: var(--yellow); }
    .badge-removed { background: rgba(239,68,68,0.1); color: var(--red); }
    .badge-neutral { background: rgba(99,102,241,0.1); color: var(--accent2); }

    /* Changes list */
    .changes { list-style: none; }
    .changes li {
      padding: 8px 0;
      border-bottom: 1px solid var(--border);
      font-size: 0.875rem;
      display: flex;
      gap: 10px;
      align-items: baseline;
    }
    .changes li:last-child { border-bottom: none; }
    .change-field { color: var(--text-muted); min-width: 120px; font-size: 0.8rem; }
    .change-value { color: var(--text); }

    /* Tech pills */
    .tech-pills { display: flex; flex-wrap: wrap; gap: 6px; }
    .tech-pill {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 3px 10px;
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .tech-pill:hover { border-color: var(--accent); color: var(--text); }

    /* Social links */
    .social-links { display: flex; flex-wrap: wrap; gap: 8px; }
    .social-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 12px;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 0.8rem;
      color: var(--accent2);
      text-decoration: none;
    }
    .social-link:hover { border-color: var(--accent); }

    /* Mentions */
    .mention {
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 8px;
      background: var(--surface2);
    }
    .mention-title { font-weight: 500; margin-bottom: 4px; }
    .mention-title a { color: var(--accent2); text-decoration: none; }
    .mention-title a:hover { text-decoration: underline; }
    .mention-meta { font-size: 0.8rem; color: var(--text-muted); display: flex; gap: 12px; }
    .mention.negative { border-left: 3px solid var(--red); }
    .mention.positive { border-left: 3px solid var(--green); }

    /* Rankings table */
    .rank-num { font-weight: 700; color: var(--accent2); min-width: 30px; }
    .rank-domain { font-weight: 500; }
    .rank-title { color: var(--text-muted); font-size: 0.82rem; }
    .featured { color: var(--yellow); font-size: 0.75rem; }

    /* Empty state */
    .empty { color: var(--text-muted); font-style: italic; padding: 20px 0; text-align: center; }

    /* Grid 2 cols */
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 768px) { .grid-2 { grid-template-columns: 1fr; } }

    .meta-item { margin-bottom: 8px; font-size: 0.875rem; }
    .meta-label { color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; }
    .meta-value { margin-top: 2px; }

    .footer {
      text-align: center;
      padding: 32px;
      color: var(--text-muted);
      font-size: 0.8rem;
      border-top: 1px solid var(--border);
      margin-top: 40px;
    }
    .footer a { color: var(--accent2); text-decoration: none; }
  </style>
</head>
<body>

<div class="header">
  <div class="header-inner">
    <h1>🔍 <span>Intel</span>Watch</h1>
    <div class="header-meta">
      Intelligence Report &nbsp;·&nbsp; Generated <strong>${date}</strong>
    </div>
  </div>
</div>

<div class="container">

  <!-- Stats -->
  <div class="stats-grid">
    <div class="stat-card">
      <div class="value">${data.competitors.length}</div>
      <div class="label">Competitors</div>
    </div>
    <div class="stat-card">
      <div class="value">${data.keywords.length}</div>
      <div class="label">Keywords</div>
    </div>
    <div class="stat-card">
      <div class="value">${data.brands.length}</div>
      <div class="label">Brands</div>
    </div>
    <div class="stat-card">
      <div class="value">${totalChanges}</div>
      <div class="label">Changes</div>
    </div>
  </div>

  ${data.competitors.length > 0 ? `
  <!-- Competitors Section -->
  <div class="section">
    <div class="section-title">🏢 Competitors</div>

    <!-- Threat Matrix -->
    <div class="card" style="margin-bottom: 32px;">
      <div class="card-header"><h3>Threat Matrix</h3></div>
      <table>
        <thead><tr>
          <th>Competitor</th>
          <th>Threat Level</th>
          <th>Pages</th>
          <th>Tech</th>
          <th>Jobs</th>
          <th>Changes</th>
        </tr></thead>
        <tbody>
          ${sortedCompetitors.map(({ tracker, snapshot, changes, threatScore }) => {
            const threat = threatScore >= 8 ? '<span class="badge badge-high">🔴 HIGH</span>'
              : threatScore >= 4 ? '<span class="badge badge-med">🟡 MED</span>'
              : '<span class="badge badge-low">🟢 LOW</span>';
            return `<tr>
              <td><a href="${tracker.url}" target="_blank" rel="noopener" style="color:var(--accent2)">${tracker.name || tracker.url}</a></td>
              <td>${threat} <span style="color:var(--text-muted);font-size:0.8rem;">${threatScore}/10</span></td>
              <td>${snapshot.pageCount || 0}</td>
              <td>${(snapshot.techStack || []).length}</td>
              <td>${snapshot.jobs?.estimatedOpenings ?? '?'}</td>
              <td><strong style="color:${changes.length > 0 ? 'var(--yellow)' : 'var(--text-muted)'}">${changes.length}</strong></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    ${data.competitors.map(({ tracker, snapshot, changes, threatScore }) => `
    <div class="card">
      <div class="card-header">
        <h3><a href="${tracker.url}" target="_blank" rel="noopener">${tracker.name || tracker.url}</a></h3>
        ${threatScore >= 8 ? '<span class="badge badge-high">🔴 HIGH THREAT</span>'
          : threatScore >= 4 ? '<span class="badge badge-med">🟡 MEDIUM THREAT</span>'
          : '<span class="badge badge-low">🟢 LOW THREAT</span>'}
      </div>
      <div class="card-body">
        <div class="grid-2">
          <div>
            <div class="meta-item">
              <div class="meta-label">URL</div>
              <div class="meta-value"><a href="${tracker.url}" target="_blank" style="color:var(--accent2)">${tracker.url}</a></div>
            </div>
            <div class="meta-item">
              <div class="meta-label">Last checked</div>
              <div class="meta-value">${new Date(snapshot.checkedAt).toLocaleString()}</div>
            </div>
            <div class="meta-item">
              <div class="meta-label">Pages found</div>
              <div class="meta-value">${snapshot.pageCount || 0}</div>
            </div>
            ${snapshot.jobs ? `
            <div class="meta-item">
              <div class="meta-label">Open positions</div>
              <div class="meta-value">~${snapshot.jobs.estimatedOpenings} (<a href="${snapshot.jobs.url}" target="_blank" style="color:var(--accent2)">see jobs</a>)</div>
            </div>` : ''}
            ${snapshot.pricing?.prices?.length > 0 ? `
            <div class="meta-item">
              <div class="meta-label">Pricing detected</div>
              <div class="meta-value" style="color:var(--green)">${snapshot.pricing.prices.slice(0, 5).join(' · ')}</div>
            </div>` : ''}
            ${snapshot.keyPages?.['/']?.title ? `
            <div class="meta-item">
              <div class="meta-label">Homepage title</div>
              <div class="meta-value" style="color:var(--text-muted)">${escHtml(snapshot.keyPages['/'].title)}</div>
            </div>` : ''}
          </div>
          <div>
            ${snapshot.techStack?.length > 0 ? `
            <div class="meta-label" style="margin-bottom:8px;">Tech Stack</div>
            <div class="tech-pills">
              ${snapshot.techStack.map(t => `<span class="tech-pill" title="${t.category}">${t.name}</span>`).join('')}
            </div>` : '<div class="meta-label">No tech detected</div>'}

            ${Object.keys(snapshot.socialLinks || {}).length > 0 ? `
            <div class="meta-label" style="margin-top:16px;margin-bottom:8px;">Social</div>
            <div class="social-links">
              ${Object.entries(snapshot.socialLinks).map(([platform, url]) =>
                `<a href="${url}" target="_blank" class="social-link">${platform}</a>`
              ).join('')}
            </div>` : ''}
          </div>
        </div>

        ${changes.length > 0 ? `
        <div style="margin-top:20px;">
          <div class="meta-label" style="margin-bottom:8px;">Changes (${changes.length})</div>
          <ul class="changes">
            ${changes.map(c => {
              const badgeClass = c.type === 'new' ? 'badge-new' : c.type === 'removed' ? 'badge-removed' : 'badge-changed';
              const icon = c.type === 'new' ? '+ NEW' : c.type === 'removed' ? '- REM' : '~ CHG';
              return `<li>
                <span class="badge ${badgeClass}">${icon}</span>
                <span class="change-field">${escHtml(c.field)}</span>
                <span class="change-value">${escHtml(c.value || '')}</span>
              </li>`;
            }).join('')}
          </ul>
        </div>` : '<div style="margin-top:16px;color:var(--text-muted);font-size:0.875rem;">✓ No changes detected</div>'}
      </div>
    </div>`).join('')}
  </div>` : ''}

  ${data.keywords.length > 0 ? `
  <!-- Keywords Section -->
  <div class="section">
    <div class="section-title">🔍 Keyword Rankings</div>
    ${data.keywords.map(({ tracker, snapshot, changes }) => `
    <div class="card">
      <div class="card-header">
        <h3>"${escHtml(tracker.keyword)}"</h3>
        <span style="color:var(--text-muted);font-size:0.8rem;">${snapshot.resultCount || 0} results · ${new Date(snapshot.checkedAt).toLocaleDateString()}</span>
      </div>
      <div class="card-body">
        ${changes.length > 0 ? `
        <div style="margin-bottom:16px;">
          <div class="meta-label" style="margin-bottom:8px;">Changes</div>
          <ul class="changes">
            ${changes.slice(0, 10).map(c => {
              const badgeClass = c.type === 'new' ? 'badge-new' : c.type === 'removed' ? 'badge-removed' : 'badge-changed';
              const icon = c.type === 'new' ? '+ NEW' : c.type === 'removed' ? '- REM' : '~ CHG';
              return `<li><span class="badge ${badgeClass}">${icon}</span><span class="change-value">${escHtml(c.value || '')}</span></li>`;
            }).join('')}
          </ul>
        </div>` : ''}

        ${snapshot.results?.length > 0 ? `
        <table>
          <thead><tr>
            <th style="width:50px">#</th>
            <th>Domain</th>
            <th>Title</th>
          </tr></thead>
          <tbody>
            ${snapshot.results.slice(0, 10).map(r => `
            <tr>
              <td class="rank-num">${r.position}</td>
              <td class="rank-domain">${escHtml(r.domain)}${r.isFeaturedSnippet ? ' <span class="featured">⭐ Featured</span>' : ''}</td>
              <td class="rank-title">${escHtml((r.title || '').slice(0, 80))}</td>
            </tr>`).join('')}
          </tbody>
        </table>` : '<div class="empty">No results data available</div>'}
      </div>
    </div>`).join('')}
  </div>` : ''}

  ${data.brands.length > 0 ? `
  <!-- Brands Section -->
  <div class="section">
    <div class="section-title">📣 Brand Mentions</div>
    ${data.brands.map(({ tracker, snapshot, changes }) => {
      const mentions = snapshot.mentions || [];
      const negative = mentions.filter(m => m.sentiment === 'negative' || m.sentiment === 'slightly_negative');
      const positive = mentions.filter(m => m.sentiment === 'positive' || m.sentiment === 'slightly_positive');

      return `
    <div class="card">
      <div class="card-header">
        <h3>"${escHtml(tracker.brandName)}"</h3>
        <div style="display:flex;gap:8px;">
          <span class="badge badge-low">😊 ${positive.length} pos</span>
          ${negative.length > 0 ? `<span class="badge badge-high">😞 ${negative.length} neg</span>` : ''}
          <span class="badge badge-neutral">${snapshot.mentionCount || 0} total</span>
        </div>
      </div>
      <div class="card-body">
        ${negative.length > 0 ? `
        <div style="margin-bottom:20px;">
          <div class="meta-label" style="margin-bottom:8px;color:var(--red);">⚠ Negative mentions</div>
          ${negative.slice(0, 3).map(m => `
          <div class="mention negative">
            <div class="mention-title"><a href="${m.url}" target="_blank">${escHtml((m.title || m.url).slice(0, 100))}</a></div>
            <div class="mention-meta">
              <span>${escHtml(m.domain)}</span>
              <span>${m.category}</span>
            </div>
          </div>`).join('')}
        </div>` : ''}

        ${mentions.length > 0 ? `
        <div class="meta-label" style="margin-bottom:8px;">Recent mentions</div>
        ${mentions.slice(0, 8).map(m => {
          const sentClass = m.sentiment?.includes('negative') ? 'negative' : m.sentiment?.includes('positive') ? 'positive' : '';
          const sentEmoji = m.sentiment === 'positive' ? '😊' : m.sentiment === 'negative' ? '😞' : '😐';
          return `
        <div class="mention ${sentClass}">
          <div class="mention-title">${sentEmoji} <a href="${m.url}" target="_blank">${escHtml((m.title || m.url).slice(0, 100))}</a></div>
          <div class="mention-meta">
            <span>${escHtml(m.domain)}</span>
            <span>${m.category}</span>
            <span>${m.source === 'google_news' ? '📰 News' : '🌐 Web'}</span>
          </div>
        </div>`;
        }).join('')}` : '<div class="empty">No mentions found yet</div>'}
      </div>
    </div>`;
    }).join('')}
  </div>` : ''}

</div>

<div class="footer">
  Generated by <a href="https://github.com/intelwatch/intelwatch">intelwatch</a> — competitive intelligence from the terminal
</div>

</body>
</html>`;
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
