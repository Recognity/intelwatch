export function generateJsonReport(data) {
  const report = {
    generatedAt: data.generatedAt,
    summary: {
      competitors: data.competitors.length,
      keywords: data.keywords.length,
      brands: data.brands.length,
      totalChanges:
        data.competitors.reduce((s, c) => s + c.changes.length, 0) +
        data.keywords.reduce((s, k) => s + k.changes.length, 0) +
        data.brands.reduce((s, b) => s + b.changes.length, 0),
    },
    competitors: data.competitors.map(({ tracker, snapshot, changes, threatScore }) => ({
      id: tracker.id,
      name: tracker.name,
      url: tracker.url,
      threatScore,
      checkedAt: snapshot.checkedAt,
      pageCount: snapshot.pageCount,
      techStack: snapshot.techStack,
      socialLinks: snapshot.socialLinks,
      pricing: snapshot.pricing,
      jobs: snapshot.jobs,
      changes,
    })),
    keywords: data.keywords.map(({ tracker, snapshot, changes }) => ({
      id: tracker.id,
      keyword: tracker.keyword,
      checkedAt: snapshot.checkedAt,
      topResults: (snapshot.results || []).slice(0, 10),
      changes,
    })),
    brands: data.brands.map(({ tracker, snapshot, changes }) => ({
      id: tracker.id,
      brandName: tracker.brandName,
      checkedAt: snapshot.checkedAt,
      mentionCount: snapshot.mentionCount,
      mentions: (snapshot.mentions || []).slice(0, 20),
      changes,
    })),
  };

  return JSON.stringify(report, null, 2);
}
