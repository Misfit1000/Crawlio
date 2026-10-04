import { access } from 'node:fs/promises';
// The public page builder already creates these shells; do not rewrite them or lose route CSS.
for (const route of ['', '/metadata','/structured-data','/robots','/headers']) await access(`dist/tools${route}/index.html`);
console.log('Verified tools directory and four standalone tool shells.');
