import chalk from 'chalk';
import Table from 'cli-table3';

export function createTable(headers, options = {}) {
  return new Table({
    head: headers.map(h => chalk.cyan.bold(h)),
    style: { head: [], border: ['grey'] },
    ...options,
  });
}

export function formatDate(dateStr) {
  if (!dateStr) return chalk.gray('never');
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);

  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function statusBadge(status) {
  switch (status) {
    case 'active': return chalk.green('● active');
    case 'error': return chalk.red('● error');
    case 'checking': return chalk.yellow('● checking');
    default: return chalk.gray('○ ' + status);
  }
}

export function changeBadge(type) {
  switch (type) {
    case 'new': return chalk.green('+ NEW');
    case 'changed': return chalk.yellow('~ CHG');
    case 'removed': return chalk.red('- REM');
    default: return chalk.gray('  ---');
  }
}

export function diffLine(type, label, value = '') {
  const badge = changeBadge(type);
  const truncated = value.length > 80 ? value.slice(0, 77) + '...' : value;
  switch (type) {
    case 'new': return `${badge} ${chalk.green(label)}: ${chalk.gray(truncated)}`;
    case 'changed': return `${badge} ${chalk.yellow(label)}: ${chalk.gray(truncated)}`;
    case 'removed': return `${badge} ${chalk.red(label)}: ${chalk.gray(truncated)}`;
    default: return `    ${chalk.gray(label)}: ${truncated}`;
  }
}

export function header(text) {
  const line = '─'.repeat(Math.min(60, process.stdout.columns || 60));
  console.log('\n' + chalk.cyan.bold(text));
  console.log(chalk.gray(line));
}

export function section(text) {
  console.log('\n' + chalk.bold(text));
}

export function info(text) {
  console.log(chalk.gray(text));
}

export function success(text) {
  console.log(chalk.green('✓ ') + text);
}

export function warn(text) {
  console.log(chalk.yellow('⚠ ') + text);
}

export function error(text) {
  console.log(chalk.red('✗ ') + text);
}

export function trackerTypeIcon(type) {
  switch (type) {
    case 'competitor': return '🏢';
    case 'keyword': return '🔍';
    case 'brand': return '📣';
    default: return '📌';
  }
}

export function threatLevel(score) {
  if (score >= 8) return chalk.red('🔴 HIGH');
  if (score >= 4) return chalk.yellow('🟡 MED');
  return chalk.green('🟢 LOW');
}

export function printJson(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

export function truncate(str, len = 60) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len - 3) + '...' : str;
}
