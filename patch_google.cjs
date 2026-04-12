const fs = require('fs');
const path = require('path');
const file = path.join(process.env.HOME, 'workspace/intelwatch/src/scrapers/searxng-search.js');
let code = fs.readFileSync(file, 'utf8');
code = code.replace(
  /const countMatch = text\.match\(.*(?:avis\|reviews\?\|évaluations\?)\/\);\n\s*if \(ratingMatch\) {/,
  'const countMatch = text.match(/(\\d[\\d\\s,.]*)\\s*(?:avis|reviews?|évaluations?)/);\n      if (ratingMatch) {'
);
code = code.replace(
  /const ratingMatch = text\.match\(\/.*\\d\[\.,\]\\d.*stars\?\|étoiles\?\)\/\);/,
  'const ratingMatch = text.match(/(\\d[.,]\\d)\\s*(?:\\/\\s*5|sur\\s*5|stars?|étoiles?)/);'
);
fs.writeFileSync(file, code);
