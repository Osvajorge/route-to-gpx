// Search and Nearby, minus the browser.
//
// Neither is a second product. Both end in the same conversion the link field
// already runs, and a list of routes is only a way of reaching one URL. What
// lives here is the part of that which is arithmetic over the service's answer,
// so the rules that are easy to get quietly wrong can be checked without a
// browser: a claim that omits what the source did not publish, a page that is
// added to the list rather than put in its place, and an activity list that
// belongs to one source and is never merged with another's.

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
 *  guessed here: "showing 12 of 40" is a promise about a number we were told. */
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
  return {
    rows,
    page: typeof paging.page === 'number' ? paging.page : (shown?.page ?? 0),
    hasMore: paging.hasMore === true,
    totalKnown: typeof total === 'number' && Number.isFinite(total) ? total : null,
    dropped: (shown?.dropped ?? 0) + (typeof droppedNow === 'number' ? droppedNow : 0),
    // The label the source calls itself, kept beside the rows it answered with.
    source: listing.source?.label ?? shown?.source ?? '',
  };
}

/** The activity list a source offers, read from the service's answer.
 *
 *  Read rather than written down here, because the vocabularies belong to the
 *  sites and change without warning. An answer that carries no list at all
 *  leaves the caller with what it had, which is the only thing that keeps the
 *  form usable when the service is having a bad minute. */
export function catalogueFrom(payload, fallback) {
  const listed = Array.isArray(payload?.sports) ? payload.sports : [];
  const sports = listed.filter((sport) => typeof sport === 'string' && sport.trim());
  if (sports.length === 0) return fallback;

  const preferred = payload.default;
  return {
    sports,
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

/** Which sources this service can search, worked out from its own answer.
 *
 *  Feature detection, not a guess about a future release. A service that knows
 *  about sources says so, either by listing them or by naming the one it just
 *  answered for. One that says neither is the service as it stands today, which
 *  searches a single site, so only that one is offered and the page keeps
 *  working exactly as it does now.
 *
 *  `known` is the pair of sites this page can already convert links from, most
 *  established first. */
export function sourcesFrom(payload, known) {
  const listed = Array.isArray(payload?.sources) ? payload.sources : [];
  const named = listed
    .map((source) => (typeof source === 'string' ? { id: source, label: source } : source))
    .filter((source) => source && typeof source.id === 'string' && source.id);
  if (named.length > 0) {
    return named.map((source) => ({
      id: source.id,
      label: typeof source.label === 'string' && source.label ? source.label : source.id,
    }));
  }

  const echoed = payload?.source;
  const id = typeof echoed === 'string' ? echoed : echoed?.id;
  if (typeof id === 'string' && id) return known;
  return known.slice(0, 1);
}
