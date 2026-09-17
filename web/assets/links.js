/** Which site a pasted link belongs to, and how to find the link at all.
 *
 *  Its own file because nothing here touches the page: it is string work, and
 *  string work that decides whether a conversion happens. Inside app.js it was
 *  exported and unreachable -- app.js boots a whole page at import, so no test
 *  could call it, and the gate every conversion passes through had no test of
 *  any kind.
 */

/** The link inside whatever the share sheet handed over.
 *
 *  Nothing on a phone shares a bare URL. Wikiloc's app shares a sentence:
 *
 *    !Mira esta ruta de @wikiloc! https://loc.wiki/t/12925300?h=... (160412
 *    100 Cims (E). BARCELONES. ... )
 *
 *  Pasting that used to be an unrecognised link, which is a true answer to the
 *  wrong question: the link is right there. So the first http(s) run of
 *  non-spaces wins, and the rest of the sentence is dropped.
 *
 *  Trailing punctuation is trimmed because a URL at the end of a sentence
 *  collects it, but a closing bracket is only dropped when nothing opened it
 *  inside the URL -- Wikipedia-shaped links really do end in one. */
export function linkWithin(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';

  const found = text.match(/https?:\/\/\S+/i);
  if (!found) return text;

  let url = found[0];
  for (;;) {
    const last = url[url.length - 1];
    if ('.,;:!?\u00a1\u00bf"\'\u201c\u201d\u2018\u2019'.includes(last)) {
      url = url.slice(0, -1);
      continue;
    }
    if ((last === ')' || last === ']') && !url.includes(last === ')' ? '(' : '[')) {
      url = url.slice(0, -1);
      continue;
    }
    break;
  }
  return url;
}

export function classifyLink(raw) {
  const value = linkWithin(raw);
  if (!value) return null;
  if (/\.gpx($|\?)/i.test(value)) return { id: 'file' };

  let host;
  try {
    host = new URL(value.startsWith('http') ? value : `https://${value}`).hostname;
  } catch {
    return null;
  }
  if (/(^|\.)komoot\.[a-z.]+$/i.test(host)) return { id: 'komoot', label: 'Komoot' };
  if (/(^|\.)wikiloc\.[a-z.]+$/i.test(host)) return { id: 'wikiloc', label: 'Wikiloc' };
  // Wikiloc's shortener, which is what its phone app actually shares.
  if (/(^|\.)loc\.wiki$/i.test(host)) return { id: 'wikiloc', label: 'Wikiloc' };
  return null;
}
