"""The shape a list of links has, whichever site answered it.

Search and Nearby read two sites now. What a page renders must not depend on
which one answered, so the row, the place and the listing are described here
once and every source module fills them in. Written out twice they would drift:
one site would gain a key, a page written against the other would stop finding
it, and nothing would fail loudly enough to notice.

Nothing here knows a site. Everything site-shaped stays in the module for that
site: which parameter carries an activity, how a bounding box is worked out,
which figure arrives in feet.

A row is a link, never a track. Nothing in this file returns coordinates, a GPX
or a measurement of any kind.
"""

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from . import Published

# A thumbnail URL is written by the source, and the page puts it in an <img>.
# That makes the source the one deciding whose server sees the visitor's
# address, which is not a decision a source gets to make here. Only these hosts
# are handed on, and anything else becomes no thumbnail at all.
THUMBNAIL_HOST = re.compile(
    r"^(?:[a-z0-9-]+\.)*(?:komoot\.(?:net|de|com)|wklcdn\.com)$", re.I
)


def thumbnail(url: Any, kind: str) -> Optional[Dict[str, str]]:
    """A picture the page may load, or nothing.

    `kind` says what it is a picture OF, because the two sites do not agree:
    Komoot draws the route on a map, Wikiloc hands over a walker's photograph
    of the path. They belong in the same slot on a card and they are not the
    same claim, so the page is told which it has rather than guessing from the
    host.
    """
    if not isinstance(url, str) or not url:
        return None
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        return None
    if not THUMBNAIL_HOST.match(parsed.hostname):
        return None
    return {"url": url, "kind": kind}


@dataclass
class Row:
    """One route, as a link plus what the source site says about it.

    No measurement sits at the top level. A page cannot print a distance without
    writing `row.published.distanceM`, and that expression reads as a claim at
    the place it is read. A `row.distanceM` would read as fact, so it does not
    exist.

    The fields beside `published` are not measurements at all: a picture, a
    score other walkers gave, a grade the site assigns, a date it last changed.
    They are the site's own record of itself, they are all optional, and a site
    that does not keep one gets `None` rather than a zero or a dash.

    `sport` is one word from the source's own vocabulary, and the vocabularies
    are not the same: Komoot says `hike`, Wikiloc says `hiking`. The key is
    shared so a page has one place to look; the words behind it belong to
    whichever site answered, and `/api/sports` hands out the right list.
    """

    url: str
    title: str
    sport: Optional[str]
    start: Optional[Dict[str, float]]
    published: Published
    # A string, not a flag, and required: the attribution travels with the
    # numbers, so a row can never be rendered somewhere the source has gone
    # missing. A proper noun carries no language, so the page keeps all the
    # prose.
    published_by: str

    # Nullable, every one of them, and asymmetric between the two sites on
    # purpose. Komoot's nearby carries all four; its search carries none but the
    # picture; Wikiloc carries a rating and a grade but photographs the path
    # rather than drawing the route. A card renders what is there.
    thumbnail: Optional[Dict[str, str]] = None
    rating: Optional[Dict[str, float]] = None
    difficulty: Optional[str] = None
    updated_at: Optional[str] = None

    def as_dict(self) -> Dict[str, Any]:
        return {
            "url": self.url,
            "title": self.title,
            "sport": self.sport,
            "start": self.start,
            "thumbnail": self.thumbnail,
            "rating": self.rating,
            "difficulty": self.difficulty,
            "updatedAt": self.updated_at,
            "publishedBy": self.published_by,
            "published": self.published.as_dict(),
        }


@dataclass
class Place:
    """A name and a point, for turning "montseny" into a latitude."""

    name: str
    lat: float
    lng: float

    def as_dict(self) -> Dict[str, Any]:
        return {"name": self.name, "lat": self.lat, "lng": self.lng}


@dataclass
class Listing:
    """One answered question: the rows, and what was asked to get them."""

    source_id: str
    source_label: str
    echo: Dict[str, Any]
    rows: List[Row] = field(default_factory=list)
    # `None` where there is nothing to geocode, which is how nearby leaves the
    # key out of its response rather than answering with an empty list.
    places: Optional[List[Place]] = None
    has_more: bool = False
    # `None` means the source did not say, the same way a missing figure is
    # `None` rather than zero. Never a guess at a total.
    total_known: Optional[int] = None
    # Rows the source returned whose URL the converter could not have opened. It
    # is counted because otherwise the failure is invisible: the page would show
    # "nothing found" for ever while the source was answering fine.
    dropped: int = 0
    # Who to credit for the `places`, when they did not come from the source
    # site itself. It travels with them so a page cannot render them without
    # it: the licence that lets us use them asks for the credit.
    attribution: Optional[str] = None
    # Rows this service removed on purpose, and why. A different thing from
    # `dropped`: those could not be used, these could, and were not wanted. Only
    # a source that filters locally sets it, and leaving it `None` keeps the key
    # out of the body altogether rather than printing zeroes about work nobody
    # did.
    set_aside: Optional[Dict[str, int]] = None
    # How many rows were read to produce the ones returned. `None` when nothing
    # was filtered here, so the key stays out of the body rather than claiming a
    # scan that never happened. When a filter did run this is the honest number
    # behind a short page: six of six hundred examined is a different sentence
    # from six of six, and the visitor deserves the difference.
    examined: Optional[int] = None

    def as_dict(self) -> Dict[str, Any]:
        body: Dict[str, Any] = {
            "source": {"id": self.source_id, "label": self.source_label},
            "query": self.echo,
            "results": [row.as_dict() for row in self.rows],
        }
        if self.places is not None:
            body["places"] = [place.as_dict() for place in self.places]
            if self.attribution is not None:
                body["placesAttribution"] = self.attribution
        body["paging"] = {
            "page": self.echo["page"],
            "pageSize": self.echo["limit"],
            "hasMore": self.has_more,
            "totalKnown": self.total_known,
        }
        body["droppedRows"] = self.dropped
        if self.set_aside is not None:
            body["setAside"] = dict(self.set_aside)
        if self.examined is not None:
            body["examined"] = self.examined
        return body
