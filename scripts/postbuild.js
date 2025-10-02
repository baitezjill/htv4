const fs = require('fs');
const p = require('path');

// ensure dirs
fs.mkdirSync('dist/ui', { recursive: true });
fs.mkdirSync('dist/icons', { recursive: true });
fs.mkdirSync('dist/content-scripts', { recursive: true });

// NOTE: main-world-injector.js is now built by esbuild into dist/main-world-injector.js

// copy manifest
fs.copyFileSync('manifest.json', 'dist/manifest.json');

// copy & tweak UI html
if (fs.existsSync('ui/index.html')) {
  let html = fs.readFileSync('ui/index.html', 'utf8');
  html = html.replace('index.tsx', 'index.js').replace('/icons/icon-16.png', '/icons/icon32.svg');
  fs.writeFileSync('dist/ui/index.html', html);
}

// optional assets
if (fs.existsSync('ui/index.css')) fs.copyFileSync('ui/index.css', 'dist/ui/index.css');
if (fs.existsSync('src/offscreen.html')) fs.copyFileSync('src/offscreen.html', 'dist/offscreen.html');
if (fs.existsSync('src/offscreen.css')) fs.copyFileSync('src/offscreen.css', 'dist/offscreen.css');
if (fs.existsSync('src/oi.html')) fs.copyFileSync('src/oi.html', 'dist/oi.html');

// icons
const map = [[ 'icon-16.png','icon16.png' ],[ 'icon-48.png','icon48.png' ],[ 'icon-128.png','icon128.png' ]];
for (const [src,dst] of map) {
  if (fs.existsSync(src)) fs.copyFileSync(src, p.join('dist/icons', dst));
}
if (!fs.existsSync('dist/icons/icon32.svg')) fs.writeFileSync('dist/icons/icon32.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="100%" height="100%" fill="#764ba2"/><text x="50%" y="54%" font-family="Arial, Helvetica, sans-serif" font-size="10" text-anchor="middle" fill="#fff">HT</text></svg>');

console.log('[postbuild] Completed');
