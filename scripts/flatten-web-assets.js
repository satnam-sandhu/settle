/**
 * Vercel (and similar hosts) skip any path containing `node_modules`.
 * Expo web export puts vector-icon fonts at /assets/node_modules/... which 404s.
 * Flatten that folder to /assets/vendor/ and rewrite hashed JS references.
 */
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const fromDir = path.join(dist, 'assets', 'node_modules');
const toDir = path.join(dist, 'assets', 'vendor');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (fs.existsSync(fromDir)) {
  copyDir(fromDir, toDir);
  fs.rmSync(fromDir, { recursive: true, force: true });

  const fromToken = '/assets/node_modules/';
  const toToken = '/assets/vendor/';
  let rewritten = 0;

  function rewriteFile(file) {
    const original = fs.readFileSync(file, 'utf8');
    if (!original.includes(fromToken)) return;
    fs.writeFileSync(file, original.split(fromToken).join(toToken));
    rewritten += 1;
  }

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(js|css|html|json)$/.test(entry.name)) rewriteFile(p);
    }
  }

  walk(path.join(dist, '_expo'));
  walk(path.join(dist));
  console.log(`[flatten-web-assets] moved fonts to assets/vendor; rewrote ${rewritten} files`);
} else {
  console.log('[flatten-web-assets] no assets/node_modules — skip font flatten');
}

fs.writeFileSync(
  path.join(dist, 'vercel.json'),
  JSON.stringify(
    {
      rewrites: [
        {
          source: '/((?!_expo/|assets/|sw\\.js|manifest\\.json|favicon.ico|logo.*\\.png).*)',
          destination: '/index.html',
        },
      ],
      headers: [
        {
          source: '/manifest.json',
          headers: [{ key: 'Content-Type', value: 'application/manifest+json' }],
        },
        {
          source: '/sw.js',
          headers: [
            { key: 'Content-Type', value: 'application/javascript' },
            { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
            { key: 'Service-Worker-Allowed', value: '/' },
          ],
        },
      ],
    },
    null,
    2
  )
);
