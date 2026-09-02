"""Adapters: one per site we can read.

Each adapter takes a URL and returns a `Route`. Nothing else in the service
knows anything about a particular site.
"""

from dataclasses import dataclass, field
from typing import List, Optional, Tuple


class SourceError(Exception):
    """A failure the visitor can act on.

    `code` is the reason, and the web page turns it into a sentence that names
    what was missing and what to do instead. Codes:

    `domain`   we do not read that site
    `notfound` the site says no such route
    `private`  the route exists but its track is not published
    `track`    the page loaded but carried no coordinates
    `network`  we never got an answer
    `query`    a search arrived with nothing to look for
    `location` a latitude or longitude that is not a place on earth
    `sport`    a sport the source site does not have a word for

    An empty list is not one of these. A question with no matches is a question
    that was answered, so search and nearby return an empty `results` with 200.
    `notfound` is about one identified route, and borrowing it for an empty list
    would tell a visitor their route does not exist because they mistyped a word.

    `hint` narrows a code without adding one. A Komoot collection and an
    unreadable domain are both `domain`, but only one of them can be explained,
    and the explanation has to reach the visitor in their own language. The web
    page translates the hint; the detail stays English, for the log.
    """

    def __init__(self, code: str, detail: str = "", hint: Optional[str] = None):
        super().__init__(detail or code)
        self.code = code
        self.detail = detail
        self.hint = hint


@dataclass
class Published:
    """What the source site says about the route, for side-by-side comparison.

    Every field is optional. A site that does not publish a figure gets `None`,
    and the report says so rather than inventing one.
    """

    distance_m: Optional[float] = None
    ascent_m: Optional[float] = None
    descent_m: Optional[float] = None
    duration_s: Optional[float] = None
    elevation_min_m: Optional[float] = None
    elevation_max_m: Optional[float] = None
    point_count: Optional[int] = None

    def as_dict(self):
        return {
            "distanceM": self.distance_m,
            "ascentM": self.ascent_m,
            "descentM": self.descent_m,
            "durationS": self.duration_s,
            "elevationMinM": self.elevation_min_m,
            "elevationMaxM": self.elevation_max_m,
            "pointCount": self.point_count,
        }


@dataclass
class Route:
    source_id: str
    source_label: str
    title: str
    url: str
    # (latitude, longitude, elevation or None)
    points: List[Tuple[float, float, Optional[float]]] = field(default_factory=list)
    published: Published = field(default_factory=Published)
    route_type: Optional[str] = None
    file_stem: str = "route"
