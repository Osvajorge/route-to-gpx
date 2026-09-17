// Run with:  node --test web/test/
//
// The gate every conversion passes through. It lived in app.js, where it was
// exported and untestable, and so it had no test at all while it refused the
// commonest way anybody arrives here from a phone.

import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyLink, linkWithin } from '../assets/links.js';

// Exactly what the Wikiloc phone app puts on the clipboard. Kept verbatim,
// accents, brackets and all, because every part of it is a thing the old
// parser tripped over.
const SHARED_BY_THE_WIKILOC_APP =
  '¡Mira esta ruta de @wikiloc! https://loc.wiki/t/12925300?h=lpnva9q9az&wa=so&la=es ' +
  "(160412 100 Cims (E). BARCELONÈS. (nº 155) ' Sant Pere Màrtir ' des de la Avd Diagonal ( Metro Línia L3 ))";

test('a route shared from the Wikiloc app is a Wikiloc link, sentence and all', () => {
  assert.equal(
    linkWithin(SHARED_BY_THE_WIKILOC_APP),
    'https://loc.wiki/t/12925300?h=lpnva9q9az&wa=so&la=es',
  );
  assert.deepEqual(classifyLink(SHARED_BY_THE_WIKILOC_APP), { id: 'wikiloc', label: 'Wikiloc' });
});

test('the sentence around the link is dropped, wherever the link sits in it', () => {
  const url = 'https://www.komoot.com/tour/12345';
  assert.equal(linkWithin(`Look at this ${url} nice one`), url);
  assert.equal(linkWithin(`${url} first`), url);
  assert.equal(linkWithin(`last one ${url}`), url);
  assert.equal(linkWithin(`  ${url}  `), url);
  assert.equal(linkWithin(`line one\n${url}\nline three`), url);
});

test('punctuation a sentence leaves stuck to a link is trimmed', () => {
  const url = 'https://www.wikiloc.com/rutas-senderismo/x-8001213';
  for (const tail of ['.', ',', '!', '?', ';', ':', '"', "'", '”', ')']) {
    assert.equal(linkWithin(`Mira ${url}${tail}`), url, `trailing ${tail} survived`);
  }
});

test('a bracket the link opened itself is kept', () => {
  // Wikipedia-shaped links really do end in one, and trimming it breaks them.
  const url = 'https://example.org/wiki/Montserrat_(massif)';
  assert.equal(linkWithin(`see ${url}`), url);
});

test('text with no link at all comes back unchanged, so a bare host still works', () => {
  // Somebody typing www.komoot.com/tour/1 by hand has no scheme, and that used
  // to work. It still has to.
  assert.equal(linkWithin('www.komoot.com/tour/1'), 'www.komoot.com/tour/1');
  assert.deepEqual(classifyLink('www.komoot.com/tour/1'), { id: 'komoot', label: 'Komoot' });
  assert.equal(linkWithin(''), '');
  assert.equal(linkWithin('   '), '');
  assert.equal(linkWithin(null), '');
  assert.equal(linkWithin(undefined), '');
});

test('the shortener is Wikiloc, and a lookalike is not', () => {
  assert.deepEqual(classifyLink('https://loc.wiki/t/12925300'), { id: 'wikiloc', label: 'Wikiloc' });
  assert.deepEqual(classifyLink('https://www.loc.wiki/t/1'), { id: 'wikiloc', label: 'Wikiloc' });
  assert.equal(classifyLink('https://loc.wiki.evil.example/t/1'), null);
  assert.equal(classifyLink('https://notloc.wiki/t/1'), null);
});

test('the sites it does read, and the ones it does not', () => {
  assert.deepEqual(classifyLink('https://www.komoot.com/tour/1'), { id: 'komoot', label: 'Komoot' });
  assert.deepEqual(classifyLink('https://www.komoot.de/smarttour/9'), { id: 'komoot', label: 'Komoot' });
  assert.deepEqual(classifyLink('https://es.wikiloc.com/rutas-senderismo/x-1'), { id: 'wikiloc', label: 'Wikiloc' });
  assert.deepEqual(classifyLink('https://example.org/route.gpx'), { id: 'file' });
  assert.equal(classifyLink('https://www.alltrails.com/trail/x'), null);
  assert.equal(classifyLink('https://example.org/'), null);
  assert.equal(classifyLink('not a link'), null);
});
