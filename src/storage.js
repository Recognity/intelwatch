import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

const BASE_DIR = join(homedir(), '.intelwatch');
const TRACKERS_FILE = join(BASE_DIR, 'trackers.json');
const SNAPSHOTS_DIR = join(BASE_DIR, 'snapshots');
const REPORTS_DIR = join(BASE_DIR, 'reports');

export function ensureDirectories() {
  for (const dir of [BASE_DIR, SNAPSHOTS_DIR, REPORTS_DIR]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

export function loadTrackers() {
  ensureDirectories();
  if (!existsSync(TRACKERS_FILE)) {
    return [];
  }
  try {
    return JSON.parse(readFileSync(TRACKERS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

export function saveTrackers(trackers) {
  ensureDirectories();
  writeFileSync(TRACKERS_FILE, JSON.stringify(trackers, null, 2), 'utf8');
}

export function createTracker(type, data) {
  const trackers = loadTrackers();
  const id = generateId(type, data);

  const existing = trackers.find(t => t.id === id);
  if (existing) {
    return { tracker: existing, created: false };
  }

  const tracker = {
    id,
    type,
    createdAt: new Date().toISOString(),
    lastCheckedAt: null,
    status: 'active',
    checkCount: 0,
    ...data,
  };

  trackers.push(tracker);
  saveTrackers(trackers);
  return { tracker, created: true };
}

export function getTracker(id) {
  const trackers = loadTrackers();
  return trackers.find(t => t.id === id) || null;
}

export function updateTracker(id, updates) {
  const trackers = loadTrackers();
  const idx = trackers.findIndex(t => t.id === id);
  if (idx === -1) throw new Error(`Tracker not found: ${id}`);
  trackers[idx] = { ...trackers[idx], ...updates };
  saveTrackers(trackers);
  return trackers[idx];
}

export function removeTracker(id) {
  const trackers = loadTrackers();
  const idx = trackers.findIndex(t => t.id === id);
  if (idx === -1) throw new Error(`Tracker not found: ${id}`);
  const removed = trackers.splice(idx, 1)[0];
  saveTrackers(trackers);
  return removed;
}

export function saveSnapshot(trackerId, snapshot) {
  ensureDirectories();
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${trackerId}-${date}-${Date.now()}.json`;
  const filepath = join(SNAPSHOTS_DIR, filename);
  writeFileSync(filepath, JSON.stringify(snapshot, null, 2), 'utf8');
  return filepath;
}

export function loadLatestSnapshot(trackerId) {
  const snapshots = listSnapshots(trackerId);
  if (snapshots.length === 0) return null;
  const latest = snapshots[snapshots.length - 1];
  return loadSnapshot(latest.filepath);
}

export function loadSnapshot(filepath) {
  try {
    return JSON.parse(readFileSync(filepath, 'utf8'));
  } catch {
    return null;
  }
}

export function listSnapshots(trackerId, limit = null) {
  ensureDirectories();
  const files = readdirSync(SNAPSHOTS_DIR)
    .filter(f => f.startsWith(trackerId + '-') && f.endsWith('.json'))
    .sort();

  const snapshots = files.map(f => {
    const filepath = join(SNAPSHOTS_DIR, f);
    const parts = f.replace('.json', '').split('-');
    // Format: trackerId-YYYY-MM-DD-timestamp.json
    // trackerId may contain dashes, so parse from the end
    const timestamp = parseInt(parts[parts.length - 1]);
    return { filename: f, filepath, timestamp, date: parts.slice(-4, -1).join('-') };
  }).sort((a, b) => a.timestamp - b.timestamp);

  if (limit) return snapshots.slice(-limit);
  return snapshots;
}

export function loadSnapshotByDate(trackerId, targetDate) {
  const snapshots = listSnapshots(trackerId);
  // Find closest snapshot to targetDate
  const target = new Date(targetDate).getTime();
  let closest = null;
  let minDiff = Infinity;

  for (const s of snapshots) {
    const diff = Math.abs(s.timestamp - target);
    if (diff < minDiff) {
      minDiff = diff;
      closest = s;
    }
  }

  if (!closest) return null;
  return loadSnapshot(closest.filepath);
}

export function saveReport(filename, content) {
  ensureDirectories();
  const filepath = join(REPORTS_DIR, filename);
  writeFileSync(filepath, content, 'utf8');
  return filepath;
}

function generateId(type, data) {
  const base = type === 'competitor' ? slugify(data.url)
    : type === 'keyword' ? 'kw-' + slugify(data.keyword)
    : 'brand-' + slugify(data.brandName);
  return base.slice(0, 50);
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export { BASE_DIR, SNAPSHOTS_DIR, REPORTS_DIR };
