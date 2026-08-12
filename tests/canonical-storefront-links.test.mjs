import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('first-party links use the live Free Tarot canonical route', () => {
  const files = ['README.md', 'app/layout.tsx', 'app/reading/page.tsx'];
  for (const relative of files) {
    const source = readFileSync(path.join(process.cwd(), relative), 'utf8');
    assert.match(source, /https:\/\/deckaura\.com\/pages\/free-tarot-reading/);
    assert.doesNotMatch(source, /https:\/\/deckaura\.com\/pages\/tarot-reading(?:["')\s]|$)/);
  }
});
