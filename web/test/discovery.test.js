// Run with:  node --test web/test/
//
// Three rules that would fail quietly if they broke. A figure the source did
// not publish must be absent from the row, not a zero; a page must be added to
// the list rather than put in its place; and an activity chosen for one source
// must not survive a change of source, because the two vocabularies are not the
// same list. None of it needs a browser.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendPage,
  catalogueFrom,
  claimSentence,
  sourcesFrom,
  sportAfterSource,
} from '../assets/discovery.js';

// The real sentences, shortened to what these tests are about: the source name
// and its figures arrive together or not at all.
const STRINGS = {
  'claim.says': '{source} says {figures}.',
  'claim.none': '{source} publishes no figures for this one.',
  'claim.distance': '{km} km',
  'claim.ascent': '{m} m up',
  'claim.descent': '{m} m down',
  'claim.highest': 'a high point of {m} m',
};

const speak = {
  source: 'Komoot',
  t: (key, values) => {
    let text = STRINGS[key] ?? key;
    for (const [name, value] of Object.entries(values ?? {})) {
      text = text.replaceAll(`{${name}}`, value);
    }
    return text;
  },
  km: (metres) => (metres / 1000).toFixed(1),
  metres: (value) => String(Math.round(value)),
  joinList: (items) =>
    items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`,
};

const say = (published) => claimSentence(published, speak);

test('a claim names the source in the same breath as its figures', () => {
  const sentence = say({ distanceM: 24400, ascentM: 1126 });
  assert.equal(sentence, 'Komoot says 24.4 km and 1126 m up.');
  // Whatever else changes, the site's name cannot leave the sentence.
  assert.ok(sentence.startsWith('Komoot'));
});

test('a figure the source did not publish is left out, never printed as zero', () => {
  const sentence = say({
    distanceM: 24400,
    ascentM: null,
    descentM: undefined,
    elevationMaxM: 2100,
  });
  assert.equal(sentence, 'Komoot says 24.4 km and a high point of 2100 m.');
  assert.ok(!sentence.includes('0 m up'));
  assert.ok(!sentence.includes('up'));
});

test('a figure that is not a number is treated as unpublished', () => {
  // A source that answers with a string or a NaN has still not published a
  // figure, and neither may reach a formatter.
  assert.equal(say({ distanceM: '24.4', ascentM: Number.NaN }), speak.t('claim.none', speak));
});

test('a row with nothing published says so, and still names the source', () => {
  assert.equal(
    say({ distanceM: null, ascentM: null, descentM: null, elevationMaxM: null }),
    'Komoot publishes no figures for this one.',
  );
  assert.equal(say(null), 'Komoot publishes no figures for this one.');
});

test('all four figures read as one sentence', () => {
  assert.equal(
    say({ distanceM: 24400, ascentM: 1126, descentM: 1130, elevationMaxM: 2100 }),
    'Komoot says 24.4 km, 1126 m up, 1130 m down and a high point of 2100 m.',
  );
});

// ------------------------------------------------------------------ paging

const listing = (urls, extra = {}) => ({
  source: { id: 'komoot', label: 'Komoot' },
  results: urls.map((url) => ({ url, title: url, published: {} })),
  paging: { page: 0, pageSize: 6, hasMore: true, totalKnown: null, ...extra.paging },
  droppedRows: extra.droppedRows ?? 0,
});

test('the next page is added to the list, never put in its place', () => {
  const first = appendPage(null, listing(['a', 'b']));
  const second = appendPage(first, listing(['c', 'd'], { paging: { page: 1 } }));

  assert.deepEqual(
    second.rows.map((row) => row.url),
    ['a', 'b', 'c', 'd'],
  );
  assert.equal(second.page, 1);
  // The first page's own object is untouched, so a render halfway through can
  // never show a half-built list.
  assert.equal(first.rows.length, 2);
});

test('a row the source sends twice is listed once', () => {
  const first = appendPage(null, listing(['a', 'b']));
  const second = appendPage(first, listing(['b', 'c'], { paging: { page: 1 } }));
  assert.deepEqual(
    second.rows.map((row) => row.url),
    ['a', 'b', 'c'],
  );
});

test('dropped rows add up across pages, because each page counts its own', () => {
  const first = appendPage(null, listing(['a'], { droppedRows: 2 }));
  const second = appendPage(first, listing(['b'], { droppedRows: 3, paging: { page: 1 } }));
  assert.equal(second.dropped, 5);
});

test('a total is carried when the source gave one, and stays null when it did not', () => {
  const told = appendPage(null, listing(['a'], { paging: { totalKnown: 40 } }));
  assert.equal(told.totalKnown, 40);

  const untold = appendPage(null, listing(['a']));
  assert.equal(untold.totalKnown, null);
});

test('hasMore comes from the newest page, so the button goes when it says so', () => {
  const first = appendPage(null, listing(['a']));
  assert.equal(first.hasMore, true);
  const second = appendPage(first, listing(['b'], { paging: { page: 1, hasMore: false } }));
  assert.equal(second.hasMore, false);
});

// ------------------------------------------------------------- the activity

const KOMOOT = { sports: ['hike', 'mtb', 'jogging'], default: 'hike' };
const OTHER = { sports: ['mtb', 'ski'], default: 'mtb' };

test('changing the source resets the activity to the new source default', () => {
  // "mtb" exists in both lists, and it is still dropped: the two vocabularies
  // are not merged and one site's word is not a promise about another's.
  assert.equal(sportAfterSource(OTHER, 'mtb', true), 'mtb');
  assert.equal(sportAfterSource(OTHER, 'jogging', true), 'mtb');
  assert.equal(sportAfterSource(KOMOOT, 'mtb', true), 'hike');
});

test('within one source the choice is kept', () => {
  assert.equal(sportAfterSource(KOMOOT, 'mtb', false), 'mtb');
});

test('an activity the source has no word for falls back to its default', () => {
  assert.equal(sportAfterSource(KOMOOT, 'ski', false), 'hike');
  assert.equal(sportAfterSource(KOMOOT, '', false), 'hike');
});

test('the activity list is read from the answer, and a bad default is ignored', () => {
  assert.deepEqual(catalogueFrom({ sports: ['hike', 'mtb'], default: 'mtb' }, null), {
    sports: ['hike', 'mtb'],
    default: 'mtb',
  });
  assert.deepEqual(catalogueFrom({ sports: ['hike'], default: 'ski' }, null), {
    sports: ['hike'],
    default: 'hike',
  });
  assert.equal(catalogueFrom({ sports: [] }, null), null);
  assert.equal(catalogueFrom({}, null), null);
});

// --------------------------------------------------------------- the source

const KNOWN = [
  { id: 'komoot', label: 'Komoot' },
  { id: 'wikiloc', label: 'Wikiloc' },
];

test('a service that says nothing about sources offers the one it can search', () => {
  // Today's answer, exactly. Offering a second source here would be a control
  // that does nothing.
  assert.deepEqual(sourcesFrom({ ok: true, sports: ['hike'], default: 'hike' }, KNOWN), [
    KNOWN[0],
  ]);
});

test('a service that names the source it answered for offers both', () => {
  assert.deepEqual(sourcesFrom({ source: 'wikiloc', sports: ['hiking'] }, KNOWN), KNOWN);
  assert.deepEqual(sourcesFrom({ source: { id: 'komoot', label: 'Komoot' } }, KNOWN), KNOWN);
});

test('a service that lists its sources is believed over anything written here', () => {
  assert.deepEqual(
    sourcesFrom({ sources: [{ id: 'wikiloc', label: 'Wikiloc' }, 'strava'] }, KNOWN),
    [
      { id: 'wikiloc', label: 'Wikiloc' },
      { id: 'strava', label: 'strava' },
    ],
  );
});
