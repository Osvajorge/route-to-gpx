// Search and Nearby, minus the browser.
//
// Neither is a second product. Both end in the same conversion the link field
// already runs, and a list of routes is only a way of reaching one URL. What
// lives here is the part of that which is arithmetic over the service's answer,
// so the rules that are easy to get quietly wrong can be checked without a
// browser: a claim that omits what the source did not publish, a page that is
// added to the list rather than put in its place, an activity list that belongs
// to one source and is never merged with another's, which place a search was
// really about, and which of two sites failed.

/** One figure from what a source claims, or null when there is nothing to say.
 *
 *  A missing figure is null, and so is anything that is not a finite number.
 *  Both mean the same thing, that the source did not publish it, and neither
 *  may reach a formatter: a 0 or a dash printed on a row reads as a reading. */
function figure(published, key) {
  const value = published ? published[key] : null;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The one line on which a row is allowed to print figures.
 *
 *  The site's name and its numbers are assembled into a single translated
 *  sentence, so there is no way to render the numbers with the attribution
 *  somewhere else, or missing. This whole product exists to doubt these
 *  figures: a row that read like a measurement would be arguing with the
 *  report the row leads to.
 *
 *  `km` and `metres` format a number for the reader; `joinList` turns the
 *  fragments into a list in the reader's language. */
export function claimSentence(published, { source, t, km, metres, joinList }) {
  const figures = [];

  const distanceM = figure(published, 'distanceM');
  if (distanceM !== null) figures.push(t('claim.distance', { km: km(distanceM) }));

  const ascentM = figure(published, 'ascentM');
  if (ascentM !== null) figures.push(t('claim.ascent', { m: metres(ascentM) }));

  const descentM = figure(published, 'descentM');
  if (descentM !== null) figures.push(t('claim.descent', { m: metres(descentM) }));

  const highestM = figure(published, 'elevationMaxM');
  if (highestM !== null) figures.push(t('claim.highest', { m: metres(highestM) }));

  if (figures.length === 0) return t('claim.none', { source });
  return t('claim.says', { source, figures: joinList(figures) });
}

/** What is on screen after a page arrives, given what was on screen before.
 *
 *  Appending, never replacing. The visitor asked for more rows, not for the
 *  row they were about to press to be taken away while they reached for it.
 *
 *  A URL already listed is not added a second time. Upstream paging repeats
 *  itself in places, and one route printed twice reads as two routes.
 *
 *  `dropped` adds up across pages because each page counts only its own, and
 *  `totalKnown` stays null when the source did not say. A total is never
 *  guessed here: "showing 12 of 40" is a promise about a number we were told.
 *
 *  `setAside` adds up the same way, and stays null for a source that never
 *  sends it. It is the count of rows the service removed on purpose, which is
 *  a different thing from rows it could not use: on a source whose own filter
 *  is refused upstream it is the whole explanation for a page that came back
 *  empty, and a page that hides it looks broken instead of filtered. */
export function appendPage(shown, listing) {
  const rows = shown ? shown.rows.slice() : [];
  const seen = new Set(rows.map((row) => row.url));
  for (const row of listing.results) {
    if (seen.has(row.url)) continue;
    seen.add(row.url);
    rows.push(row);
  }

  const paging = listing.paging ?? {};
  const total = paging.totalKnown;
  const droppedNow = listing.droppedRows;
  const examinedNow = listing.examined;
  return {
    rows,
    page: typeof paging.page === 'number' ? paging.page : (shown?.page ?? 0),
    hasMore: paging.hasMore === true,
    totalKnown: typeof total === 'number' && Number.isFinite(total) ? total : null,
    dropped: (shown?.dropped ?? 0) + (typeof droppedNow === 'number' ? droppedNow : 0),
    setAside: addSetAside(shown?.setAside ?? null, listing.setAside),
    // How many rows the service read to fill these pages. It adds up like
    // `dropped` does, and stays null for an answer that never mentions it, so
    // the page cannot print a sentence about a scan that nobody performed.
    examined:
      typeof examinedNow === 'number' && Number.isFinite(examinedNow)
        ? (shown?.examined ?? 0) + examinedNow
        : (shown?.examined ?? null),
    // Which place the words were read as, and the other places they could have
    // meant. Both are carried forward: a later page answers the same question,
    // and one that leaves them out must not erase what the first page said.
    // `placeUsed` when two sites were asked, `place` when Wikiloc answered on
    // its own. Two names for one fact, and the page needs the fact either way:
    // a Wikiloc-only search is exactly where a bad guess is invisible, because
    // there is no second site whose rows disagree with it.
    placeUsed:
      placeFrom(listing.query?.placeUsed ?? listing.query?.place) ??
      shown?.placeUsed ??
      null,
    places: placesFrom(listing.places) ?? shown?.places ?? [],
    // Which sites answered this page and which did not, newest first: a site
    // that answered the first page and failed the second has failed, and the
    // page has to be able to say so.
    sources: Array.isArray(listing.sources) ? listing.sources : (shown?.sources ?? null),
    // Which source answered, and what it calls itself, kept beside the rows.
    // Both, because the page has its own name for a source it knows and needs
    // the id to look it up: changing the dropdown must not relabel rows that
    // are already on screen.
    sourceId: listing.source?.id ?? shown?.sourceId ?? '',
    source: listing.source?.label ?? shown?.source ?? '',
  };
}

/** One place, or null when what arrived is not one.
 *
 *  A name and both halves of a coordinate, all three or nothing: a place with
 *  half a coordinate cannot be searched again, and a place with no name cannot
 *  be told apart from the one already used. */
function placeFrom(value) {
  const name = value?.name;
  const lat = value?.lat;
  const lng = value?.lng;
  if (typeof name !== 'string' || !name.trim()) return null;
  if (typeof lat !== 'number' || !Number.isFinite(lat)) return null;
  if (typeof lng !== 'number' || !Number.isFinite(lng)) return null;
  return { name, lat, lng };
}

/** The places an answer offers, or null when it offered none.
 *
 *  Null rather than an empty list, so the caller can tell "this page said
 *  nothing about places" from "this page said there are none". */
function placesFrom(listed) {
  if (!Array.isArray(listed)) return null;
  const places = listed.map(placeFrom).filter(Boolean);
  return places.length > 0 ? places : null;
}

/** The running total of rows removed on purpose, or null.
 *
 *  Null rather than a bag of zeroes when no source has ever sent one, so the
 *  page has one thing to test before it says anything: a source that does no
 *  filtering of its own should never make the page print a sentence about
 *  filtering that did not happen. */
function addSetAside(running, arriving) {
  if (!arriving || typeof arriving !== 'object') return running;
  const total = { ...(running ?? {}) };
  for (const [reason, count] of Object.entries(arriving)) {
    if (typeof count !== 'number' || !Number.isFinite(count)) continue;
    total[reason] = (total[reason] ?? 0) + count;
  }
  return total;
}

// ---------------------------------------------------------------- the places
//
// A place is a name and a point, and only the point identifies it. `montserrat`
// answers with a village in Valencia and an island in the Caribbean 6,000 km
// away, and a geocoder that has no region for one of them names both of them
// `Montserrat`. So everything below tells places apart by point, and the name is
// only ever something to read.

/** Whether two places are the same place.
 *
 *  Four decimals is about eleven metres, which is finer than any two names for
 *  one village will ever disagree by, and coarser than the rounding either
 *  geocoder does. */
export function samePoint(a, b) {
  if (!a || !b) return false;
  return Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4;
}

/** The place a press was about, found among places that may share a name.
 *
 *  BY POINT, NEVER BY NAME, and this function exists so there is one way to do
 *  it. Resolving a press by name takes the first match, and when the answer
 *  holds two places called `Montserrat` the first match is not the one that was
 *  pressed: the page then searched a Valencian village and said, over routes
 *  from two other regions, that nothing had been guessed.
 *
 *  Null when nothing matches, which is a list redrawn under the visitor's
 *  finger rather than a place that moved. Doing nothing is the right answer to
 *  that: it leaves the rows they can see. */
export function placeAtPoint(places, point) {
  if (!Array.isArray(places) || !point) return null;
  return places.find((place) => samePoint(place, point)) ?? null;
}

/** The places to offer instead of the one in use, and whether each needs its
 *  coordinate shown to be told from the others.
 *
 *  The place already in use is left out: a button that re-runs the search you
 *  are looking at is a button that appears to do nothing.
 *
 *  `ambiguous` is counted over the WHOLE answer, not over what survives the
 *  filter above. Two places named `Montserrat` where one of them is the place in
 *  use leaves one button reading `Montserrat` and a line above it reading
 *  `Montserrat`, and a visitor has no way to see that those are 6,000 km apart.
 *  The coordinate is the only thing this page has that separates them, so on
 *  those buttons it is shown. */
export function placeChoices(places, here) {
  const listed = Array.isArray(places) ? places : [];
  const named = new Map();
  for (const place of listed) named.set(place.name, (named.get(place.name) ?? 0) + 1);
  return listed
    .filter((place) => !samePoint(place, here))
    .map((place) => ({ place, ambiguous: (named.get(place.name) ?? 0) > 1 }));
}

/** Which sites in one answer applied the point the visitor picked, and which
 *  worked the place out from the words instead.
 *
 *  Two lists, because the two are different sentences and the page owes the
 *  visitor both. It is read from the answer and never decided here: whether a
 *  site can be pointed at a place is a fact about that site, it was measured
 *  against the site, and it is written down beside the code that sends the
 *  point. See `POINT_APPLIED` in each source module.
 *
 *  Both lists empty means no point was sent, or a single site answered and had
 *  no per-site record to keep. Only a site that answered is listed: one that
 *  failed contributed no rows, and the page already says it failed. */
export function pointHonoured(shown) {
  const listed = Array.isArray(shown?.sources) ? shown.sources : [];
  const applied = [];
  const ignored = [];
  for (const source of listed) {
    if (!source || source.ok !== true || typeof source.id !== 'string') continue;
    if (source.pointApplied === true) applied.push(source.id);
    if (source.pointApplied === false) ignored.push(source.id);
  }
  return { applied, ignored };
}

/** The activity list a source offers, read from the service's answer.
 *
 *  Read rather than written down here, because the vocabularies belong to the
 *  sites and change without warning. An answer that carries no list at all
 *  leaves the caller with what it had, which is the only thing that keeps the
 *  form usable when the service is having a bad minute.
 *
 *  `labels` is how a source spells its own words, when it says. It is not a
 *  translation and it is never treated as one: it is the difference between a
 *  dropdown offering "trail-running" and one offering "Trail Running", both of
 *  which are Wikiloc's word for the same thing. A source that sends no labels
 *  gets an empty map and its slugs are printed as they arrive. */
export function catalogueFrom(payload, fallback) {
  const listed = Array.isArray(payload?.sports) ? payload.sports : [];
  const sports = listed.filter((sport) => typeof sport === 'string' && sport.trim());
  if (sports.length === 0) return fallback;

  const labels = {};
  const named = Array.isArray(payload.activities) ? payload.activities : [];
  for (const activity of named) {
    const id = activity?.id;
    const label = activity?.label;
    if (typeof id === 'string' && typeof label === 'string' && label.trim()) {
      labels[id] = label;
    }
  }

  const preferred = payload.default;
  return {
    sports,
    labels,
    default: typeof preferred === 'string' && sports.includes(preferred) ? preferred : sports[0],
  };
}

/** Which activity the dropdown shows.
 *
 *  A change of source resets it, even when the old choice happens to be a word
 *  the new source also uses. The two vocabularies are not merged and one is not
 *  translated into the other: "mtb" on two sites is not a promise that the two
 *  sites mean the same routes by it. Within one source the choice is kept, so
 *  running the same search again does not silently change the question. */
export function sportAfterSource(catalogue, previous, sourceChanged) {
  if (sourceChanged) return catalogue.default;
  return catalogue.sports.includes(previous) ? previous : catalogue.default;
}

/** Which sites the picker offers, worked out from what the service answered.
 *
 *  A demonstration, not a hope. The service is asked for each site's activity
 *  list BY NAME, and a name it does not search is refused outright rather than
 *  answered with something else. So a site is offered exactly when the service
 *  has answered for it, and nothing about which sites exist is written down
 *  twice.
 *
 *  Both sites at once is one of the names, and it is first, because nobody
 *  looking for a route near a village cares which website holds it. Asking one
 *  at a time is a filing system leaking into a question.
 *
 *  Until the first answer arrives, the first name is offered on its own: a
 *  control that is empty for a second reads as broken, and one that offers
 *  three sites before the service has agreed to any of them is a guess. */
export function sourcesOffered(known, answered) {
  const confirmed = known.filter((source) => answered.has(source.id));
  return confirmed.length > 0 ? confirmed : known.slice(0, 1);
}

/** Which of the offered sites is chosen.
 *
 *  The visitor's own pick survives every later answer. It is only overridden
 *  when the service has said it does not search that site at all, and then the
 *  first offered site takes over rather than the control going blank. */
export function sourceChosen(offered, chosen) {
  if (offered.some((source) => source.id === chosen)) return chosen;
  return offered[0]?.id ?? '';
}

// Not an activity: the word that means narrow nothing. Both sites and the
// merged source use it, so it is written down once, here, rather than in the
// three places that would drift apart.
export const ANY_ACTIVITY = 'all';

/** The activities one dropdown offers, and which one it starts on.
 *
 *  The two dropdowns cannot offer the same list, and the difference is not a
 *  matter of taste.
 *
 *  NEARBY MUST NOT OFFER "any activity". Komoot cannot list routes around a
 *  point without a sport, so it is a question the service cannot ask, and it
 *  refuses rather than quietly sending hiking and handing back a list nobody
 *  asked for. A control that offers a choice the service will refuse is worse
 *  than one that does not offer it, so it is taken out here rather than
 *  explained in an error afterwards.
 *
 *  SEARCH ALWAYS OFFERS IT, and starts there. Searching words with no activity
 *  is a question every source takes, and it is the least presumptuous place to
 *  begin: a visitor who typed a valley's name has not yet said they only want
 *  to walk it. It is added when the source's own list has no word for it,
 *  because "no activity chosen" is the absence of one of the source's words
 *  rather than another one of them. */
export function activityChoices(catalogue, mode) {
  const listed = Array.isArray(catalogue?.sports) ? catalogue.sports : [];

  if (mode === 'nearby') {
    const sports = listed.filter((sport) => sport !== ANY_ACTIVITY);
    const preferred = catalogue?.default;
    return {
      sports,
      default: sports.includes(preferred) ? preferred : (sports[0] ?? ''),
    };
  }

  return {
    sports: listed.includes(ANY_ACTIVITY) ? listed.slice() : [ANY_ACTIVITY, ...listed],
    default: ANY_ACTIVITY,
  };
}

/** The body of a Search, or the key to the sentence saying why there is none.
 *
 *  Refused here rather than upstream: a blank query spends a request to be told
 *  what the page already knows.
 *
 *  `place` is the one the visitor picked out of the places the last answer
 *  offered, and it is why this is worth a function of its own. Sent as a point,
 *  the service geocodes nothing and both sites are asked about the same valley.
 *  Left out, the words go to a geocoder that reads "montserrat" as a village in
 *  the Valencian Community, 300 km from the mountain in Catalonia, while Komoot
 *  reads it as the mountain, and one interleaved list then holds two valleys.
 *
 *  "Any activity" leaves as no activity at all rather than as the word "all",
 *  because it is the absence of a choice rather than one of the source's own
 *  words, and not every source has a word for it. */
export function searchRequest({ source, query, sport, place, limit }) {
  const words = String(query ?? '').trim();
  if (words.length < 2) return { errorKey: 'query' };
  return {
    body: {
      source,
      query: words,
      sport: sport && sport !== ANY_ACTIVITY ? sport : null,
      near: place ? { lat: place.lat, lng: place.lng } : null,
      limit,
      page: 0,
    },
  };
}

/** The body of a Nearby, or the key to the sentence saying why there is none.
 *
 *  An activity is required and there is no default to fall back on. Komoot
 *  cannot list routes around a point without a sport, so "any activity" is a
 *  question the service cannot ask; sending it hiking quietly would hand back a
 *  list nobody asked for, so it is refused instead. The dropdown does not offer
 *  the choice either, so this only fires before the activity list has arrived.
 *
 *  `lat` and `lng` arrive already read, because what counts as a typed
 *  coordinate is the form's business and not this one's. */
export function nearbyRequest({ source, lat, lng, sport, radiusM, limit }) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return { errorKey: 'location' };
  if (!sport || sport === ANY_ACTIVITY) return { errorKey: 'sport' };
  return {
    body: { source, lat, lng, sport, radiusM, limit, page: 0 },
  };
}

/** Which sites answered a list, and which did not and why.
 *
 *  Only the failures come back, because only they need saying. A short list
 *  because one site was down reads exactly like a short list because a valley
 *  is empty, and they are not the same thing.
 *
 *  An answer from a single site carries no such record and gets an empty list:
 *  a site that fails on its own is an error, not half an answer, and the page
 *  already has a sentence for that. */
export function sourcesMissing(shown) {
  const listed = shown?.sources;
  if (!Array.isArray(listed)) return [];
  return listed
    .filter((source) => source && source.ok !== true && typeof source.id === 'string')
    .map((source) => ({
      id: source.id,
      error: typeof source.error === 'string' && source.error ? source.error : 'network',
    }));
}
