// Run with:  node --test web/test/
//
// What a card is allowed to show. Every rule here is one that would break
// silently: a zero where the source said nothing, a photograph of a rock
// standing in for the shape of a walk, a picture URL asked for with the braces
// still in it, a rating rounded until it is somebody else's number. None of it
// needs a browser.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activityWord,
  cardFigures,
  cardImage,
  durationParts,
  starPortion,
  thumbnailSrc,
  updatedMonth,
} from '../assets/cards.js';

// The three rows the two sources actually answer with, trimmed to the keys
// these tests are about. Taken from live answers on 2026-09-02.
const KOMOOT_NEARBY = {
  url: 'https://www.komoot.com/smarttour/3982084',
  title: 'Matagalls loop',
  sport: 'hike',
  start: { lat: 41.771674, lng: 2.399669 },
  thumbnail: {
    url: 'https://tourpic-vector.maps.komoot.net/r/small/abc/?width={width}&height={height}&crop={crop}',
    kind: 'route-map',
  },
  rating: { score: 4.46, count: 13 },
  difficulty: 'difficult',
  updatedAt: '2026-08-08T16:43:58.029Z',
  publishedBy: 'Komoot',
  published: {
    distanceM: 19981.03,
    ascentM: 1120.27,
    descentM: 1120.27,
    durationS: 27131,
    elevationMinM: null,
    elevationMaxM: null,
    pointCount: null,
  },
};

// The awkward one: a Komoot search row has the picture and nothing else.
const KOMOOT_SEARCH = {
  ...KOMOOT_NEARBY,
  thumbnail: { url: 'https://tourpic-vector.maps.komoot.net/r/small/abc/', kind: 'route-map' },
  rating: null,
  difficulty: null,
  updatedAt: null,
};

const WIKILOC = {
  url: 'https://www.wikiloc.com/hiking-trails/matagalls-41974490',
  title: 'Matagalls',
  sport: 'hiking',
  start: { lat: 41.800652, lng: 2.347253 },
  thumbnail: { url: 'https://s0.wklcdn.com/image_22/681051/27329574_tn.jpg', kind: 'photo' },
  rating: { score: 4.8, count: 5 },
  difficulty: 'moderate',
  updatedAt: null,
  publishedBy: 'Wikiloc',
  published: {
    distanceM: 7628.29,
    ascentM: 541.93,
    descentM: null,
    durationS: null,
    elevationMinM: null,
    elevationMaxM: null,
    pointCount: null,
  },
};

// ---------------------------------------------------------------- the grid

test('a card shows the four figures the source published, in reading order', () => {
  assert.deepEqual(
    cardFigures(KOMOOT_NEARBY).map((each) => each.key),
    ['distance', 'ascent', 'duration', 'start'],
  );
});

test('a figure the source did not publish leaves no slot behind', () => {
  // Wikiloc publishes no duration at all. Three figures, not four with a hole.
  const keys = cardFigures(WIKILOC).map((each) => each.key);
  assert.deepEqual(keys, ['distance', 'ascent', 'start']);
  assert.ok(!keys.includes('duration'));
});

test('nothing published is an empty grid, never a grid of zeroes', () => {
  const bare = {
    start: null,
    published: {
      distanceM: null,
      ascentM: null,
      descentM: null,
      durationS: null,
      elevationMinM: null,
      elevationMaxM: null,
      pointCount: null,
    },
  };
  assert.deepEqual(cardFigures(bare), []);
  assert.deepEqual(cardFigures({}), []);
  assert.deepEqual(cardFigures(null), []);
});

test('a figure that is not a number is treated as unpublished', () => {
  const odd = {
    start: { lat: 41.7, lng: 2.3 },
    published: { distanceM: '19981', ascentM: Number.NaN, durationS: Number.POSITIVE_INFINITY },
  };
  assert.deepEqual(
    cardFigures(odd).map((each) => each.key),
    ['start'],
  );
});

test('a duration of zero is not printed as a walk that takes no time', () => {
  const filled = { published: { durationS: 0 }, start: null };
  assert.deepEqual(cardFigures(filled), []);
});

test('half a coordinate is not a place', () => {
  assert.deepEqual(cardFigures({ start: { lat: 41.7, lng: null }, published: {} }), []);
  assert.deepEqual(cardFigures({ start: { lat: 41.7 }, published: {} }), []);
  assert.deepEqual(
    cardFigures({ start: { lat: 0, lng: 0 }, published: {} }).map((each) => each.key),
    // Null island is a real coordinate. Zero is a value here, not an absence.
    ['start'],
  );
});

test('the distance carries metres, not a rounded reading', () => {
  const [distance] = cardFigures(KOMOOT_NEARBY);
  assert.equal(distance.metres, 19981.03);
});

// ------------------------------------------------------------ the duration

test('seconds become hours and minutes', () => {
  assert.deepEqual(durationParts(27131), { hours: 7, minutes: 32 });
  assert.deepEqual(durationParts(19519), { hours: 5, minutes: 25 });
  assert.deepEqual(durationParts(1800), { hours: 0, minutes: 30 });
});

test('a duration that rounds to a whole hour says no minutes', () => {
  assert.deepEqual(durationParts(3599), { hours: 1, minutes: 0 });
});

test('a duration that is not a duration is nothing', () => {
  assert.equal(durationParts(0), null);
  assert.equal(durationParts(-60), null);
  assert.equal(durationParts(null), null);
  assert.equal(durationParts('3600'), null);
  assert.equal(durationParts(Number.NaN), null);
});

// --------------------------------------------------------------- the picture

test('a drawing of the route is shown', () => {
  const image = cardImage(KOMOOT_NEARBY);
  assert.ok(image);
  assert.equal(image.width, 480);
  assert.equal(image.height, 270);
});

test('a photograph of the path is not shown, however pretty', () => {
  // The rule is the kind, not the site: this is what keeps the decision true
  // the day either site changes what it sends.
  assert.equal(cardImage(WIKILOC), null);
  assert.equal(cardImage({ thumbnail: { url: 'https://x/y.jpg', kind: 'photo' } }), null);
});

test('a row with no picture at all is not a broken card', () => {
  assert.equal(cardImage({ thumbnail: null }), null);
  assert.equal(cardImage({}), null);
  assert.equal(cardImage(null), null);
});

test('the size placeholders are filled in, because the braces are literal', () => {
  // Asked for as they arrive, these answer 400 and the card shows a broken
  // picture. Checked against the live image server on 2026-09-02.
  const src = cardImage(KOMOOT_NEARBY).src;
  assert.ok(!src.includes('{'));
  assert.match(src, /\?width=480&height=270&crop=true$/);
});

test('a search picture with no query gets a size, so it is not a 144px square', () => {
  assert.equal(
    thumbnailSrc('https://tourpic-vector.maps.komoot.net/r/small/abc/', 480, 270),
    'https://tourpic-vector.maps.komoot.net/r/small/abc/?width=480&height=270&crop=true',
  );
});

test('a query the source wrote for itself is left exactly as it wrote it', () => {
  const written = 'https://example.komoot.net/tile.jpg?v=7';
  assert.equal(thumbnailSrc(written, 480, 270), written);
});

test('a picture link that is not https is refused', () => {
  assert.equal(thumbnailSrc('http://tourpic-vector.maps.komoot.net/r/small/abc/', 480, 270), null);
  assert.equal(thumbnailSrc('javascript:alert(1)', 480, 270), null);
  assert.equal(thumbnailSrc('', 480, 270), null);
  assert.equal(thumbnailSrc(null, 480, 270), null);
});

// ---------------------------------------------------------------- the stars

test('a score is drawn as a fraction of the row, not rounded to whole stars', () => {
  assert.deepEqual(starPortion({ score: 4.46, count: 13 }), {
    score: 4.46,
    count: 13,
    fraction: 4.46 / 5,
  });
});

test('a score with no count is still a score', () => {
  assert.deepEqual(starPortion({ score: 5 }), { score: 5, count: null, fraction: 1 });
});

test('no rating means no stars, and never a row of empty ones', () => {
  assert.equal(starPortion(null), null);
  assert.equal(starPortion({ count: 13 }), null);
  assert.equal(starPortion({ score: null, count: 0 }), null);
  assert.equal(starPortion({ score: '4.5' }), null);
});

test('a score outside the scale is refused rather than clamped', () => {
  // Clamping would print a five star route the source never called one.
  assert.equal(starPortion({ score: 7 }), null);
  assert.equal(starPortion({ score: -1 }), null);
});

// ----------------------------------------------------------------- the date

test('a timestamp becomes a month and a year, and loses the rest', () => {
  assert.deepEqual(updatedMonth('2026-08-08T16:43:58.029Z'), { year: 2026, month: 8 });
  assert.deepEqual(updatedMonth('2026-02-26T20:14:01.035Z'), { year: 2026, month: 2 });
});

test('a source that keeps no date says nothing, rather than saying today', () => {
  assert.equal(updatedMonth(null), null);
  assert.equal(updatedMonth(''), null);
  assert.equal(updatedMonth('   '), null);
  assert.equal(updatedMonth('last tuesday'), null);
});

test('a date in the future is refused', () => {
  const now = Date.parse('2026-09-02T00:00:00Z');
  assert.equal(updatedMonth('2031-03-01T00:00:00Z', now), null);
  assert.deepEqual(updatedMonth('2026-09-01T00:00:00Z', now), { year: 2026, month: 9 });
});

// ------------------------------------------------------------- the activity

test('an activity that repeats what was just chosen is left off the card', () => {
  assert.equal(activityWord(KOMOOT_NEARBY, 'hike'), null);
  assert.equal(activityWord(KOMOOT_NEARBY, 'mtb'), 'hike');
});

test('a source that does not filter states the activity on every card', () => {
  // Wikiloc's own filter is refused upstream, so this word is the only thing
  // telling a walker which of these rows is a via ferrata.
  assert.equal(activityWord(WIKILOC, 'hiking', { always: true }), 'hiking');
  assert.equal(activityWord(WIKILOC, 'all', { always: true }), 'hiking');
});

test('a row whose activity the source did not name shows no word', () => {
  assert.equal(activityWord({ sport: null }, 'hike', { always: true }), null);
  assert.equal(activityWord({}, 'hike'), null);
  assert.equal(activityWord(null, 'hike'), null);
});
