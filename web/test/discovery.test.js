// Run with:  node --test web/test/
//
// The rules that would fail quietly if they broke. A figure the source did not
// publish must be absent from the row, not a zero; a page must be added to the
// list rather than put in its place; an activity chosen for one source must not
// survive a change of source, because the two vocabularies are not the same
// list; Nearby must never offer "any activity", because the service cannot ask
// that question; and a site that failed must be nameable, because a short list
// because a site was down reads exactly like a short list because a valley is
// empty. None of it needs a browser.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activityChoices,
  appendPage,
  catalogueFrom,
  claimSentence,
  nearbyRequest,
  placeAtPoint,
  placeChoices,
  pointHonoured,
  searchRequest,
  sourceChosen,
  sourcesMissing,
  sourcesOffered,
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

test('rows removed on purpose add up too, and stay absent for a source that removes none', () => {
  // A Wikiloc page of six that filters down to none is not an empty answer, and
  // the count is the only thing that says so.
  const first = appendPage(null, {
    ...listing(['a']),
    setAside: { otherActivity: 5, outsideRadius: 0 },
  });
  assert.deepEqual(first.setAside, { otherActivity: 5, outsideRadius: 0 });

  const second = appendPage(first, {
    ...listing(['b'], { paging: { page: 1 } }),
    setAside: { otherActivity: 6, outsideRadius: 2 },
  });
  assert.deepEqual(second.setAside, { otherActivity: 11, outsideRadius: 2 });

  // Komoot filters nothing of its own and sends no such key, so there is
  // nothing for the page to test and nothing for it to say.
  assert.equal(appendPage(null, listing(['a'])).setAside, null);
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
    labels: {},
    default: 'mtb',
  });
  assert.deepEqual(catalogueFrom({ sports: ['hike'], default: 'ski' }, null), {
    sports: ['hike'],
    labels: {},
    default: 'hike',
  });
  assert.equal(catalogueFrom({ sports: [] }, null), null);
  assert.equal(catalogueFrom({}, null), null);
});

test("a source that spells its own words is believed, and one that does not keeps its slugs", () => {
  // Wikiloc sends a label for every activity; Komoot sends none. Neither is a
  // translation, so both are printed as the site itself writes them.
  const wikiloc = catalogueFrom(
    {
      sports: ['all', 'trail-running'],
      default: 'all',
      activities: [
        { id: 'all', label: 'Any activity', group: null },
        { id: 'trail-running', label: 'Trail Running', group: 'On Foot' },
        { id: 'broken', label: '   ' },
      ],
    },
    null,
  );
  assert.deepEqual(wikiloc.labels, { all: 'Any activity', 'trail-running': 'Trail Running' });
  assert.deepEqual(catalogueFrom({ sports: ['hike'], default: 'hike' }, null).labels, {});
});

// --------------------------------------------------------------- the source

const KNOWN = [
  { id: 'all', key: 'source.both' },
  { id: 'komoot', label: 'Komoot' },
  { id: 'wikiloc', label: 'Wikiloc' },
];

test('the picker offers both sites at once, and that is what it starts on', () => {
  const answered = new Set(['all', 'komoot', 'wikiloc']);
  assert.deepEqual(sourcesOffered(KNOWN, answered), KNOWN);
  // First in the list and first in the control: nobody looking for a route near
  // a village cares which website holds it.
  assert.equal(sourcesOffered(KNOWN, answered)[0].id, 'all');
  assert.equal(sourceChosen(sourcesOffered(KNOWN, answered), 'all'), 'all');
});

test('a source is offered only once the service has answered for it', () => {
  // The service refuses a source it does not search by name, so an answer is
  // the demonstration rather than a guess about a future release.
  assert.deepEqual(sourcesOffered(KNOWN, new Set(['all'])), [KNOWN[0]]);
  assert.deepEqual(sourcesOffered(KNOWN, new Set(['komoot', 'wikiloc'])), [KNOWN[1], KNOWN[2]]);
});

test('before any answer arrives the control is neither empty nor a guess', () => {
  assert.deepEqual(sourcesOffered(KNOWN, new Set()), [KNOWN[0]]);
});

test('the visitor keeps the source they picked, unless it is not offered', () => {
  const offered = sourcesOffered(KNOWN, new Set(['all', 'komoot', 'wikiloc']));
  assert.equal(sourceChosen(offered, 'wikiloc'), 'wikiloc');
  // A service that cannot search both at once moves the page off it rather than
  // leaving the control pointing at a source that will be refused.
  assert.equal(sourceChosen(sourcesOffered(KNOWN, new Set(['komoot'])), 'all'), 'komoot');
  assert.equal(sourceChosen([], 'all'), '');
});

// ------------------------------------------------- the two activity lists

test('Nearby never offers "any activity", because the service cannot ask it', () => {
  // Komoot cannot list routes around a point without a sport, so the service
  // refuses. A control that offers a refusal is worse than one that does not
  // offer the choice at all.
  const wikiloc = { sports: ['all', 'hiking', 'via-ferrata'], default: 'all' };
  const choices = activityChoices(wikiloc, 'nearby');
  assert.deepEqual(choices.sports, ['hiking', 'via-ferrata']);
  assert.equal(choices.default, 'hiking');
});

test('Nearby keeps the source default when it is a real activity', () => {
  const komoot = { sports: ['hike', 'mtb'], default: 'mtb' };
  assert.deepEqual(activityChoices(komoot, 'nearby'), { sports: ['hike', 'mtb'], default: 'mtb' });
});

test('Search always offers "any activity", and starts there', () => {
  const komoot = { sports: ['hike', 'mtb'], default: 'hike' };
  assert.deepEqual(activityChoices(komoot, 'search'), {
    sports: ['all', 'hike', 'mtb'],
    default: 'all',
  });

  // A source whose own list already has the word is not given it twice.
  const wikiloc = { sports: ['all', 'hiking'], default: 'all' };
  assert.deepEqual(activityChoices(wikiloc, 'search'), {
    sports: ['all', 'hiking'],
    default: 'all',
  });
});

test('no activity list yet is an empty control, never an invented one', () => {
  assert.deepEqual(activityChoices(null, 'nearby'), { sports: [], default: '' });
  assert.deepEqual(activityChoices(undefined, 'search'), { sports: ['all'], default: 'all' });
});

// ------------------------------------------------------- the missing sites

test('a site that did not answer is named, and one that did is not', () => {
  const shown = appendPage(null, {
    ...listing(['a']),
    sources: [
      { id: 'komoot', ok: true, error: null },
      { id: 'wikiloc', ok: false, error: 'network' },
    ],
  });
  assert.deepEqual(sourcesMissing(shown), [{ id: 'wikiloc', error: 'network' }]);
});

test('a single site answering says nothing about sites, and gets no sentence', () => {
  // A site that fails on its own is an error, not half an answer, and the page
  // already has a panel for that.
  assert.deepEqual(sourcesMissing(appendPage(null, listing(['a']))), []);
  assert.deepEqual(sourcesMissing(null), []);
});

test('a failure with no reason still gets named', () => {
  const shown = appendPage(null, {
    ...listing(['a']),
    sources: [{ id: 'wikiloc', ok: false, error: null }],
  });
  assert.deepEqual(sourcesMissing(shown), [{ id: 'wikiloc', error: 'network' }]);
});

// ---------------------------------------------------------- the place used

test('the place the words were read as is carried, and so are the others', () => {
  const shown = appendPage(null, {
    ...listing(['a']),
    query: {
      query: 'montserrat',
      placeUsed: { name: 'Montserrat, Valencian Community, Spain', lat: 39.35, lng: -0.6 },
    },
    places: [
      { name: 'Montserrat, Valencian Community, Spain', lat: 39.35, lng: -0.6 },
      { name: 'Parc Natural de la Muntanya de Montserrat', lat: 41.6, lng: 1.81 },
    ],
  });
  assert.deepEqual(shown.placeUsed, {
    name: 'Montserrat, Valencian Community, Spain',
    lat: 39.35,
    lng: -0.6,
  });
  assert.equal(shown.places.length, 2);
});

test('a later page does not erase the place the first one named', () => {
  // Load more asks the same question, and its answer carries the routes rather
  // than the places. Dropping the line above the rows on the second press would
  // take away the one thing that says which valley they are from.
  const first = appendPage(null, {
    ...listing(['a']),
    query: { placeUsed: { name: 'Montserrat', lat: 41.6, lng: 1.81 } },
    places: [{ name: 'Montserrat', lat: 41.6, lng: 1.81 }],
  });
  const second = appendPage(first, listing(['b'], { paging: { page: 1 } }));
  assert.deepEqual(second.placeUsed, { name: 'Montserrat', lat: 41.6, lng: 1.81 });
  assert.equal(second.places.length, 1);
});

test('half a place is not a place, so it is never offered as one', () => {
  const shown = appendPage(null, {
    ...listing(['a']),
    query: { placeUsed: { name: 'Montserrat', lat: 41.6 } },
    places: [
      { name: '', lat: 41.6, lng: 1.81 },
      { name: 'Olesa', lat: 41.54, lng: 1.89 },
      { name: 'Broken', lat: 'north', lng: 1.0 },
    ],
  });
  assert.equal(shown.placeUsed, null);
  assert.deepEqual(shown.places, [{ name: 'Olesa', lat: 41.54, lng: 1.89 }]);
});

test('what was read to fill the page adds up, and stays absent when unsaid', () => {
  // One via ferrata route out of a hundred examined is a short page AND a true
  // thing about that valley. The number is what tells them apart, and it may
  // only be printed when the answer carried it.
  const first = appendPage(null, { ...listing(['a']), examined: 100 });
  assert.equal(first.examined, 100);
  const second = appendPage(first, { ...listing(['b'], { paging: { page: 1 } }), examined: 25 });
  assert.equal(second.examined, 125);
  assert.equal(appendPage(null, listing(['a'])).examined, null);
});

test('which source answered travels with the rows it answered', () => {
  // Changing the dropdown must not relabel rows that are already on screen.
  const shown = appendPage(null, {
    ...listing(['a']),
    source: { id: 'all', label: 'Komoot and Wikiloc' },
  });
  assert.equal(shown.sourceId, 'all');
  assert.equal(shown.source, 'Komoot and Wikiloc');
});

// ------------------------------------------------------- the question asked

test('picking a place sends the point, so nothing is geocoded a second time', () => {
  // THE FIX FOR THE TWO VALLEYS. Without the point, "montserrat" reaches a
  // geocoder that answers with a village in the Valencian Community while
  // Komoot answers with the mountain in Catalonia, and one interleaved list
  // holds both with nothing on screen saying so.
  const asked = searchRequest({
    source: 'all',
    query: 'montserrat',
    sport: 'all',
    place: { name: 'Parc Natural de la Muntanya de Montserrat', lat: 41.6, lng: 1.81 },
    limit: 9,
  });
  assert.deepEqual(asked.body, {
    source: 'all',
    query: 'montserrat',
    sport: null,
    near: { lat: 41.6, lng: 1.81 },
    limit: 9,
    page: 0,
  });
});

test('with no place picked the words go on their own, and the service guesses', () => {
  const asked = searchRequest({ source: 'all', query: ' montserrat ', sport: 'hike', limit: 9 });
  assert.equal(asked.body.near, null);
  assert.equal(asked.body.query, 'montserrat');
  assert.equal(asked.body.sport, 'hike');
});

test('a search of one letter is refused here, not upstream', () => {
  assert.deepEqual(searchRequest({ source: 'all', query: 'm', limit: 9 }), { errorKey: 'query' });
  assert.deepEqual(searchRequest({ source: 'all', query: '  ', limit: 9 }), { errorKey: 'query' });
  assert.deepEqual(searchRequest({ source: 'all', limit: 9 }), { errorKey: 'query' });
});

test('Nearby with no activity is refused, and never sent as hiking', () => {
  // Komoot cannot be asked, and quietly picking one for the visitor would hand
  // back a list nobody asked for.
  const point = { source: 'all', lat: 42.58, lng: 0.66, radiusM: 20000, limit: 6 };
  assert.deepEqual(nearbyRequest({ ...point }), { errorKey: 'sport' });
  assert.deepEqual(nearbyRequest({ ...point, sport: 'all' }), { errorKey: 'sport' });
  assert.deepEqual(nearbyRequest({ ...point, sport: '' }), { errorKey: 'sport' });

  assert.deepEqual(nearbyRequest({ ...point, sport: 'hiking' }).body, {
    source: 'all',
    lat: 42.58,
    lng: 0.66,
    sport: 'hiking',
    radiusM: 20000,
    limit: 6,
    page: 0,
  });
});

test('a point that is not a point is refused before the activity is looked at', () => {
  assert.deepEqual(
    nearbyRequest({ source: 'all', lat: null, lng: 0.66, sport: 'hiking', limit: 6 }),
    { errorKey: 'location' },
  );
});

test('a single site names the place under its own key, and it is still read', () => {
  // Wikiloc answering alone calls it `place`; the two sites together call it
  // `placeUsed`. A Wikiloc-only search is exactly where a bad guess is
  // invisible, because there is no second site whose rows disagree with it.
  const shown = appendPage(null, {
    ...listing(['a']),
    query: { place: { name: 'Pirineos, Nuevo León, Mexico', lat: 25.65, lng: -100.47 } },
  });
  assert.deepEqual(shown.placeUsed, {
    name: 'Pirineos, Nuevo León, Mexico',
    lat: 25.65,
    lng: -100.47,
  });
});

// ------------------------------------------------ telling two places apart

// A search for "montserrat" really does answer with two different places of
// that exact name: a village in the Valencian Community and an island in the
// Caribbean, 6,000 km apart. Both belong in the list. Only the point separates
// them, so everything below reads the point and treats the name as something to
// look at and nothing more.
const VALENCIA = { name: 'Montserrat', lat: 39.3576494, lng: -0.6031 };
const ISLAND = { name: 'Montserrat', lat: 16.7417041, lng: -62.1916844 };
const OLESA = { name: 'Olesa de Montserrat', lat: 41.5439614, lng: 1.8913809 };

test('a place pressed among two of the same name is found by its point', () => {
  // The bug this replaces: the press was resolved by name, the first match won,
  // and pressing the island searched the village 6,000 km away while the page
  // said nothing had been guessed.
  const places = [VALENCIA, OLESA, ISLAND];
  assert.deepEqual(placeAtPoint(places, { lat: 16.7417041, lng: -62.1916844 }), ISLAND);
  assert.deepEqual(placeAtPoint(places, { lat: 39.3576494, lng: -0.6031 }), VALENCIA);
});

test('a point eleven metres out is still the same place, and one further is not', () => {
  const places = [VALENCIA, ISLAND];
  assert.deepEqual(placeAtPoint(places, { lat: 16.74175, lng: -62.19165 }), ISLAND);
  assert.equal(placeAtPoint(places, { lat: 16.75, lng: -62.19 }), null);
});

test('a press that matches nothing does nothing, rather than picking a neighbour', () => {
  // The list is redrawn by the answer it asks for, so a button can outlive the
  // place it was drawn from. Leaving the rows on screen is the right answer.
  assert.equal(placeAtPoint([VALENCIA], { lat: 0, lng: 0 }), null);
  assert.equal(placeAtPoint([], VALENCIA), null);
  assert.equal(placeAtPoint(null, VALENCIA), null);
  assert.equal(placeAtPoint([VALENCIA], null), null);
});

test('the place in use is not offered again, and it is left out by point', () => {
  // The same place arrives named two ways: "Montserrat" in the list and
  // "Montserrat, Valencian Community, Spain" as the one used.
  const named = { name: 'Montserrat, Valencian Community, Spain', lat: 39.3576, lng: -0.6031 };
  const choices = placeChoices([VALENCIA, OLESA, ISLAND], named);
  assert.deepEqual(
    choices.map((choice) => choice.place),
    [OLESA, ISLAND],
  );
});

test('a place sharing a name with another in the answer is marked, others are not', () => {
  // Counted over the whole answer, not over what survives the filter: with the
  // village in use, the one button left reading "Montserrat" sits under a line
  // also reading "Montserrat", and nothing on screen says they are 6,000 km
  // apart. The coordinate is all this page has, so that button gets it.
  const choices = placeChoices([VALENCIA, OLESA, ISLAND], VALENCIA);
  assert.deepEqual(
    choices.map((choice) => [choice.place.name, choice.ambiguous]),
    [
      ['Olesa de Montserrat', false],
      ['Montserrat', true],
    ],
  );
});

test('places whose names all differ carry no coordinate at all', () => {
  const choices = placeChoices([OLESA, ISLAND], VALENCIA);
  assert.deepEqual(
    choices.map((choice) => choice.ambiguous),
    [false, false],
  );
});

// -------------------------------------------- which site looked where you said

test('an answer says per site whether the point the visitor picked was applied', () => {
  // The two sites do different things with one point, so one sentence over the
  // whole list is false about half of it. A Wikiloc search IS a box, so the
  // point becomes the box; Komoot geocodes the words itself and the words win.
  const shown = appendPage(null, {
    ...listing(['a']),
    sources: [
      { id: 'komoot', ok: true, error: null, pointApplied: false },
      { id: 'wikiloc', ok: true, error: null, pointApplied: true },
    ],
  });
  assert.deepEqual(pointHonoured(shown), { applied: ['wikiloc'], ignored: ['komoot'] });
});

test('no point sent means neither list, so the page claims nothing about one', () => {
  const shown = appendPage(null, {
    ...listing(['a']),
    sources: [
      { id: 'komoot', ok: true, error: null },
      { id: 'wikiloc', ok: true, error: null },
    ],
  });
  assert.deepEqual(pointHonoured(shown), { applied: [], ignored: [] });
  assert.deepEqual(pointHonoured(appendPage(null, listing(['a']))), { applied: [], ignored: [] });
  assert.deepEqual(pointHonoured(null), { applied: [], ignored: [] });
});

test('a site that failed is in neither list, because it contributed no rows', () => {
  // It is not that the point missed it. It answered nothing at all, and the
  // page already has a sentence saying which site that was.
  const shown = appendPage(null, {
    ...listing(['a']),
    sources: [
      { id: 'komoot', ok: true, error: null, pointApplied: false },
      { id: 'wikiloc', ok: false, error: 'network', pointApplied: true },
    ],
  });
  assert.deepEqual(pointHonoured(shown), { applied: [], ignored: ['komoot'] });
});
