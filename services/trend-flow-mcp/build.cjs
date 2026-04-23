const esbuild = require('esbuild');
const fs = require('fs');

esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: 'dist/index.js',
  format: 'esm',
  minify: true,
  minifySyntax: true,
  minifyWhitespace: true,
  treeShaking: true,
  packages: 'external',
  banner: { js: '// AiModa - trend-flow-mcp\n// Trend Flow Management Service' },
  legalComments: 'none',
}).then(() => {
  const outfile = 'dist/index.js';
  let code = fs.readFileSync(outfile, 'utf-8');
  code = code.replace(/^#!.*\n/gm, '');
  code = '#!/usr/bin/env node\n' + code;
  fs.writeFileSync(outfile, code);
  console.log('✅ Bundle done → dist/index.js');
}).catch((e) => { console.error(e); process.exit(1); });
