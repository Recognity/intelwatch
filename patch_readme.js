import fs from 'fs';

const file = 'README.md';
let content = fs.readFileSync(file, 'utf8');

const regexInstallation = /(## Installation[^#]+)/s;
const newInstallationBlock = \`## Installation

\`\`\`bash
npm install -g intelwatch

# 1. Run the interactive setup wizard to configure your APIs (OpenAI/Gemini, SearxNG, Pappers...)
intelwatch setup

# 2. Or run directly without installing (prompts will appear if needed):
npx intelwatch profile kpmg.fr --ai
\`\`\`

**Requirements:** Node.js >=18

### ⚡ Auto-Fallback & Zero-Cost Capabilities (v1.5+)
Intelwatch is designed to be usable **for free** without any API keys:
- **Web Search**: Uses a local \`SearxNG\` or local \`Camofox\` instance natively if no API key is provided.
- **Company Identity (Due Diligence)**: Automatically falls back to the French Open Data **Annuaire Entreprises** (\`data.gouv.fr\`) if no Pappers API key is present.
- **Bot Bypass**: Fully integrated with the \`Camofox\` bypass engine (over port 9377) to scrape strict sites (Cloudflare/Datadome) safely.

\`;

content = content.replace(regexInstallation, newInstallationBlock);
fs.writeFileSync(file, content);
