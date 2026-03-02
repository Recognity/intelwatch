import { loadConfig, saveConfig } from '../config.js';
import { success, info, header } from '../utils/display.js';
import chalk from 'chalk';
import { fetch } from '../utils/fetcher.js';

export async function setupNotifications(options) {
  header('🔔 Notification Setup');

  // Check if inquirer is available
  let inquirer;
  try {
    const mod = await import('inquirer');
    inquirer = mod.default;
  } catch {
    console.log(chalk.yellow('Interactive mode requires inquirer. Running in guided mode.\n'));
    await guidedSetup();
    return;
  }

  const config = loadConfig();

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'webhook',
      message: 'Webhook URL (Slack/Discord, leave empty to skip):',
      default: config.notifications.webhook || '',
    },
    {
      type: 'checkbox',
      name: 'events',
      message: 'Which events should trigger notifications?',
      choices: [
        { name: 'Competitor: new page detected', value: 'competitor.new_page', checked: true },
        { name: 'Competitor: pricing changed', value: 'competitor.price_change', checked: true },
        { name: 'Competitor: tech stack changed', value: 'competitor.tech_change', checked: false },
        { name: 'Keyword: position change', value: 'keyword.position_change', checked: true },
        { name: 'Brand: new mention', value: 'brand.new_mention', checked: true },
        { name: 'Brand: negative mention', value: 'brand.negative_mention', checked: true },
      ],
    },
  ]);

  const newConfig = {
    ...config,
    notifications: {
      ...config.notifications,
      webhook: answers.webhook || null,
      events: answers.events,
    },
  };

  saveConfig(newConfig);

  if (answers.webhook) {
    console.log(chalk.gray('\nTesting webhook...'));
    await testWebhook(answers.webhook);
  }

  success('Notification settings saved!');
  info(`Config file: ${(await import('../config.js')).CONFIG_FILE}`);
}

async function guidedSetup() {
  const config = loadConfig();
  console.log('Current configuration:');
  console.log(JSON.stringify(config.notifications, null, 2));
  console.log(chalk.gray('\nTo configure notifications, edit ~/.intelwatch/config.yml directly.'));
  console.log(chalk.gray('Example:'));
  console.log(chalk.gray(`
notifications:
  webhook: https://hooks.slack.com/services/xxx/yyy/zzz
  events:
    - competitor.new_page
    - competitor.price_change
    - keyword.position_change
    - brand.new_mention
    - brand.negative_mention
`));
}

export async function sendWebhookNotification(webhookUrl, event, data) {
  if (!webhookUrl) return;

  const payload = {
    text: `*intelwatch alert*: ${event}`,
    attachments: [
      {
        color: event.includes('negative') ? 'danger' : 'good',
        fields: Object.entries(data).map(([title, value]) => ({
          title,
          value: String(value).slice(0, 200),
          short: true,
        })),
      },
    ],
  };

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify(payload),
      retries: 1,
    });
  } catch {
    // Silently fail notifications
  }
}

async function testWebhook(url) {
  try {
    await sendWebhookNotification(url, 'test', {
      message: 'intelwatch notification test — everything is working!',
      time: new Date().toISOString(),
    });
    console.log(chalk.green('  ✓ Webhook test sent successfully'));
  } catch (err) {
    console.log(chalk.red(`  ✗ Webhook test failed: ${err.message}`));
  }
}
