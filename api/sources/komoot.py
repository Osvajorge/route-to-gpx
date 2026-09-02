"""Komoot.

Komoot publishes every public tour through the same read-only endpoint its own
website calls, and that endpoint answers a plain request with plain JSON:

    https://www.komoot.com/api/v007/tours/{id}?_embedded=coordinates

So there is no page to scrape. We ask for the tour, and Komoot answers 403 when
the tour is private and 404 when it does not exist. Those two are different
problems for the visitor, so we keep them apart.
"""

import re
from typing import Optional

from . import Published, Route, SourceError
from ..http import fetch_json

TOUR_URL = "https://www.komoot.com/api/v007/tours/{id}?_embedded=coordinates"

# Komoot uses several country domains and both /tour/ and /smarttour/ paths.
TOUR_ID = re.compile(r"/(?:smart)?tour/(\d+)")


def tour_id(url: str) -> Optional[str]:
    found = TOUR_ID.search(url)
    return found.group(1) if found else None


def fetch(url: str) -> Route:
    identifier = tour_id(url)
    if not identifier:
        raise SourceError(
            "domain", "a Komoot link has to carry a tour id, as in /tour/123456"
        )

    status, payload = fetch_json(TOUR_URL.format(id=identifier))

    if status == 403:
        raise SourceError("private")
    if status == 404 or status == 410:
        raise SourceError("notfound")
    if status != 200 or not isinstance(payload, dict):
        raise SourceError("network", f"Komoot answered {status}")

    items = (
        payload.get("_embedded", {})
        .get("coordinates", {})
        .get("items", [])
    )
    points = [
        (item["lat"], item["lng"], item.get("alt"))
        for item in items
        if "lat" in item and "lng" in item
    ]
    if len(points) < 2:
        raise SourceError("track", "the tour carries no coordinates")

    published = Published(
        distance_m=_number(payload.get("distance")),
        ascent_m=_number(payload.get("elevation_up")),
        descent_m=_number(payload.get("elevation_down")),
        point_count=len(points),
    )

    return Route(
        source_id="komoot",
        source_label="Komoot",
        title=payload.get("name") or f"Komoot tour {identifier}",
        url=f"https://www.komoot.com/tour/{identifier}",
        points=points,
        published=published,
        file_stem=f"komoot-{identifier}",
    )


def _number(value) -> Optional[float]:
    return float(value) if isinstance(value, (int, float)) else None
