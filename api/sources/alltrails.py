"""AllTrails, which this service cannot currently read.

This adapter is kept as a fallback, not as a working source. Nothing in the
interface offers AllTrails, and a link pasted into the converter reaches this
module only to be refused with an explanation. Two separate walls stand in
front of the track, and either alone is enough:

1. DATADOME REFUSES EVERY NON-BROWSER CLIENT. Measured on a real trail page:
   `curl_cffi` impersonating Chrome, and a stealth fetcher driving headless and
   real Chrome, all three came back 403 carrying a DataDome CAPTCHA. This is
   not the Wikiloc case, where a browser TLS handshake is the whole difference.
   A real browser does load the page, so the wall is not the handshake alone.

2. THE PAGE NO LONGER CARRIES THE TRACK. Loaded in a real browser, the trail
   page is 1.6 MB of HTML and 1.2 MB of React Server Component payload, and
   neither holds `pointsData`, `polyline`, `lineSegments`, or any coordinate
   list. The map is a static image; the geometry is fetched later by a call
   that wants a signed-in session. What the page does carry is a name, a
   trailhead point, and the published distance and ascent.

So the extraction below is written against a format AllTrails used to serve and
no longer does. It is left in place because it costs nothing to keep and would
work unchanged if that format returned. It must not be read as a claim that
AllTrails works today: it does not, and the errors raised here say so.

ROBOTS.TXT. The `User-agent: *` block allows trail pages and closes the paths
now listed under "alltrails.com" in `http.py`'s CLOSED_PATHS, which is where
they are enforced. Two of its rules cannot be written as path prefixes and so
are not in that list: `/*/api/` and friends, which are the same API paths
behind a locale segment, and `/*?lat=`, which is a query rather than a path.
Nothing here builds either shape -- this module only ever fetches the trail URL
it was handed -- but a future caller must not read their absence as permission.

Separately, that file names ClaudeBot, GPTBot, CCBot, PerplexityBot and around
sixty other agents and disallows them the whole site. That is a rule about who
is asking, not about which path, and it is a further reason this source stays
closed rather than one this adapter can satisfy.
"""

import json
import re
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse

from . import Published, Route, SourceError
from .polyline import decode as decode_polyline
from ..http import fetch_text

ALLTRAILS_PRECISION = 1e5

# /trail/country/region/trail-name  with an optional locale prefix
TRAIL_PATH = re.compile(
    r"^(?:/[a-z]{2}(?:-[a-z]{2})?)?"
    r"/trail/(?P<slug>[^?#]+)",
    re.I,
)

# The geometry sits inside a JSON object in the page's script tags.
# Google encoded polyline uses ASCII 63 through 126: letters, digits, and
# symbols like @, ^, ~, \, [, ], ?, which all appear in real AllTrails data.
POINTS_DATA = re.compile(r'"pointsData"\s*:\s*"([^"]+)"')

# AllTrails writes the trail name in an h1 or in a JSON-LD block.
TITLE_H1 = re.compile(r"<h1[^>]*>([^<]+)</h1>", re.I)

# Published stats: AllTrails puts them in JSON-LD or in data attributes.
# The simplest extraction is from the page's own structured data.
DISTANCE_RE = re.compile(
    r'"distance"\s*:\s*\{[^}]*"value"\s*:\s*([\d.]+)[^}]*"unitCode"\s*:\s*"(KMT|MTR|SMI)"',
    re.S,
)
ELEVATION_GAIN_RE = re.compile(
    r'"elevationGain"\s*:\s*\{[^}]*"value"\s*:\s*([\d.]+)', re.S
)

# Fallback: stats from the trail-detail section
STAT_VALUE = re.compile(
    r'class="[^"]*trail-detail[^"]*"[^>]*>.*?'
    r'(?:Length|Distance|Distancia).*?([\d,.]+)\s*(km|mi|m)',
    re.S | re.I,
)


def trail_slug(url: str) -> Optional[str]:
    parts = urlparse(url if "//" in url else f"//{url}")
    found = TRAIL_PATH.match(parts.path)
    return found.group("slug").strip("/") if found else None


def fetch(url: str) -> Route:
    slug = trail_slug(url)
    if not slug:
        raise SourceError(
            "domain",
            "that AllTrails link is not a trail page. A trail link looks "
            "like /trail/country/region/trail-name",
        )

    status, page = fetch_text(url)
    if status == 404:
        raise SourceError("notfound")
    if status == 403:
        raise SourceError(
            "network",
            "AllTrails blocks automated access through DataDome. "
            "Export the GPX from your AllTrails account and drop the "
            "file here instead",
        )
    if status != 200:
        raise SourceError("network", f"AllTrails answered {status}")

    points = _extract_track(page)
    if len(points) < 2:
        raise SourceError(
            "track",
            "AllTrails no longer embeds track geometry in the page. "
            "Export the GPX from your AllTrails account and drop the "
            "file here instead",
        )

    title = _extract_title(page) or _title_from_slug(slug)
    stats = _extract_stats(page)

    # Build a clean file stem from the slug's last segment
    stem_part = slug.rstrip("/").rsplit("/", 1)[-1]
    file_stem = f"alltrails-{stem_part}"

    return Route(
        source_id="alltrails",
        source_label="AllTrails",
        title=title,
        url=url,
        points=points,
        published=Published(
            distance_m=stats.get("distance"),
            ascent_m=stats.get("ascent"),
        ),
        file_stem=file_stem,
    )


def _extract_track(
    page: str,
) -> List[Tuple[float, float, Optional[float]]]:
    """All polyline segments joined into one track."""
    points: List[Tuple[float, float, Optional[float]]] = []

    for found in POINTS_DATA.finditer(page):
        decoded = decode_polyline(found.group(1), precision=ALLTRAILS_PRECISION)
        for lat, lng in decoded:
            points.append((lat, lng, None))

    return points


def _extract_title(page: str) -> Optional[str]:
    found = TITLE_H1.search(page)
    if found:
        import html

        return re.sub(r"\s+", " ", html.unescape(found.group(1))).strip()
    return None


def _title_from_slug(slug: str) -> str:
    last = slug.rstrip("/").rsplit("/", 1)[-1]
    return last.replace("-", " ").title()


def _extract_stats(page: str) -> Dict[str, Optional[float]]:
    stats: Dict[str, Optional[float]] = {}

    found = DISTANCE_RE.search(page)
    if found:
        value = float(found.group(1))
        unit = found.group(2)
        if unit == "KMT":
            stats["distance"] = value * 1000.0
        elif unit == "SMI":
            stats["distance"] = value * 1609.344
        else:
            stats["distance"] = value

    found = ELEVATION_GAIN_RE.search(page)
    if found:
        stats["ascent"] = float(found.group(1))

    return stats
