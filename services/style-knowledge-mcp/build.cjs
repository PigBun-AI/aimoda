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
  minifyIdentifiers: true,
  minifySyntax: true,
  minifyWhitespace: true,
  treeShaking: true,
  // Externalize all npm packages — they'll be available via node_modules
  // in Docker. This avoids dynamic require() issues with express, MCP SDK
  // HTTP transport, and other deps that use Node built-ins.
  packages: 'external',
  banner: {
    js: '// AiModa - style-knowledge-mcp\n// Fashion Style Knowledge Base',
  },
  legalComments: 'none',
}).then(() => {
  const outfile = 'dist/index.js';
  let code = fs.readFileSync(outfile, 'utf-8');
  code = code.replace(/^#!.*\n/gm, '');
  code = '#!/usr/bin/env node\n' + code;
  fs.writeFileSync(outfile, code);
  console.log('✅ Bundle + minify done → dist/index.js');
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
