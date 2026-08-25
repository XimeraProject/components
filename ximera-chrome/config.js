// Default Ximera branding. A deployment that wants different chrome depends
// on a different package (e.g. mooculus-chrome) implementing the same hook
// interface — no config-overlay layer.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load an SVG file as an HTML-safe inline string: drop the XML prolog and
// DOCTYPE (not valid inside HTML), and strip absolute width/height on the
// root <svg> so CSS can size it via .ximera-logo svg { height: … }.
function loadInlineSvg(filename) {
  let s = readFileSync(path.join(__dirname, filename), 'utf8');
  s = s.replace(/^﻿/, '');
  s = s.replace(/<\?xml[^>]*\?>\s*/i, '');
  s = s.replace(/<!DOCTYPE[^>]*>\s*/i, '');
  s = s.replace(/<svg\b([^>]*)>/i, (_m, attrs) => {
    const stripped = attrs.replace(/\s(width|height)="[^"]*"/gi, '');
    return `<svg${stripped}>`;
  });
  return s.trim();
}

export const config = {
  projectName: 'Ximera',
  logoSvg: loadInlineSvg('logo.svg'),
  footerLinks: [
    { label: 'About Ximera',    href: 'https://ximera.osu.edu/' },
    { label: 'Source',          href: 'https://github.com/XimeraProject/' },
    { label: 'License',         href: 'https://www.gnu.org/licenses/agpl-3.0.html' },
    { label: 'Report an issue', href: 'https://github.com/XimeraProject/ximera-two/issues' },
  ],
  footerNote: '© Ximera Project · AGPL-3.0',
};
