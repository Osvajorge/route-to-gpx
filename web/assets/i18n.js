// English is the source language. Spanish is a full translation, not a
// fallback: every key exists in both, and the toggle is remembered.
//
// House rule for both languages: say what the number means for the walk.
// No motivation, no celebration, no jargon.

export const LANGUAGES = ['en', 'es'];

const STRINGS = {
  en: {
    'lang.name': 'English',
    'lang.switch': 'Cambiar a español',

    'doc.title': 'Route to GPX',
    'skip.main': 'Skip to the tabs',

    'step1.heading': 'Get a GPX file, and the numbers behind it.',
    'tabs.label': 'How to find the route',
    'tab.search': 'Search',
    'tab.nearby': 'Nearby',
    'tab.link': 'Link',
    'step1.sub.link':
      'Paste a Komoot or Wikiloc link. We rebuild the track, measure it, and show you where the recording has holes.',
    'step1.sub.search':
      'Look a route up on the source site by name. Converting a row is what measures it.',
    'step1.sub.nearby':
      'Give a point and how far around it to look. Converting a row is what measures it.',
    'field.prefix': 'URL',
    'field.label': 'Route link',
    'field.placeholder': 'Paste the route link here',
    'action.paste': 'Paste',
    'action.convert': 'Convert',
    'action.converting': 'Working',
    'action.example': 'Load an example',
    'step1.hint':
      'komoot.com/tour/… · komoot.com/smarttour/… · any wikiloc.com trail page · or drop a .gpx anywhere on this page',
    'step1.drop': 'Drop the .gpx to measure it',

    'search.label': 'What to look for',
    'search.placeholder': 'A route, a peak, a valley',
    'search.submit': 'Search',
    'field.source': 'Source',
    'field.activity': 'Activity',
    // The one source whose name is a sentence rather than a proper noun, so it
    // is the one that gets translated.
    'source.both': 'Komoot and Wikiloc',

    'nearby.here': 'Use my location',
    'nearby.place': 'Search a place',
    'nearby.lat': 'Latitude',
    'nearby.lng': 'Longitude',
    'nearby.radius': 'Radius',
    'nearby.radiusOption': '{km} km',
    'nearby.submit': 'Find routes',

    'geo.asking': 'Asking your browser where you are.',
    'geo.filled': 'Latitude and longitude filled in from your browser.',
    'geo.refused':
      'Your browser did not share a position. Type the coordinates below, or search a place.',
    'geo.unavailable':
      'This browser cannot give a position. Type the coordinates below, or search a place.',

    'place.title': 'Search a place',
    'place.label': 'Place name',
    'place.placeholder': 'A town, a valley, a range',
    'place.find': 'Find',
    'place.working': 'Looking that place up.',
    'place.empty': 'No place came back by that name. Try another spelling.',
    'place.close': 'Close',

    // Which place a search was actually about. Wikiloc searches a box, so the
    // words have to become a point, and the geocoder that turns them into one
    // can pick a village 300 km from the mountain of the same name. Said above
    // the rows, because it changes what every one of them means.
    'place.usedLabel': 'The place these routes are from',
    'place.guessed':
      'Read as {place}. A village and a mountain often share a name, so check this is the one you meant.',
    // Three sentences for one press, because a merged list is two searches and
    // the point does not reach both of them. Wikiloc's search IS a box, so the
    // point becomes the box; Komoot geocodes the words itself and takes the
    // point only as a nudge to the ranking. Which is which is measured against
    // each site and written down beside the code that sends the point, and the
    // answer carries it per site. Saying "nothing was guessed" over the whole
    // list was false for half of it.
    //
    // The site names are interpolated, so the wording must read the same with
    // one name or two: "on {ignored} the place comes from the words" is true
    // either way, and no verb has to agree with a list.
    'place.picked': 'Searching around {place}, the place you picked. Nothing was guessed.',
    'place.pickedPartly':
      'You picked {place}. On {applied} the search went to that point. On {ignored} the place comes from the words themselves, so those routes can be somewhere else entirely.',
    'place.pickedNone':
      'You picked {place}, but nothing here searched around it: on {ignored} the place comes from the words themselves, so these routes can be somewhere else entirely.',
    'place.others': 'Search the same words somewhere else:',
    // The spoken form of a button that had to carry its coordinate. The middle
    // dot that separates the pair on screen reads as nothing out loud, so out
    // loud each number is named.
    'place.swapAt': '{place}, at latitude {lat}, longitude {lng}',
    // Said only after a source has been handed a point and answered about
    // somewhere else. The buttons go with it: a control that visibly does
    // nothing is worse than no control at all.
    'place.stuck':
      'This source works the place out from the words itself, so picking a different one does not move the search.',

    // The site is named inside the sentence, never beside it, so its figures
    // can never be read as something this page measured.
    'claim.says': '{source} says {figures}.',
    'claim.none': '{source} publishes no figures for this one.',
    'claim.distance': '{km} km',
    'claim.ascent': '{m} m up',
    'claim.descent': '{m} m down',
    'claim.highest': 'a high point of {m} m',

    // A card is denser than a row and cannot spend a sentence on each figure,
    // so the attribution is spent once, as the heading of the block that holds
    // every figure. Nothing outside that block is a number.
    'card.claim': 'What {source} says',
    'card.duration': 'Time',
    'card.start': 'Start',
    'card.time.hm': '{h} h {m} min',
    'card.time.h': '{h} h',
    'card.time.m': '{m} min',
    'card.rating': '{score} out of 5, from {count} ratings on {source}',
    'card.rating.one': '{score} out of 5, from one rating on {source}',
    'card.rating.none': '{score} out of 5 on {source}',
    'card.updated': 'Updated {when}',
    'card.shapeAlt': 'The shape of this route, drawn here from the line {source} publishes',
    'card.gpx': 'GPX',
    'card.gpx.label': 'Convert this route and download the GPX',
    'card.chart': 'Map and elevation profile',
    'card.adjust': 'Re-arrange this route',
    'card.adjust.missing': 'Re-arranging is not built yet. The other three work.',
    'card.open': 'Open on {source}',
    'grade.easy': 'Easy',
    'grade.moderate': 'Moderate',
    'grade.difficult': 'Difficult',
    'grade.label': '{source} grades this {grade}',

    'finder.list': 'Routes {source} answered with',
    'finder.working.search': 'Asking {source} which routes match.',
    'finder.working.nearby': 'Asking {source} which routes start near that point.',
    'finder.more': 'Load more',
    'finder.moreWorking': 'Loading',
    'finder.count': 'Showing {shown} of the {total} {source} lists.',
    'finder.moreEmpty': 'That page added nothing new. There may still be more behind it.',
    'finder.dropped.one':
      'One more from {source} could not be opened here, so it is not listed.',
    'finder.dropped.many':
      '{count} more from {source} could not be opened here, so they are not listed.',
    // Different from the line above, and the difference matters: those could
    // not be opened, these could and were not wanted. On a source that will not
    // filter for us, this sentence is the whole reason a page came back short.
    'finder.setAside.one': 'One more was for another activity, so it is not shown.',
    'finder.setAside.many': '{count} more were for other activities, so they are not shown.',
    // How much was read to fill the page. This is what turns one via ferrata
    // route out of a hundred from a page that looks broken into a true thing
    // about that valley. Printed only when the answer carries the number.
    'finder.examined': 'We read {count} routes to fill this page.',
    'finder.outside.one': 'One more started outside the radius, so it is not shown.',
    'finder.outside.many': '{count} more started outside the radius, so they are not shown.',
    // With two sites asked at once, one of them failing must be said. A short
    // list because a site was down reads exactly like a short list because a
    // valley is empty.
    'finder.siteFailed':
      '{source} did not answer, so nothing of theirs is in this list. What is here came from the other site.',
    'finder.siteBusy':
      '{source} asked us to slow down, so nothing of theirs is in this list. What is here came from the other site. Try again in a moment.',

    'empty.search.title': 'Nothing came back for those words.',
    'empty.search.body':
      'Try another spelling, the name of the nearest village, or a different activity.',
    'empty.nearby.title': 'Nothing came back within that radius.',
    'empty.nearby.body':
      'Try a wider radius, a different activity, or a point nearer a trailhead.',

    // Not an activity: the setting that narrows nothing. Every other word in
    // this dropdown belongs to the source site, and is printed as the source
    // spells it.
    'sport.all': 'Any activity',
    // Said under the dropdown on a source whose own activity filter is refused
    // to us, so the control is honest about where the narrowing happens rather
    // than removed.
    'activity.notFiltered':
      'Wikiloc will not filter by activity for a visitor who is not logged in, so our server reads several pages of its results and keeps the ones that match.',
    // Said only when a word ON SCREEN is the source's own rather than ours,
    // counting the cards and not just the dropdown: on both sites at once the
    // dropdown is Komoot's six, all translated, while the cards below carry
    // Wikiloc's words and Komoot's own unlisted ones.
    //
    // Printing the source's own spelling is honest; guessing at a translation
    // for eighty terms nobody here can check would not be. The separators are
    // the one thing changed, and the sentence says so, because a word arriving
    // as `mtb_easy` is a machine name and must not reach a reader as one.
    'activity.sourceWords':
      'Activities we have no word for keep the source site\'s own word, not ours.',

    // THE ACTIVITY WORDS, and the decision behind which ones are here.
    //
    // Wikiloc offers eighty-one activities and Komoot six. Translating all
    // eighty-one would mean writing Spanish for terms nobody here can check,
    // which is exactly the kind of confident wrong word this page exists not to
    // print. Leaving all of them in English would mean a Spanish dropdown
    // reading "Baby Stroller, Golf, Snowshoe".
    //
    // So: the mountain activities a walker on this page actually reaches are
    // translated, and the long tail is printed exactly as the source spells it,
    // with `activity.sourceWords` saying so under the dropdown. Komoot's own
    // slugs come first because they are the shortest list; the rest are
    // Wikiloc's, and the shared vocabulary the merged source uses reuses both.
    'sport.hike': 'Hiking',
    'sport.touringbicycle': 'Touring bike',
    'sport.mtb': 'Mountain bike',
    'sport.racebike': 'Road bike',
    'sport.jogging': 'Running',
    'sport.mountaineering': 'Mountaineering',

    // Komoot's activity picker offers six words and its rows return more.
    // `mtb_easy` arrived on a live search for `delta del ebro` on 2026-09-02,
    // and asking Komoot for `sport=mtb_easy` answers with rows of that sport,
    // so it is one of its own words and not a stray. It is written down here
    // because it is the one extra word that was seen; the rest are covered by
    // `sourceOwnWord`, which opens a slug into something readable rather than
    // guessing what it means.
    'sport.mtb_easy': 'Mountain bike, easy',

    'sport.hiking': 'Hiking',
    'sport.walking': 'Walking',
    'sport.running': 'Running',
    'sport.trail-running': 'Trail running',
    'sport.nordic-walking': 'Nordic walking',
    'sport.orienteering': 'Orienteering',
    'sport.alpine-climbing': 'Alpine climbing',
    'sport.rock-climbing': 'Rock climbing',
    'sport.ice-climbing': 'Ice climbing',
    'sport.via-ferrata': 'Via ferrata',
    'sport.canyoneering': 'Canyoneering',
    'sport.spelunking': 'Caving',
    'sport.snowshoe': 'Snowshoeing',
    'sport.alpine-ski': 'Alpine skiing',
    'sport.backcountry-ski': 'Ski touring',
    'sport.cross-country-ski': 'Cross-country skiing',
    'sport.snowboarding': 'Snowboarding',
    'sport.splitboard': 'Splitboarding',
    'sport.mountain-bike': 'Mountain bike',
    'sport.downhill-mtb': 'Downhill mountain bike',
    'sport.gravel-bike': 'Gravel bike',
    'sport.road-bike': 'Road bike',
    'sport.bicycle-touring': 'Bike touring',
    'sport.bikepacking': 'Bikepacking',
    'sport.ebike': 'Electric bike',
    'sport.horseback-riding': 'Horse riding',
    // The shared vocabulary the merged source uses, where its word is neither
    // site's own spelling.
    'sport.road-cycling': 'Road bike',
    'sport.bike-touring': 'Bike touring',

    'stage.fetch': 'Reading the page',
    'stage.extract': 'Extracting the track',
    'stage.measure': 'Measuring',
    'stage.fetch.active': 'request in flight',
    'stage.extract.active': 'locating the coordinate block',
    'stage.measure.active': 'ascent, gaps, spacing',
    'stage.pending': 'waiting',
    'stage.progress': 'Converting the route',

    'error.domain.title': 'We do not recognise that link.',
    'error.domain.body':
      'We read Komoot tour and smarttour links, and any Wikiloc trail page. From anywhere else, export the GPX there and drop the file here. We measure it exactly the same.',
    'error.track.title': 'That page no longer carries the track where we expected it.',
    'error.track.body':
      'The page loaded but carries no coordinate block, usually because the route is private or the site changed its format. Export the GPX there and drop the file here.',
    'error.private.title': 'That route is private.',
    'error.private.body':
      'Its owner has not published the track, so there is nothing for us to read. If it is your own route, export the GPX from your account and drop the file here.',
    'error.highlight.title': 'That link is a highlight, not a route.',
    'error.highlight.body':
      'A Komoot highlight is a single place: a viewpoint, a spring, a hut. Open it, pick one of the tours that pass through it, and paste that link instead.',
    'error.collection.title': 'That link is a collection, not a single route.',
    'error.collection.body':
      'A Komoot collection is a list of tours, often the stages of one long route. Open the stage you want and paste its link.',
    'error.guide.title': 'That link is a region guide, not a route.',
    'error.guide.body':
      'A Komoot guide lists many routes for an area. Open the one you want and paste its link.',
    'error.notfound.title': 'That route does not exist.',
    'error.notfound.body':
      'The link points at an ID the site does not know. Check it against the address bar on the route page itself.',
    'error.file.title': 'That file is not a GPX track.',
    'error.file.body':
      'We opened it and found no track points. GPX exported from a watch or a route planner will work; a KML, a FIT or a screenshot will not.',
    'error.busy.title': 'Too many at once. Give it a moment.',
    'error.busy.body':
      'Wait a few seconds and try the same link again. We read the source sites slowly on purpose, so nothing is broken.',
    'error.network.title': 'We could not reach the source site.',
    'error.network.body':
      'The request failed before we read anything. Try again in a moment. If it keeps failing, export the GPX from the site and drop the file here.',
    'error.query.title': 'There is nothing to search for yet.',
    'error.query.body':
      'A search needs at least two characters. Type the name of a route, a peak or a village.',
    'error.location.title': 'That is not a point on earth.',
    'error.location.body':
      'Latitude runs from -90 to 90, longitude from -180 to 180, with a full stop or a comma: 42.6417. Use my location and Search a place fill in both for you.',
    'error.sport.title': 'That source has no such activity.',
    'error.sport.body':
      'The activity list belongs to the source site and changes with it. Pick one from the list again.',

    'step2.download': 'Download GPX',
    'step2.reset': 'New link',
    'measure.distance': 'Distance',
    // How much of the distance above is a straight line over ground nobody
    // recorded. The distance counts it as walked, and the gap tile beside it
    // was the only thing on the page that knew.
    'measure.distance.gaps': 'across gaps {gaps}',
    'measure.ascent': 'Ascent',
    // The one parameter of the three that moves the number, named and measured
    // in the same shape the gap tile names and measures its threshold. The
    // fold under the tiles is where the word is spelled out.
    'measure.ascent.step': 'sampling {step} m',
    // The input that moves the number most, shown only on the recordings where
    // it is moving it. Half the heights missing took the ascent 47% low.
    'measure.ascent.coverage': 'coverage {coverage}%',
    'measure.gap': 'Largest gap',
    // Measured all along, printed nowhere, which is why reversing a route
    // looked like it changed the ascent when it had only swapped the two.
    'measure.descent': 'Descent',
    'measure.rawAscent': 'Raw ascent',
    'measure.rawAscent.note': 'no filter',
    'measure.elevation.raw': 'file holds {min}-{max}',
    'measure.points': 'Points',
    'measure.spacing': 'Mean spacing',
    'measure.elevation': 'Elevation',
    'compare.matches': 'matches',
    'compare.source': 'source',
    'compare.notPublished': 'not published by the source',
    'gap.at': 'at km {km}',
    'gap.threshold': 'threshold {threshold} m',
    'gap.none': 'no gap over {threshold} m',

    // Ascent is the output of three parameters, and a reader who sees ours
    // disagree with the source's is owed all three. Folded away, because the
    // disagreement is the headline and the arithmetic is not.
    'method.summary': 'How ascent is measured',
    'method.sampling':
      "The height profile is sampled every {step} m, never finer than the recording's own spacing, then median filtered over {window} samples. Rises under {noise} m are dropped as GPS noise.",
    'chart.trace': 'Route trace',
    'chart.profile': 'Elevation profile',
    'chart.start': 'start / finish',
    'chart.gapDrawn': 'gap drawn straight',
    'chart.noData': 'no data',
    'chart.gapLabel': 'gap {gap} m',

    'map.hide': 'Hide map',
    'map.show': 'Show map',
    // The licence condition, not a nicety: attribution to OpenStreetMap, with
    // the name linking to the copyright page so the licence is one click away.
    'map.attribution':
      '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',

    'warning.gap':
      '{gap} m unrecorded at km {km}. Your watch will cut straight across. Check that stretch before you go.',

    // The two dialogs a card opens. Both are our own work on the visitor's own
    // machine, which is why neither names a source site anywhere near a number.
    'dialog.close': 'Close',

    'preview.kicker': 'Measured from the file',
    'preview.note':
      'Measured in your browser, from the track we rebuilt. Nothing here comes from the source site.',
    'preview.report': 'Full report',

    'rotate.kicker': 'Re-arrange',
    'rotate.lede': 'Turn it around, or move where it starts.',
    'rotate.rule':
      'The allowance is 2% of the route\'s own length, between {floor} m and {ceiling} m.',
    'rotate.detected.closed':
      'Closed ring. The recording ends where it started, so moving the start costs nothing.',
    'rotate.detected.near':
      'Ring. The two ends are {ends} apart, inside the {tolerance} allowed on {km} km. Moving the start puts that {ends} into the middle of the file, as a straight line.',
    'rotate.detected.open':
      'Not a ring. The two ends are {ends} apart, past the {tolerance} allowed on {km} km. Only reversing is offered: moving the start would draw that {ends} straight through the track.',
    'rotate.reverse': 'Reverse the direction',
    'rotate.start.label': 'Start point',
    'rotate.start.value': 'km {km} of the original recording',
    'rotate.reset': 'Back to the original',
    'rotate.measured': 'Measured from this arrangement',
    'rotate.against': 'original {value}',
    'rotate.seam.warn':
      '{gap} m of straight line at km {km}, where the two ends of the recording now meet. Your watch will cut across it, and it was not in the file before you moved the start.',
    'rotate.seam.small':
      'Moving the start joined the two ends of the recording. That seam is {gap} m, under the {threshold} m this page calls a gap.',
    'rotate.times.one':
      'One recorded time is dropped: re-ordering makes it wrong, and none is invented to replace it.',
    'rotate.times.many':
      '{count} recorded times are dropped: re-ordering makes them wrong, and none are invented to replace them.',
    'rotate.notrim':
      'Nothing is trimmed: every point of the recording is in the file, in a different order.',
    'rotate.unchanged': 'Nothing has been changed yet, so this is the recording as it arrived.',
    'rotate.download': 'Download this arrangement',
    'rotate.filename': 'Saved as {name}',

    // Written into the file itself, in the language the page is in, so the
    // description says what was done to the track and what it now measures.
    'rotate.desc.none': 'Rebuilt without changing the order of the recording.',
    'rotate.desc.reversed': 'The direction of the recording was reversed.',
    'rotate.desc.moved': 'The start was moved to km {km} of the original recording.',
    'rotate.desc.both':
      'The start was moved to km {km} of the original recording, and the direction was reversed.',
    'rotate.desc.seam':
      'This joined the two ends of the recording and left a {gap} m straight line at km {km}, which nobody walked.',
    'rotate.desc.times': 'Recorded times were dropped because the order changed. None were invented.',
    'rotate.desc.measured': 'Measured after the change: {km} km, {ascent} m of ascent.',

    'provenance':
      'The original link is written into the file, in <code>&lt;metadata&gt;&lt;link&gt;</code> and in the track name.',
    // A dropped file is handed back exactly as it arrived, so the sentence
    // above would be false precisely where there is no provenance to keep.
    'provenance.none':
      'This is your own file, handed back exactly as you dropped it. Nothing was written into it and nothing was taken out.',
    'provenance.file': '{name} · {size}',
    'source.line': '{source} · read {when}',
    'source.file': 'Your file',
    'when.today': 'today',

    'footer.processing.file':
      'GPX files you drop are read in this browser and never uploaded.',
    'footer.processing.url':
      'Links are fetched by our server, parsed, and thrown away. A card\'s outline is held in memory so it is not fetched twice. Nothing is written down, and there are no accounts.',
    'footer.processing.map':
      'Your browser loads the map background straight from OpenStreetMap, so they see your IP address and roughly where your route is. You can turn it off on the trace chart.',
    'footer.processing.fonts':
      'Your browser loads the two typefaces straight from Google Fonts, so Google sees your IP address as the page opens, before you press anything.',
    'footer.source': 'Source code',
  },

  es: {
    'lang.name': 'Español',
    'lang.switch': 'Switch to English',

    'doc.title': 'Ruta a GPX',
    'skip.main': 'Ir a las pestañas',

    'step1.heading': 'Consigue el GPX, y los números que hay detrás.',
    'tabs.label': 'Cómo encontrar la ruta',
    'tab.search': 'Buscar',
    'tab.nearby': 'Cerca',
    'tab.link': 'Enlace',
    'step1.sub.link':
      'Pega un enlace de Komoot o de Wikiloc. Reconstruimos el track, lo medimos y te enseñamos dónde tiene agujeros la grabación.',
    'step1.sub.search':
      'Busca una ruta por su nombre en el sitio de origen. Convertir una fila es lo que la mide.',
    'step1.sub.nearby':
      'Da un punto y cuánto mirar a su alrededor. Convertir una fila es lo que la mide.',
    'field.prefix': 'URL',
    'field.label': 'Enlace de la ruta',
    'field.placeholder': 'Pega aquí el enlace de la ruta',
    'action.paste': 'Pegar',
    'action.convert': 'Convertir',
    'action.converting': 'Trabajando',
    'action.example': 'Cargar un ejemplo',
    'step1.hint':
      'komoot.com/tour/… · komoot.com/smarttour/… · cualquier página de ruta de wikiloc.com · o suelta un .gpx en cualquier punto de la página',
    'step1.drop': 'Suelta el .gpx para medirlo',

    'search.label': 'Qué buscar',
    'search.placeholder': 'Una ruta, un pico, un valle',
    'search.submit': 'Buscar',
    'field.source': 'Origen',
    // El único origen cuyo nombre es una frase y no un nombre propio, así que
    // es el único que se traduce.
    'source.both': 'Komoot y Wikiloc',
    'field.activity': 'Actividad',

    'nearby.here': 'Usar mi ubicación',
    'nearby.place': 'Buscar un lugar',
    'nearby.lat': 'Latitud',
    'nearby.lng': 'Longitud',
    'nearby.radius': 'Radio',
    'nearby.radiusOption': '{km} km',
    'nearby.submit': 'Buscar rutas',

    'geo.asking': 'Preguntando al navegador dónde estás.',
    'geo.filled': 'Latitud y longitud rellenadas desde tu navegador.',
    'geo.refused':
      'Tu navegador no ha compartido la posición. Escribe las coordenadas abajo, o busca un lugar.',
    'geo.unavailable':
      'Este navegador no puede dar una posición. Escribe las coordenadas abajo, o busca un lugar.',

    'place.title': 'Buscar un lugar',
    'place.label': 'Nombre del lugar',
    'place.placeholder': 'Un pueblo, un valle, una sierra',
    'place.find': 'Localizar',
    'place.working': 'Buscando ese lugar.',
    'place.empty': 'No ha vuelto ningún lugar con ese nombre. Prueba a escribirlo de otra forma.',
    'place.close': 'Cerrar',

    // De qué lugar habla realmente una búsqueda. Wikiloc busca dentro de un
    // recuadro, así que las palabras tienen que convertirse en un punto, y el
    // geocodificador que las convierte puede elegir un pueblo a 300 km de la
    // montaña que se llama igual. Se dice encima de las filas, porque cambia lo
    // que significa cada una de ellas.
    'place.usedLabel': 'El lugar del que salen estas rutas',
    'place.guessed':
      'Interpretado como {place}. Es habitual que un pueblo y una montaña se llamen igual, así que comprueba que sea el que querías.',
    // Tres frases para una pulsación: una lista combinada son dos búsquedas y
    // el punto no llega a las dos. La explicación completa está en la versión
    // inglesa. Como los nombres de los sitios se interpolan, la redacción tiene
    // que valer igual con uno que con dos, sin que ningún verbo concuerde con
    // una lista.
    'place.picked': 'Buscando alrededor de {place}, el lugar que elegiste. No se ha adivinado nada.',
    'place.pickedPartly':
      'Elegiste {place}. En {applied} la búsqueda ha ido a ese punto. En {ignored} el lugar sale de las palabras, así que esas rutas pueden estar en otra parte.',
    'place.pickedNone':
      'Elegiste {place}, pero aquí nada ha buscado a su alrededor: en {ignored} el lugar sale de las palabras, así que estas rutas pueden estar en otra parte.',
    'place.others': 'Buscar las mismas palabras en otro sitio:',
    'place.swapAt': '{place}, en latitud {lat}, longitud {lng}',
    // Solo se dice después de que un origen reciba un punto y responda sobre
    // otro lugar. Los botones desaparecen con ello: un control que a la vista
    // no hace nada es peor que no tener control.
    'place.stuck':
      'Este origen deduce el lugar de las palabras por su cuenta, así que elegir otro no mueve la búsqueda.',

    'claim.says': '{source} dice que son {figures}.',
    'claim.none': '{source} no publica ninguna cifra de esta ruta.',
    'claim.distance': '{km} km',
    'claim.ascent': '{m} m de subida',
    'claim.descent': '{m} m de bajada',
    'claim.highest': 'un techo de {m} m',

    'card.claim': 'Lo que dice {source}',
    'card.duration': 'Tiempo',
    'card.start': 'Salida',
    'card.time.hm': '{h} h {m} min',
    'card.time.h': '{h} h',
    'card.time.m': '{m} min',
    'card.rating': '{score} sobre 5, con {count} valoraciones en {source}',
    'card.rating.one': '{score} sobre 5, con una valoración en {source}',
    'card.rating.none': '{score} sobre 5 en {source}',
    'card.updated': 'Actualizada en {when}',
    'card.shapeAlt': 'La forma de esta ruta, dibujada aquí a partir del trazado que publica {source}',
    'card.gpx': 'GPX',
    'card.gpx.label': 'Convertir esta ruta y descargar el GPX',
    'card.chart': 'Mapa y perfil de altitud',
    'card.adjust': 'Reordenar esta ruta',
    'card.adjust.missing': 'Reordenar todavía no está hecho. Los otros tres sí funcionan.',
    'card.open': 'Abrir en {source}',
    'grade.easy': 'Fácil',
    'grade.moderate': 'Moderada',
    'grade.difficult': 'Difícil',
    'grade.label': '{source} la califica como {grade}',

    'finder.list': 'Rutas con las que responde {source}',
    'finder.working.search': 'Preguntando a {source} qué rutas encajan.',
    'finder.working.nearby': 'Preguntando a {source} qué rutas salen cerca de ese punto.',
    'finder.more': 'Cargar más',
    'finder.moreWorking': 'Cargando',
    'finder.count': 'Mostrando {shown} de las {total} que lista {source}.',
    'finder.moreEmpty': 'Esa página no ha añadido nada nuevo. Puede que todavía haya más detrás.',
    'finder.dropped.one':
      'Una más de {source} no se sabría abrir aquí, así que no está en la lista.',
    'finder.dropped.many':
      '{count} más de {source} no se sabrían abrir aquí, así que no están en la lista.',
    'finder.setAside.one': 'Una más era de otra actividad, así que no se muestra.',
    'finder.setAside.many': '{count} más eran de otras actividades, así que no se muestran.',
    // Cuánto se leyó para llenar la página. Es lo que convierte una vía ferrata
    // de cada cien en algo cierto sobre ese valle en lugar de en una página que
    // parece rota. Solo se imprime cuando la respuesta trae el número.
    'finder.examined': 'Hemos leído {count} rutas para llenar esta página.',
    'finder.outside.one': 'Una más empezaba fuera del radio, así que no se muestra.',
    'finder.outside.many': '{count} más empezaban fuera del radio, así que no se muestran.',
    // Con dos sitios consultados a la vez, hay que decir cuándo falla uno. Una
    // lista corta porque un sitio no respondió se lee igual que una lista corta
    // porque el valle está vacío.
    'finder.siteFailed':
      '{source} no respondió, así que no hay nada suyo en esta lista. Lo que ves viene del otro sitio.',
    'finder.siteBusy':
      '{source} nos pidió ir más despacio, así que no hay nada suyo en esta lista. Lo que ves viene del otro sitio. Inténtalo de nuevo en un momento.',

    'empty.search.title': 'No ha vuelto nada con esas palabras.',
    'empty.search.body':
      'Prueba a escribirlo de otra forma, con el nombre del pueblo más cercano, o con otra actividad.',
    'empty.nearby.title': 'No ha vuelto nada dentro de ese radio.',
    'empty.nearby.body':
      'Prueba con un radio mayor, con otra actividad, o con un punto más cerca de un inicio de ruta.',

    'sport.all': 'Cualquier actividad',
    'activity.notFiltered':
      'Wikiloc no filtra por actividad para quien no ha iniciado sesión, así que nuestro servidor lee varias páginas de sus resultados y se queda con las que coinciden.',
    // Solo se dice cuando una palabra EN PANTALLA es del origen y no nuestra,
    // contando las tarjetas y no solo el desplegable. Imprimir la palabra del
    // origen es honesto; inventar una traducción para ochenta términos que aquí
    // nadie puede comprobar, no. Lo único que se cambia son los separadores, y
    // la frase lo dice: una palabra que llega como `mtb_easy` es un nombre de
    // máquina y no puede llegar así a quien lee.
    'activity.sourceWords':
      'Las actividades para las que no tenemos palabra conservan la del propio origen, no la nuestra.',

    // LAS PALABRAS DE ACTIVIDAD. La decisión está explicada en la versión
    // inglesa: se traducen las actividades de montaña a las que llega de verdad
    // quien usa esta página, y el resto se imprime tal como lo escribe el
    // origen, con `activity.sourceWords` diciéndolo bajo el desplegable.
    'sport.hike': 'Senderismo',
    'sport.touringbicycle': 'Cicloturismo',
    'sport.mtb': 'BTT',
    'sport.racebike': 'Carretera',
    'sport.jogging': 'Correr',
    'sport.mountaineering': 'Alpinismo',

    // Una palabra de Komoot que su desplegable no ofrece pero sus filas sí
    // traen. La explicación y la medición están en la versión inglesa.
    'sport.mtb_easy': 'BTT, fácil',

    'sport.hiking': 'Senderismo',
    'sport.walking': 'Caminar',
    'sport.running': 'Correr',
    'sport.trail-running': 'Carrera por montaña',
    'sport.nordic-walking': 'Marcha nórdica',
    'sport.orienteering': 'Orientación',
    'sport.alpine-climbing': 'Alpinismo',
    'sport.rock-climbing': 'Escalada en roca',
    'sport.ice-climbing': 'Escalada en hielo',
    'sport.via-ferrata': 'Vía ferrata',
    'sport.canyoneering': 'Barranquismo',
    'sport.spelunking': 'Espeleología',
    'sport.snowshoe': 'Raquetas de nieve',
    'sport.alpine-ski': 'Esquí alpino',
    'sport.backcountry-ski': 'Esquí de travesía',
    'sport.cross-country-ski': 'Esquí de fondo',
    'sport.snowboarding': 'Snowboard',
    'sport.splitboard': 'Splitboard',
    'sport.mountain-bike': 'BTT',
    'sport.downhill-mtb': 'Descenso en BTT',
    'sport.gravel-bike': 'Bicicleta gravel',
    'sport.road-bike': 'Carretera',
    'sport.bicycle-touring': 'Cicloturismo',
    'sport.bikepacking': 'Bikepacking',
    'sport.ebike': 'Bicicleta eléctrica',
    'sport.horseback-riding': 'Equitación',
    // El vocabulario compartido del origen combinado, donde su palabra no es la
    // de ninguno de los dos sitios.
    'sport.road-cycling': 'Carretera',
    'sport.bike-touring': 'Cicloturismo',

    'stage.fetch': 'Leyendo la página',
    'stage.extract': 'Extrayendo el track',
    'stage.measure': 'Midiendo',
    'stage.fetch.active': 'petición en curso',
    'stage.extract.active': 'buscando el bloque de coordenadas',
    'stage.measure.active': 'desnivel, saltos, espaciado',
    'stage.pending': 'en espera',
    'stage.progress': 'Convirtiendo la ruta',

    'error.domain.title': 'No reconocemos ese enlace.',
    'error.domain.body':
      'Leemos enlaces de tour y de smarttour de Komoot, y cualquier página de ruta de Wikiloc. Desde otro sitio, exporta allí el GPX y suelta el fichero aquí. Lo medimos exactamente igual.',
    'error.track.title': 'Esa página ya no lleva el track donde lo esperábamos.',
    'error.track.body':
      'La página cargó pero no lleva bloque de coordenadas, casi siempre porque la ruta es privada o el sitio cambió de formato. Exporta allí el GPX y suelta el fichero aquí.',
    'error.private.title': 'Esa ruta es privada.',
    'error.private.body':
      'Quien la subió no ha publicado el track, así que no hay nada que leer. Si es tuya, exporta el GPX desde tu cuenta y suelta el fichero aquí.',
    'error.highlight.title': 'Ese enlace es un highlight, no una ruta.',
    'error.highlight.body':
      'Un highlight de Komoot es un sitio concreto: un mirador, una fuente, un refugio. Ábrelo, elige una de las rutas que pasan por ahí y pega ese enlace.',
    'error.collection.title': 'Ese enlace es una colección, no una ruta suelta.',
    'error.collection.body':
      'Una colección de Komoot es una lista de rutas, muchas veces las etapas de una travesía. Abre la etapa que quieras y pega su enlace.',
    'error.guide.title': 'Ese enlace es una guía de zona, no una ruta.',
    'error.guide.body':
      'Una guía de Komoot lista muchas rutas de una zona. Abre la que quieras y pega su enlace.',
    'error.notfound.title': 'Esa ruta no existe.',
    'error.notfound.body':
      'El enlace apunta a un identificador que el sitio no conoce. Compáralo con la barra de direcciones en la página de la ruta.',
    'error.file.title': 'Ese fichero no es un track GPX.',
    'error.file.body':
      'Lo abrimos y no tiene puntos de track. Sirve un GPX exportado de un reloj o de un planificador; no sirve un KML, un FIT ni una captura.',
    'error.busy.title': 'Demasiadas a la vez. Dale un momento.',
    'error.busy.body':
      'Espera unos segundos y prueba otra vez con el mismo enlace. Leemos los sitios de origen despacio a propósito, así que no se ha roto nada.',
    'error.network.title': 'No pudimos llegar al sitio de origen.',
    'error.network.body':
      'La petición falló antes de leer nada. Prueba otra vez en un momento. Si sigue fallando, exporta el GPX en el sitio y suelta el fichero aquí.',
    'error.query.title': 'Todavía no hay nada que buscar.',
    'error.query.body':
      'Una búsqueda necesita al menos dos caracteres. Escribe el nombre de una ruta, de un pico o de un pueblo.',
    'error.location.title': 'Eso no es un punto de la tierra.',
    'error.location.body':
      'La latitud va de -90 a 90 y la longitud de -180 a 180, con punto o con coma: 42,6417. Usar mi ubicación y Buscar un lugar te rellenan las dos.',
    'error.sport.title': 'Ese origen no tiene esa actividad.',
    'error.sport.body':
      'La lista de actividades es del sitio de origen y cambia con él. Vuelve a elegir una de la lista.',

    'step2.download': 'Descargar GPX',
    'step2.reset': 'Otro enlace',
    'measure.distance': 'Distancia',
    'measure.distance.gaps': 'en saltos {gaps}',
    'measure.ascent': 'Desnivel positivo',
    'measure.ascent.step': 'muestreo {step} m',
    'measure.ascent.coverage': 'cobertura {coverage}%',
    'measure.gap': 'Salto mayor',
    'measure.descent': 'Desnivel negativo',
    'measure.rawAscent': 'Desnivel crudo',
    'measure.rawAscent.note': 'sin filtro',
    'measure.elevation.raw': 'el archivo trae {min}-{max}',
    'measure.points': 'Puntos',
    'measure.spacing': 'Espaciado medio',
    'measure.elevation': 'Altitud',
    'compare.matches': 'coincide',
    'compare.source': 'origen',
    'compare.notPublished': 'el origen no lo publica',
    'gap.at': 'en el km {km}',
    'gap.threshold': 'umbral {threshold} m',
    'gap.none': 'ningún salto de más de {threshold} m',

    'method.summary': 'Cómo se mide el desnivel',
    'method.sampling':
      'El perfil de alturas se muestrea cada {step} m, nunca más fino que el espaciado del propio registro, y pasa un filtro de mediana de {window} muestras. Las subidas de menos de {noise} m se descartan como ruido del GPS.',
    'chart.trace': 'Trazado',
    'chart.profile': 'Perfil de altitud',
    'chart.start': 'salida / llegada',
    'chart.gapDrawn': 'salto dibujado recto',
    'chart.noData': 'sin datos',
    'chart.gapLabel': 'salto de {gap} m',

    'map.hide': 'Ocultar mapa',
    'map.show': 'Mostrar mapa',
    'map.attribution':
      '© colaboradores de <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',

    'warning.gap':
      '{gap} m sin grabar en el km {km}. Tu reloj trazará una recta por ahí. Mira ese tramo antes de ir.',

    // Los dos diálogos que abre una tarjeta. Los dos son trabajo nuestro en la
    // máquina de quien mira, y por eso ninguno nombra a un sitio de origen
    // cerca de un número.
    'dialog.close': 'Cerrar',

    'preview.kicker': 'Medido a partir del fichero',
    'preview.note':
      'Medido en tu navegador, sobre el track que reconstruimos. Nada de esto viene del sitio de origen.',
    'preview.report': 'Informe completo',

    'rotate.kicker': 'Reordenar',
    'rotate.lede': 'Dale la vuelta, o mueve el punto de salida.',
    'rotate.rule':
      'El margen es el 2% de la longitud de la propia ruta, entre {floor} m y {ceiling} m.',
    'rotate.detected.closed':
      'Anillo cerrado. La grabación termina donde empezó, así que mover la salida no cuesta nada.',
    'rotate.detected.near':
      'Anillo. Los dos extremos están a {ends}, dentro de los {tolerance} que se permiten en {km} km. Mover la salida mete esos {ends} en medio del fichero, como una recta.',
    'rotate.detected.open':
      'No es un anillo. Los dos extremos están a {ends}, por encima de los {tolerance} que se permiten en {km} km. Solo se ofrece invertir: mover la salida trazaría esos {ends} en recta por el medio del track.',
    'rotate.reverse': 'Invertir el sentido',
    'rotate.start.label': 'Punto de salida',
    'rotate.start.value': 'km {km} de la grabación original',
    'rotate.reset': 'Volver al original',
    'rotate.measured': 'Medido sobre esta disposición',
    'rotate.against': 'original {value}',
    'rotate.seam.warn':
      '{gap} m de recta en el km {km}, donde ahora se juntan los dos extremos de la grabación. Tu reloj trazará por ahí, y eso no estaba en el fichero antes de mover la salida.',
    'rotate.seam.small':
      'Mover la salida ha unido los dos extremos de la grabación. Esa costura mide {gap} m, por debajo de los {threshold} m que esta página llama salto.',
    'rotate.times.one':
      'Se quita una hora grabada: reordenar la deja mal, y no se inventa ninguna para sustituirla.',
    'rotate.times.many':
      'Se quitan {count} horas grabadas: reordenar las deja mal, y no se inventa ninguna para sustituirlas.',
    'rotate.notrim':
      'No se recorta nada: todos los puntos de la grabación están en el fichero, en otro orden.',
    'rotate.unchanged': 'Todavía no has cambiado nada, así que esto es la grabación tal y como llegó.',
    'rotate.download': 'Descargar esta disposición',
    'rotate.filename': 'Se guarda como {name}',

    // Se escribe dentro del propio fichero, en el idioma de la página, para que
    // la descripción diga qué se le hizo al track y cuánto mide ahora.
    'rotate.desc.none': 'Reconstruido sin cambiar el orden de la grabación.',
    'rotate.desc.reversed': 'Se invirtió el sentido de la grabación.',
    'rotate.desc.moved': 'La salida se movió al km {km} de la grabación original.',
    'rotate.desc.both':
      'La salida se movió al km {km} de la grabación original y se invirtió el sentido.',
    'rotate.desc.seam':
      'Esto unió los dos extremos de la grabación y dejó una recta de {gap} m en el km {km}, que nadie caminó.',
    'rotate.desc.times':
      'Se quitaron las horas grabadas porque cambió el orden. No se inventó ninguna.',
    'rotate.desc.measured': 'Medido después del cambio: {km} km y {ascent} m de desnivel positivo.',

    'provenance':
      'El enlace original queda escrito en el fichero, en <code>&lt;metadata&gt;&lt;link&gt;</code> y en el nombre del track.',
    // Un archivo soltado se devuelve exactamente como llegó, así que la frase de
    // arriba sería falsa justo donde no hay procedencia que conservar.
    'provenance.none':
      'Este es tu propio archivo, devuelto exactamente como lo soltaste. No se le ha escrito nada ni se le ha quitado nada.',
    'provenance.file': '{name} · {size}',
    'source.line': '{source} · leído {when}',
    'source.file': 'Tu fichero',
    'when.today': 'hoy',

    'footer.processing.file':
      'Los GPX que sueltas se leen en este navegador y no se suben a ningún sitio.',
    'footer.processing.url':
      'Los enlaces los descarga nuestro servidor, los analiza y los descarta. El contorno de una tarjeta queda en memoria para no pedirlo dos veces. No se anota nada y no hay cuentas.',
    'footer.processing.map':
      'Tu navegador carga el fondo del mapa directamente desde OpenStreetMap, así que ven tu dirección IP y aproximadamente dónde está tu ruta. Puedes desactivarlo en el gráfico del trazado.',
    'footer.processing.fonts':
      'Tu navegador carga las dos tipografías directamente desde Google Fonts, así que Google ve tu dirección IP al abrirse la página, antes de que pulses nada.',
    'footer.source': 'Código fuente',
  },
};

const STORAGE_KEY = 'route-to-gpx:lang';

/** Every key one language holds.
 *
 *  Here so a test can hold the two sets against each other. Spanish is a full
 *  translation and not a fallback, so a key in one and not the other is a
 *  reader meeting `place.pickedPartly` where a sentence should be, and nothing
 *  else in the suite would notice. */
export function keysOf(lang) {
  return Object.keys(STRINGS[lang] ?? {});
}

export function detectLanguage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (LANGUAGES.includes(stored)) return stored;
  } catch {
    // Private windows and blocked site data both land here. English is fine.
  }
  return 'en';
}

export function rememberLanguage(lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Not being able to remember the choice is not worth an error.
  }
}

/** Looks up `key` in `lang`, filling {placeholders} from `values`. */
export function translate(lang, key, values) {
  const table = STRINGS[lang] || STRINGS.en;
  let text = table[key] ?? STRINGS.en[key] ?? key;
  if (values) {
    for (const [name, value] of Object.entries(values)) {
      text = text.replaceAll(`{${name}}`, value);
    }
  }
  return text;
}
