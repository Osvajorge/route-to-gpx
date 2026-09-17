"""Wikiloc.

Wikiloc has no read-only API for tracks, but it does not hide the geometry
either: the trail page ships the whole track inside the HTML, base64 over TWKB,
and the site's own map code names the format out loud in
`L.WklTrail.fromTwkbBase64(geom)`. We read that same string.

One practical note. Wikiloc answers a default HTTP client with 403 and a real
browser with 200, and the difference is the TLS handshake, not the headers.
`curl_cffi` reproduces a browser handshake, which is why it is a dependency
rather than `requests`.
"""

import base64
import html
import re
import unicodedata
from typing import Dict, Optional
from urllib.parse import urlparse

from . import Published, Route, SourceError
from ..core import twkb
from ..http import fetch_text

# The id is the last thing in the slug: /rutas-alpinismo/aneto-...-8001213.
# Anchored to the end of the path, because an unanchored search over the whole
# link also matches an id sitting in a username or a tracking parameter.
TRAIL_ID_IN_PATH = re.compile(r"/[^/]*?-(\d+)/?$")
# The short link, which is the ONLY shape the Wikiloc phone app shares:
# loc.wiki/t/12925300. It redirects through open-trail-link.do into the real
# trail page, and `_follow` re-checks the allowlist at every hop, so the id is
# read here only to refuse a link that is not a trail before a token is spent.
SHORT_LINK_PATH = re.compile(r"^/t/(\d+)/?$")
# The old links still work and still carry the track, so they are still read:
# /wikiloc/view.do?id=8001213 and /wikiloc/spatialArtifacts.do?event=view&id=...
TRAIL_ID_IN_QUERY = re.compile(r"(?:^|&)id=(\d+)(?:&|$)")
GEOM = re.compile(r'"geom"\s*:\s*"([A-Za-z0-9+/=]+)"')
NAME = re.compile(r'"nom"\s*:\s*"([^"]+)"')
STAT_ROW = re.compile(
    r"<dt>(?P<label>.*?)</dt>\s*<dd>(?P<value>.*?)</dd>", re.S | re.I
)

# Wikiloc serves the same page in a dozen languages, so the statistic labels
# are matched on a keyword rather than on an exact string. Unknown labels are
# skipped: the report says a figure was not published rather than guessing.
LABEL_KEYWORDS = {
    "distance": ("distanc", "distanz", "afstand", "odleglosc"),
    "ascent": ("positiv", "positif", "uphill", "anstieg", "aufstieg", "gain"),
    "descent": ("negativ", "negatif", "downhill", "abstieg", "loss"),
    "elevation_max": ("max",),
    "elevation_min": ("min",),
    "points": ("coorden", "coordinat", "koordinat"),
    "route_type": ("tipo de ruta", "trail type", "route type", "tipus", "type de"),
}

# Wikiloc shows imperial units on the English site and metric everywhere else,
# so the unit has to be read rather than assumed.
UNIT_IN_METRES = {"km": 1000.0, "m": 1.0, "mi": 1609.344, "ft": 0.3048}


def trail_id(url: str) -> Optional[str]:
    """The trail id, from the slug or from a legacy query string."""
    parts = urlparse(url if "//" in url else f"//{url}")
    found = SHORT_LINK_PATH.match(parts.path)
    if found:
        return found.group(1)
    found = TRAIL_ID_IN_PATH.search(parts.path)
    if found:
        return found.group(1)
    found = TRAIL_ID_IN_QUERY.search(parts.query)
    return found.group(1) if found else None


def fetch(url: str) -> Route:
    identifier = trail_id(url)
    if not identifier:
        raise SourceError(
            "domain",
            "that Wikiloc link is not a trail page. A trail link ends in its id, "
            "as in /rutas-alpinismo/aneto-desde-artiga-de-lin-8001213",
        )

    status, page = fetch_text(url)
    if status == 404:
        raise SourceError("notfound")
    if status != 200:
        raise SourceError("network", f"Wikiloc answered {status}")

    found = GEOM.search(page)
    if not found:
        # The page loaded, so the route exists. Either it is private or Wikiloc
        # moved the geometry. The visitor cannot tell those apart, and neither
        # can we, so the message covers both.
        raise SourceError("track")

    points, header = _coordinates(found.group(1))
    if header["bytes_read"] != header["bytes_total"]:
        raise SourceError("track", "the coordinate block stops halfway through")
    if len(points) < 2:
        raise SourceError("track", "the coordinate block holds fewer than two points")

    # TWKB stores longitude first. GPX wants latitude first.
    track = [(latitude, longitude, elevation) for longitude, latitude, elevation in points]

    stats = _statistics(page)
    name = NAME.search(page)
    title = re.sub(r"\s+", " ", html.unescape(name.group(1))).strip() if name else ""

    return Route(
        source_id="wikiloc",
        source_label="Wikiloc",
        title=title or f"Wikiloc trail {identifier}",
        url=url,
        points=track,
        published=Published(
            distance_m=stats.get("distance"),
            ascent_m=stats.get("ascent"),
            descent_m=stats.get("descent"),
            elevation_min_m=stats.get("elevation_min"),
            elevation_max_m=stats.get("elevation_max"),
            point_count=int(stats["points"]) if stats.get("points") else None,
        ),
        route_type=stats.get("route_type_text"),
        file_stem=f"wikiloc-{identifier}",
    )


def _coordinates(encoded: str):
    """Decodes the base64 TWKB block, or says the block cannot be read.

    Neither step trusts its input. `base64.b64decode` raises on a block whose
    length is not a multiple of four, which is what a transfer cut short looks
    like, and `twkb.decode` walks the bytes by index and raises `IndexError` on
    anything that is not TWKB. Both escape as a 500 in `text/plain`, the one
    shape this service promises never to return, so both become the same
    `track` the visitor already gets for a page with no block at all.
    """
    try:
        raw = base64.b64decode(encoded)
    except (ValueError, TypeError):
        raise SourceError("track", "the coordinate block is not readable base64")

    try:
        return twkb.decode(raw)
    except (IndexError, ValueError, OverflowError):
        raise SourceError("track", "the coordinate block is not readable TWKB")


def _normalise(text: str) -> str:
    plain = re.sub(r"<[^>]+>", " ", text)
    plain = html.unescape(plain).lower().strip()
    plain = unicodedata.normalize("NFKD", plain)
    return "".join(c for c in plain if not unicodedata.combining(c))


def _number(text: str) -> Optional[float]:
    """Reads a figure such as `24,37 km`, `2.215 m`, `15.14 mi` or `7,267 ft`
    and returns metres.

    Wikiloc writes `2.215` for two thousand in Spanish and `2,215` for the same
    number in English, so neither separator can be assumed. What holds in both
    is the shape: a separator with exactly three digits after it groups
    thousands, and anything else marks the decimal.

    A leading minus belongs to the figure: a trail round the Dead Sea publishes
    a minimum altitude below sea level, and dropping the sign turns 400 metres
    down into 400 metres up. A hyphen straight after a digit is not a sign, it
    joins two figures, so the lookbehind leaves `1456-3407 m` reading as 3407
    the way it always did.
    """
    plain = _normalise(text)
    found = re.search(r"(?<!\d)(-?\d[\d.,]*)\s*(km|mi|ft|m)\b", plain)
    if not found:
        return None

    digits = found.group(1).rstrip(".,")
    separator = max(digits.rfind("."), digits.rfind(","))
    if separator == -1:
        cleaned = digits
    elif len(digits) - separator - 1 == 3:
        cleaned = re.sub(r"[.,]", "", digits)
    else:
        cleaned = re.sub(r"[.,]", "", digits[:separator]) + "." + digits[separator + 1 :]

    try:
        return float(cleaned) * UNIT_IN_METRES[found.group(2)]
    except ValueError:
        return None


def _statistics(page: str) -> Dict[str, object]:
    section = page
    start = page.find('id="trail-data"')
    if start != -1:
        section = page[start : start + 8000]

    stats: Dict[str, object] = {}
    for row in STAT_ROW.finditer(section):
        label = _normalise(row.group("label"))
        raw = row.group("value")
        for field, keywords in LABEL_KEYWORDS.items():
            if not any(keyword in label for keyword in keywords):
                continue
            if field == "route_type":
                stats["route_type_text"] = re.sub(r"\s+", " ", _normalise(raw)).strip()
            elif field == "points":
                digits = re.sub(r"\D", "", _normalise(raw))
                if digits:
                    stats["points"] = int(digits)
            else:
                value = _number(raw)
                if value is not None:
                    # Distance, ascent and descent are magnitudes: Wikiloc puts
                    # the direction in the label, `Desnivel negativo`, never in
                    # the number. Only the two altitudes sit below sea level.
                    stats[field] = value if field.startswith("elevation") else abs(value)
            break
    return stats
