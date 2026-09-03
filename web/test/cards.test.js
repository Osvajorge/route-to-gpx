// Run with:  node --test web/test/
//
// What a card is allowed to show. Every rule here is one that would break
// silently: a zero where the source said nothing, a photograph of a rock
// standing in for the shape of a walk, a drawing projected differently from the
// chart it leads to, a rating rounded until it is somebody else's number. None
// of it needs a browser.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activityWord,
  cardFigures,
  CARD_TRACE_H,
  CARD_TRACE_W,
  cardTrace,
  durationParts,
  sourceOwnWord,
  wording,
  starPortion,
  updatedMonth,
} from '../assets/cards.js';
import { fitFrame, projectInFrame, traceFrame } from '../assets/charts.js';

// The card's drawing is the report's chart at a smaller size, and it is the
// SAME arithmetic: charts.js is handed in rather than copied, so a card that
// disagreed with the chart it leads to would fail here first.
const PROJECTION = { fit: fitFrame, project: projectInFrame };

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
  // The route's own shape, as it arrives: [[lat, lng], ...]. Shortened from a
  // live answer of 2026-09-02, which carried 27 to 167 points per row.
  trace: [
    [41.771674, 2.399669],
    [41.7752, 2.4041],
    [41.7811, 2.4098],
    [41.7793, 2.4152],
    [41.771674, 2.399669],
  ],
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
  // Wikiloc sends no shape at all, which is the whole reason a Wikiloc card
  // carries no drawing.
  trace: null,
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

// --------------------------------------------------------------- the drawing

test('a row that carries the route shape is drawn', () => {
  const drawn = cardTrace(KOMOOT_NEARBY, PROJECTION);
  assert.ok(drawn);
  assert.equal(drawn.width, CARD_TRACE_W);
  assert.equal(drawn.height, CARD_TRACE_H);
  assert.match(drawn.d, /^M[\d.]+ [\d.]+(L[\d.]+ [\d.]+){4}$/);
});

test('a row with no shape is not a broken card', () => {
  // Wikiloc sends a photograph of the path and no shape, so its cards carry no
  // drawing at all. That is the decision, and it is tested rather than assumed.
  assert.equal(cardTrace(WIKILOC, PROJECTION), null);
  assert.equal(cardTrace({ trace: null }, PROJECTION), null);
  assert.equal(cardTrace({}, PROJECTION), null);
  assert.equal(cardTrace(null, PROJECTION), null);
});

test('one point is not a shape, and neither is a shape of rubbish', () => {
  assert.equal(cardTrace({ trace: [[41.7, 2.3]] }, PROJECTION), null);
  assert.equal(cardTrace({ trace: [[41.7, 2.3], [null, 2.4]] }, PROJECTION), null);
  assert.equal(cardTrace({ trace: [['41.7', '2.3'], [41.8, 2.4]] }, PROJECTION), null);
  assert.equal(cardTrace({ trace: 'a polyline' }, PROJECTION), null);
});

test('the drawing fits inside its own box, with room for the stroke', () => {
  const drawn = cardTrace(KOMOOT_NEARBY, PROJECTION);
  const numbers = drawn.d.match(/[\d.]+/g).map(Number);
  const xs = numbers.filter((_, i) => i % 2 === 0);
  const ys = numbers.filter((_, i) => i % 2 === 1);
  assert.ok(Math.min(...xs) >= 0 && Math.max(...xs) <= CARD_TRACE_W);
  assert.ok(Math.min(...ys) >= 0 && Math.max(...ys) <= CARD_TRACE_H);
  // The route touches the padding on its longer axis, so the fit is a fit and
  // not a shape sitting in the middle of an empty box.
  const tight = Math.min(...ys) < 13 || Math.min(...xs) < 13;
  assert.ok(tight);
});

test('the card and the report chart project the same route the same way', () => {
  // THE POINT OF PASSING charts.js IN. Two projections that disagree would show
  // a walker one shape on the card and a different one on the report it leads
  // to, and nothing would fail loudly.
  const points = KOMOOT_NEARBY.trace.map(([lat, lon]) => ({ lat, lon }));
  const chart = projectInFrame(points, traceFrame(points));
  const card = cardTrace(KOMOOT_NEARBY, PROJECTION);
  const drawn = card.d.match(/[\d.]+/g).map(Number);

  // Both are the same shape fitted to a different box, so every card point is
  // its chart point through one shift and one scale, the same for all of them.
  const chartSpanX = Math.max(...chart.map((p) => p.x)) - Math.min(...chart.map((p) => p.x));
  const cardXs = drawn.filter((_, i) => i % 2 === 0);
  const scale = (Math.max(...cardXs) - Math.min(...cardXs)) / chartSpanX;
  for (let i = 0; i < chart.length; i++) {
    const x = (chart[i].x - chart[0].x) * scale + drawn[0];
    const y = (chart[i].y - chart[0].y) * scale + drawn[1];
    assert.ok(Math.abs(x - drawn[i * 2]) < 0.2, `x at ${i}`);
    assert.ok(Math.abs(y - drawn[i * 2 + 1]) < 0.2, `y at ${i}`);
  }
});

test('north is up: a point further north is drawn higher', () => {
  // Mercator y already grows south, the way SVG y does. A second flip here
  // would mirror the route against the chart it is a thumbnail of.
  const drawn = cardTrace(
    { trace: [[41.0, 2.0], [42.0, 2.0]] },
    PROJECTION,
  );
  const numbers = drawn.d.match(/[\d.]+/g).map(Number);
  assert.ok(numbers[3] < numbers[1]);
});

test('the start of the route is where the drawing starts', () => {
  const drawn = cardTrace(KOMOOT_NEARBY, PROJECTION);
  const numbers = drawn.d.match(/[\d.]+/g).map(Number);
  assert.equal(Number(drawn.start.x.toFixed(1)), numbers[0]);
  assert.equal(Number(drawn.start.y.toFixed(1)), numbers[1]);
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

test('a count of zero is nobody having rated it, so no stars are drawn', () => {
  // Wikiloc sends every unrated trail as score 0.0 with count 0. Drawn, that is
  // five empty stars and "0 (0)" beside them: this page saying other walkers
  // scored the route and scored it nothing. On a search for "mazunte" it was
  // eight cards out of nine.
  assert.equal(starPortion({ score: 0, count: 0 }), null);
  assert.equal(starPortion({ score: 4.5, count: 0 }), null);
});

test('a count of one is a rating, and it is drawn', () => {
  // The line the rule above must not cross. One person rating a route is a
  // fact about the route; nobody rating it is not.
  assert.deepEqual(starPortion({ score: 4.33, count: 1 }), {
    score: 4.33,
    count: 1,
    fraction: 4.33 / 5,
  });
});

test('a score of zero from people who gave it is still their score', () => {
  assert.deepEqual(starPortion({ score: 0, count: 3 }), { score: 0, count: 3, fraction: 0 });
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

test('an activity word this page has no name for is readable, never a raw slug', () => {
  // Komoot offers six activities and its rows return more: `mtb_easy` arrived
  // on a live search and reached a card underscore and all. There is no list to
  // add it to that stays complete, because Komoot does not publish the list its
  // rows draw from.
  assert.equal(sourceOwnWord('mtb_easy'), 'Mtb easy');
  assert.equal(sourceOwnWord('dual-sport-motorcycle'), 'Dual sport motorcycle');
});

test('nothing is translated, expanded or reordered on the way through', () => {
  // Guessing at what another site's word means is the one thing this page must
  // not do with a vocabulary it does not own, so the separators are the whole
  // of what changes.
  assert.equal(sourceOwnWord('hiking'), 'Hiking');
  assert.equal(sourceOwnWord('Trail Running'), 'Trail Running');
  assert.equal(sourceOwnWord('e_mtb'), 'E mtb');
});

test('a word that is not a word comes back empty rather than as punctuation', () => {
  assert.equal(sourceOwnWord('___'), '');
  assert.equal(sourceOwnWord(''), '');
  assert.equal(sourceOwnWord(null), '');
  assert.equal(sourceOwnWord(42), '');
});

// ---------------------------------------------------------------- wording
//
// The rule these cover was written twice and only one copy was right: the
// grade word skipped the last step and returned the raw slug. It had no live
// case, which is why nobody noticed, so the invariant is pinned here instead
// of waiting for a source to send one.

test('wording prefers our own word', () => {
  const said = wording('via-ferrata', {
    ours: () => 'Via ferrata',
    published: () => 'Via Ferrata',
  });
  assert.deepEqual(said, { text: 'Via ferrata', ours: true });
});

test("wording falls back to the source's published spelling", () => {
  const said = wording('trail-running', {
    ours: () => null,
    published: () => 'Trail Running',
  });
  // Theirs, and flagged as theirs, so the sentence under the picker can say so.
  assert.deepEqual(said, { text: 'Trail Running', ours: false });
});

test('wording opens the slug out when nobody has a word for it', () => {
  const said = wording('mtb_easy', { ours: () => null, published: () => null });
  assert.deepEqual(said, { text: 'Mtb easy', ours: false });
});

test('wording works with no published step at all, which is the grade case', () => {
  // A grade has no published labels to look in, so it walks the first step and
  // then the last. This is exactly the path that used to return the slug.
  assert.deepEqual(wording('very_difficult', { ours: () => null }),
    { text: 'Very difficult', ours: false });
  assert.deepEqual(wording('difficult', { ours: () => 'Dificil' }),
    { text: 'Dificil', ours: true });
});

test('no slug survives wording, whichever steps are missing', () => {
  // The whole point: a machine name must not reach a reader by any route.
  const slugs = ['mtb_easy', 'very_difficult', 'dual-sport-motorcycle', 'e_mtb',
                 'alpine_ski', 'T4', 'off-road'];
  const steps = [
    {},
    { ours: () => null },
    { published: () => null },
    { ours: () => null, published: () => null },
  ];
  for (const slug of slugs) {
    for (const step of steps) {
      const { text } = wording(slug, step);
      assert.ok(!/[_]/.test(text), `${slug} kept an underscore: ${text}`);
      assert.ok(text[0] === text[0].toUpperCase(),
        `${slug} came back lowercase: ${text}`);
    }
  }
});

test('wording never hands back an empty word for a real slug', () => {
  for (const slug of ['hiking', 'mtb_easy', 'T4']) {
    assert.ok(wording(slug, {}).text.length > 0);
  }
});
