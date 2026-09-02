"""Wikiloc's Search and Nearby, with no network.

Every payload below was captured from one real anonymous call on 2026-09-02, to
the addresses named beside it, and then cut down to the fields this service
reads. Keeping the real shapes here means these tests fail when Wikiloc or
Photon changes the shape, and pass without asking either of them anything.

The two `find.do` pages are the real page 0 and page 1 of the same box. They are
here as two separate payloads on purpose: the Komoot side shipped a paging bug
that nobody caught because nobody compared two pages, and
`test_two_pages_share_no_row` is that comparison.
"""

from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from api import app as service
from api import http
from api.sources import SourceError, wikiloc, wikiloc_discovery

# https://www.wikiloc.com/wikiloc/find.do?event=map&to=24
#   &sw=41.55,1.75&ne=41.68,1.92
#
# Three hiking rows, then the two rows in that box that are not hiking. Distance
# and slope are strings in the source's own units, and `uom`/`uomslope` are how
# it says which: "mi" and "f" are what an anonymous caller is served.
FIND_PAGE_0 = {
    "count": 224326,
    "roundedCount": 224000,
    "locale": "en",
    "restricted": False,
    "filterType": "null",
    "spas": [
        {
            "id": 184968972,
            "prettyURL": "/hiking-trails/can-macana-refugi-vicenc-barbe-miranda-del-princep"
            "-100-cims-feec-roca-foradada-sant-pau-vell-castel-184968972",
            "name": "Can Maçana - Vicenç Barbé Refuge - Miranda del Príncep (100 Peaks FEEC)"
            " - Roca Foradada - Sant Pau Vell - Castell de la Guàrdia",
            "picto": 1,
            "pictoText": "Hiking",
            "lat": 41.609337,
            "lon": 1.767302,
            "uom": "mi",
            "uomslope": "f",
            "distance": "5.17",
            "slope": "2838",
            # The card fields, as this row really carries them. Verified live
            # on 2026-09-02, and the skill word checked against the trail page
            # itself, which reads "Moderate".
            "rating": 4.92,
            "numRatings": 13,
            "skill": 2,
            "thumbs": [
                {"url": "https://s2.wklcdn.com/image_57/1717832/184968972/114797162_tn.jpg",
                 "id": 114797162},
            ],
        },
        {
            "id": 187574628,
            "prettyURL": "/hiking-trails/569-p-n-muntanya-de-montserrat-monestir-de-montserrat"
            "-miranda-de-santa-magdalena-sant-jeroni-2x100-187574628",
            "name": "569. Montserrat Mountain Natural Park. Montserrat Monastery"
            " - Miranda de Santa Magdalena - Sant Jeroni",
            "picto": 1,
            "pictoText": "Hiking",
            "lat": 41.595755,
            "lon": 1.839341,
            "uom": "mi",
            "uomslope": "f",
            "distance": "7.97",
            "slope": "3123",
        },
        {
            "id": 116155033,
            "prettyURL": "/hiking-trails/cami-vell-de-collbato-a-montserrat-monestir-cami-de-la"
            "-santa-cova-i-cami-de-les-feixades-des-de-col-116155033",
            "name": "Old Path from Collbató to Montserrat, Monastery, Santa Cova Path"
            " and Camí de les Feixades from Collbató",
            "picto": 1,
            "pictoText": "Hiking",
            "lat": 41.571683,
            "lon": 1.823565,
            "uom": "mi",
            "uomslope": "f",
            "distance": "9.14",
            "slope": "2448",
        },
        # In the box and outside a 5 km circle around the monastery: 5.3 km from
        # it, where the box reaches 7.07 km at its corners.
        {
            "id": 83045021,
            "prettyURL": "/mountaineering-trails/torrent-dels-abadals-y-turo-del-marques-83045021",
            "name": "Torrent dels Abadals and Turó del Marquès",
            "picto": 14,
            "pictoText": "Alpine Climbing",
            "lat": 41.639588,
            "lon": 1.856903,
            "uom": "mi",
            "uomslope": "f",
            "distance": "3.41",
            "slope": "702",
        },
        {
            "id": 57473521,
            "prettyURL": "/via-ferrata-trails/can-massana-agulles-i-frares-encantats"
            "-can-massana-57473521",
            "name": "Can Maçana - Agulles i Frares Encantats - Can Maçana",
            "picto": 60,
            "pictoText": "Via Ferrata",
            "lat": 41.609771,
            "lon": 1.768058,
            "uom": "mi",
            "uomslope": "f",
            "distance": "5.02",
            "slope": "3264",
        },
    ],
}

# The same box, one window further on:
# ...find.do?event=map&from=24&to=48&sw=41.55,1.75&ne=41.68,1.92
FIND_PAGE_1 = {
    "count": 224326,
    "locale": "en",
    "spas": [
        {
            "id": 81812271,
            "prettyURL": "/hiking-trails/roca-de-sant-salvador-100-cims-pels-degotalls-i-les"
            "-canals-del-pou-del-gat-i-la-canal-plana-81812271",
            "name": "Roca de Sant Salvador (100 Peaks) via Els Degotalls",
            "picto": 1,
            "pictoText": "Hiking",
            "lat": 41.596146,
            "lon": 1.838999,
            "uom": "mi",
            "uomslope": "f",
            "distance": "4.60",
            "slope": "1755",
        },
        {
            "id": 16420037,
            "prettyURL": "/hiking-trails/sortida-11-02-2017-passeig-cova-cabrit-cova-arcada"
            "-cova-de-la-desentegada-16420037",
            "name": "Sortida 11-02-2017 PASSEIG - COVA CABRIT - COVA ARCADA",
            "picto": 1,
            "pictoText": "Hiking",
            "lat": 41.588828,
            "lon": 1.780473,
            "uom": "mi",
            "uomslope": "f",
            "distance": "3.78",
            "slope": "1047",
        },
        {
            "id": 62026648,
            "prettyURL": "/hiking-trails/montserrat-canal-dels-micos-miranda-ecos-i-canal-de-la"
            "-salamandra-per-la-canal-de-la-font-del-llum-62026648",
            "name": "MONTSERRAT Canal dels Micos, Miranda Ecos and Canal de la Salamandra",
            "picto": 1,
            "pictoText": "Hiking",
            "lat": 41.611192,
            "lon": 1.817216,
            "uom": "mi",
            "uomslope": "f",
            "distance": "3.65",
            "slope": "2792",
        },
    ],
}

EMPTY_FIND = {
    "count": 0,
    "roundedCount": 0,
    "locale": "en",
    "restricted": False,
    "spas": [],
    "filterType": "null",
}

# https://photon.komoot.io/api/?q=montserrat&limit=5
#
# Three of the five Montserrats, which is why the places list exists. The third
# has no `extent`, because Photon publishes an outline only where OSM has one.
PHOTON = {
    "features": [
        {
            "type": "Feature",
            "properties": {
                "name": "Montserrat",
                "state": "Catalonia",
                "country": "Spain",
                "countrycode": "ES",
                "osm_value": "mountain_range",
                "extent": [1.7800528, 41.6129223, 1.8438239, 41.5940903],
            },
            "geometry": {"type": "Point", "coordinates": [1.8108377, 41.6067129]},
        },
        {
            "type": "Feature",
            "properties": {
                "name": "Montserrat",
                "country": "Montserrat",
                "countrycode": "MS",
                "extent": [-62.4502432, 16.8885156, -61.9359751, 16.4737398],
            },
            "geometry": {"type": "Point", "coordinates": [-62.1916844, 16.7417041]},
        },
        {
            "type": "Feature",
            "properties": {"name": "Montserrat", "state": "Galicia", "country": "Spain"},
            "geometry": {"type": "Point", "coordinates": [-8.3919105, 43.3371433]},
        },
    ]
}

NO_PLACE = {"features": []}

# The monastery, and a radius whose box reaches 7.07 km at the corners.
MONASTERY = (41.6067129, 1.8108377)
FIVE_KM = 5000


@pytest.fixture(autouse=True)
def _empty_buckets():
    """Every test starts where a fresh process starts: nothing spent."""
    for buckets in (service._inbound, http._clients, http._sites, http._geocoder):
        buckets._levels.clear()
    yield


class _Asked:
    """Stands in for Wikiloc and Photon, and remembers what it was asked for.

    It answers by hostname, so a test cannot pass by having the two calls the
    wrong way round.
    """

    def __init__(self, find=None, photon=None, status=200):
        self.find = find if find is not None else EMPTY_FIND
        self.photon = photon if photon is not None else PHOTON
        self.status = status
        self.urls = []

    def __call__(self, url, timeout=None):
        self.urls.append(url)
        self.timeout = timeout
        if urlparse(url).hostname == http.GEOCODER_HOST:
            return self.status, self.photon
        return self.status, self.find

    def parameters(self, index=-1):
        return {
            key: value[0]
            for key, value in parse_qs(urlparse(self.urls[index]).query).items()
        }


def _answers(monkeypatch, find=None, photon=None, status=200):
    asked = _Asked(find, photon, status)
    monkeypatch.setattr(wikiloc_discovery, "fetch_json", asked)
    return asked


def _never(monkeypatch):
    def never(url, timeout=None):
        raise AssertionError(f"asked {url} instead of reading the request first")

    monkeypatch.setattr(wikiloc_discovery, "fetch_json", never)


# --- the activity, which is checked here and sent to nobody -------------------


def test_an_activity_wikiloc_does_not_have_is_refused_before_any_request(monkeypatch):
    """A bad activity costs no upstream token, and the answer says what is good."""
    _never(monkeypatch)

    for call in (
        lambda: wikiloc_discovery.search(query="montserrat", activity="nonsense"),
        lambda: wikiloc_discovery.nearby(lat=41.6, lng=1.8, activity="nonsense"),
        # A Komoot word. The two vocabularies are never merged, so Komoot's
        # `hike` is not an activity here; Wikiloc's word is `hiking`.
        lambda: wikiloc_discovery.nearby(lat=41.6, lng=1.8, activity="hike"),
    ):
        with pytest.raises(SourceError) as raised:
            call()
        assert raised.value.code == "sport"
        # Eighty slugs in one sentence is not something a person can act on, so
        # the error names the commonest and says where the rest are.
        for named in wikiloc_discovery.ACTIVITY_SLUGS[:5]:
            assert named in raised.value.detail
        assert "/api/sports?source=wikiloc" in raised.value.detail


def test_an_activity_that_is_wikilocs_own_word_is_accepted(monkeypatch):
    """Every slug in the vocabulary, checked against the picto ids on rows."""
    _answers(monkeypatch, find=EMPTY_FIND)

    for slug in wikiloc_discovery.ACTIVITY_SLUGS:
        listing = wikiloc_discovery.nearby(lat=41.6, lng=1.8, activity=slug)
        assert listing.echo["sport"] == slug

    # Blank, missing and "all" all mean everything, and everything is the
    # default: local filtering makes it the one setting that hides nothing.
    for nothing in (None, "", "   "):
        assert wikiloc_discovery.nearby(lat=41.6, lng=1.8, activity=nothing).echo[
            "sport"
        ] == wikiloc_discovery.ANY_ACTIVITY
    assert wikiloc_discovery.DEFAULT_ACTIVITY == wikiloc_discovery.ANY_ACTIVITY


def test_the_activity_never_reaches_wikiloc(monkeypatch):
    """`a=1` answers count 0 for an anonymous caller, so it is not sent at all."""
    asked = _answers(monkeypatch, find=FIND_PAGE_0)
    wikiloc_discovery.nearby(lat=41.6, lng=1.8, activity="via-ferrata")

    sent = asked.parameters()
    assert set(sent) == {"event", "from", "to", "sw", "ne"}
    for dead in ("a", "act", "pictogram", "sport", "activity"):
        assert dead not in sent


def test_the_activity_filter_is_applied_to_the_rows_and_counted(monkeypatch):
    """A filtered page can be short, and `setAside` is why, so a page can say so."""
    _answers(monkeypatch, find=FIND_PAGE_0)

    every = wikiloc_discovery.nearby(
        lat=MONASTERY[0], lng=MONASTERY[1], radius_m=FIVE_KM, activity="all"
    ).as_dict()
    # Five rows in, four inside the circle, and the fifth counted rather than
    # quietly missing.
    assert len(every["results"]) == 4
    assert every["setAside"] == {"otherActivity": 0, "outsideRadius": 1}
    assert every["droppedRows"] == 0

    ferrata = wikiloc_discovery.nearby(
        lat=MONASTERY[0], lng=MONASTERY[1], radius_m=FIVE_KM, activity="via-ferrata"
    ).as_dict()
    assert [row["title"] for row in ferrata["results"]] == [
        "Can Maçana - Agulles i Frares Encantats - Can Maçana"
    ]
    assert ferrata["setAside"] == {"otherActivity": 4, "outsideRadius": 0}

    # The one alpine climb in the box is outside the circle, so asking for that
    # activity fills no page at all -- and the two numbers say which reason.
    alpine = wikiloc_discovery.nearby(
        lat=MONASTERY[0], lng=MONASTERY[1], radius_m=FIVE_KM, activity="alpine-climbing"
    ).as_dict()
    assert alpine["results"] == []
    assert alpine["setAside"] == {"otherActivity": 4, "outsideRadius": 1}


def test_the_count_wikiloc_publishes_is_never_reported_as_a_total(monkeypatch):
    """224,326 counts the whole box before either filter. Beside four rows it
    would answer a question nobody asked."""
    _answers(monkeypatch, find=FIND_PAGE_0)
    body = wikiloc_discovery.nearby(
        lat=MONASTERY[0], lng=MONASTERY[1], radius_m=FIVE_KM
    ).as_dict()

    assert body["paging"]["totalKnown"] is None
    assert "224326" not in str(body)


# --- the box ------------------------------------------------------------------


def test_a_degree_of_longitude_is_not_a_degree_of_latitude():
    """The whole point of the box arithmetic, at three latitudes.

    A degree of longitude is a degree of latitude times cos(latitude). At 60
    degrees that cosine is exactly one half, so the box has to be exactly twice
    as wide in degrees as it is tall. Using one figure for both would draw a box
    half the width it should be and lose rows from the east and the west of the
    circle with nothing saying so.
    """
    (south, west), (north, east) = wikiloc_discovery._box(0.0, 0.0, 25000)
    assert round(north - south, 9) == round(east - west, 9)

    (south, west), (north, east) = wikiloc_discovery._box(60.0, 10.0, 25000)
    assert round((east - west) / (north - south), 6) == 2.0

    # And the real one: Montserrat, where the ratio is 1 / cos(41.6).
    (south, west), (north, east) = wikiloc_discovery._box(
        MONASTERY[0], MONASTERY[1], FIVE_KM
    )
    assert round(north - south, 6) == 0.089932
    assert round(east - west, 6) == 0.120275
    # A 5 km half-height is 5 km of ground north and south of the centre: one
    # degree of latitude is 111,195 m on this sphere.
    assert round((north - south) / 2 * 111195.08, 0) == 5000.0
    # The centre stays the centre.
    assert round((north + south) / 2, 6) == round(MONASTERY[0], 6)
    assert round((east + west) / 2, 6) == round(MONASTERY[1], 6)


def test_the_box_stops_at_the_edges_of_the_world():
    """Clamped, not wrapped: `find.do` reads sw and ne as two corners, and a
    wrapped box would ask for the whole planet the long way round."""
    (south, west), (north, east) = wikiloc_discovery._box(89.99, 0.0, 50000)
    assert north == 90.0
    assert -90.0 <= south <= 90.0

    (south, west), (north, east) = wikiloc_discovery._box(0.0, 179.9, 50000)
    assert east == 180.0
    assert west < 179.9

    (south, west), (north, east) = wikiloc_discovery._box(90.0, 0.0, 50000)
    assert (west, east) == (-180.0, 180.0)


def test_the_box_is_what_actually_goes_into_the_request(monkeypatch):
    """Worked out here, so it has to be checked on the wire, not in a variable."""
    asked = _answers(monkeypatch, find=FIND_PAGE_0)
    listing = wikiloc_discovery.nearby(
        lat=MONASTERY[0], lng=MONASTERY[1], radius_m=FIVE_KM
    )

    sent = asked.parameters()
    assert sent["event"] == "map"
    assert sent["sw"] == "41.561747,1.750700"
    assert sent["ne"] == "41.651679,1.870975"

    # And the visitor can see it, because this service invented it.
    box = listing.echo["box"]
    assert (box["south"], box["west"]) == (41.56174688181377, 1.7507002150499145)
    assert (box["north"], box["east"]) == (41.65167891818623, 1.8709751849500855)


def test_a_row_inside_the_box_but_outside_the_circle_is_removed(monkeypatch):
    """The box reaches radius * sqrt(2) at its corners, so a fifth of it is not
    what was asked for. Each row's own coordinates settle it, at no extra call."""
    inside = wikiloc_discovery._within(41.609337, 1.767302, (*MONASTERY, FIVE_KM))
    corner = wikiloc_discovery._within(41.639588, 1.856903, (*MONASTERY, FIVE_KM))
    assert inside is True
    assert corner is False

    asked = _answers(monkeypatch, find=FIND_PAGE_0)
    body = wikiloc_discovery.nearby(
        lat=MONASTERY[0], lng=MONASTERY[1], radius_m=FIVE_KM
    ).as_dict()
    assert body["setAside"]["outsideRadius"] == 1
    # It cost nothing upstream: still the one call.
    assert len(asked.urls) == 1


# --- the units ----------------------------------------------------------------


def test_the_units_on_a_row_are_read_rather_than_assumed(monkeypatch):
    """An anonymous caller is served miles and feet, and the row says which.

    Both figures were checked against the trail page the row links to on
    2026-09-02: 5.17 mi and 2838 f, and the page publishes 8,320 m and 865 m of
    ascent. So `slope` is the climb, not the highest point.
    """
    _answers(monkeypatch, find=FIND_PAGE_0)
    row = wikiloc_discovery.nearby(
        lat=MONASTERY[0], lng=MONASTERY[1], radius_m=FIVE_KM
    ).as_dict()["results"][0]

    assert row["published"] == {
        "distanceM": 8320.30848,
        "ascentM": 865.0224000000001,
        # A row does not publish these, and null is the honest answer. The last
        # is the figure this whole product exists to check.
        "descentM": None,
        "durationS": None,
        "elevationMinM": None,
        "elevationMaxM": None,
        "pointCount": None,
    }


def test_a_unit_this_service_cannot_read_gives_no_figure_at_all():
    """Wrong by a factor of 1.6 is worse than missing, and missing is a shape
    the report already knows how to print."""
    assert wikiloc_discovery._metres("24.37", "km") == 24370.0
    assert wikiloc_discovery._metres("2215", "m") == 2215.0
    assert wikiloc_discovery._metres("15.14", "mi") == 15.14 * 1609.344
    assert wikiloc_discovery._metres("7,267", "f") == 7267 * 0.3048
    assert wikiloc_discovery._metres("7,267", "ft") == 7267 * 0.3048

    for unreadable in [
        ("5.17", "leagues"),
        ("5.17", None),
        ("5.17", 1),
        (None, "mi"),
        ("", "mi"),
        (True, "mi"),
        ("nothing", "mi"),
    ]:
        assert wikiloc_discovery._metres(*unreadable) is None


# --- the row is a link --------------------------------------------------------


def test_a_row_url_is_one_the_converter_can_already_open(monkeypatch):
    """`prettyURL` prefixed with the site, and proved against the converter's
    own reader rather than against a pattern written twice."""
    _answers(monkeypatch, find=FIND_PAGE_0)
    rows = wikiloc_discovery.nearby(
        lat=MONASTERY[0], lng=MONASTERY[1], radius_m=FIVE_KM
    ).as_dict()["results"]

    for row in rows:
        parsed = urlparse(row["url"])
        assert parsed.scheme == "https"
        assert http.ALLOWED_HOST.match(parsed.hostname)
        assert wikiloc.trail_id(row["url"]) is not None
        assert service.adapter_for(row["url"]) is wikiloc.fetch

    assert rows[0]["url"] == (
        "https://www.wikiloc.com/hiking-trails/can-macana-refugi-vicenc-barbe-miranda-del"
        "-princep-100-cims-feec-roca-foradada-sant-pau-vell-castel-184968972"
    )
    assert wikiloc.trail_id(rows[0]["url"]) == "184968972"


def test_a_link_whose_id_is_not_the_rows_id_is_dropped_rather_than_followed():
    """It can only happen if `prettyURL` changes shape, and then the link would
    convert somebody else's trail while answering 200."""
    good = "/hiking-trails/some-walk-184968972"
    assert wikiloc_discovery._convertible_url(good, 184968972) == (
        "https://www.wikiloc.com/hiking-trails/some-walk-184968972"
    )
    # Same id written as Wikiloc's own JSON number, and as text.
    assert wikiloc_discovery._convertible_url(good, "184968972") is not None

    assert wikiloc_discovery._convertible_url(good, 999) is None
    assert wikiloc_discovery._convertible_url("/trails/no-id-here", 5) is None
    assert wikiloc_discovery._convertible_url(None, 5) is None
    # Not a path on this site: an absolute link, and a protocol-relative one.
    assert wikiloc_discovery._convertible_url("https://example.org/x-5", 5) is None
    assert wikiloc_discovery._convertible_url("//example.org/x-5", 5) is None
    # Wikiloc's own bookkeeping does not travel back out inside a URL of ours.
    assert wikiloc_discovery._convertible_url("/hiking-trails/w-5?from=map#top", 5) == (
        "https://www.wikiloc.com/hiking-trails/w-5"
    )


def test_rows_that_could_not_be_opened_are_counted_rather_than_hidden(monkeypatch):
    """Otherwise the page shows "nothing found" for ever while Wikiloc answers."""
    _answers(
        monkeypatch,
        find={
            "count": 3,
            "spas": [
                {"id": 1, "prettyURL": "/hiking-trails/no-id-in-this-slug", "name": "A"},
                {"id": 2, "prettyURL": "https://example.org/hiking-trails/x-2", "name": "B"},
                {"id": 3, "name": "C", "lat": 41.6, "lon": 1.8},
                # Convertible, and unnamed. A row with no title is not a row.
                {"id": 4, "prettyURL": "/hiking-trails/w-4", "name": "   "},
            ],
        },
    )
    body = wikiloc_discovery.nearby(lat=41.6, lng=1.8).as_dict()

    assert body["results"] == []
    assert body["droppedRows"] == 4
    # Broken rows are counted as broken even when a filter would also have
    # removed them, because that number is about Wikiloc, not about the question.
    assert body["setAside"] == {"otherActivity": 0, "outsideRadius": 0}


def test_a_row_carries_no_number_and_no_id_of_its_own(monkeypatch):
    """Every figure sits inside `published`, and the row is a URL, never an id."""
    _answers(monkeypatch, find=FIND_PAGE_0)
    row = wikiloc_discovery.nearby(
        lat=MONASTERY[0], lng=MONASTERY[1], radius_m=FIVE_KM
    ).as_dict()["results"][0]

    assert set(row) == {"url", "title", "sport", "start", "thumbnail", "rating",
        "difficulty", "updatedAt", "publishedBy", "published"}

    # The rule, asserted as the rule: no figure at the top level of a row, where
    # printing it would read as something this tool worked out.
    for key, value in row.items():
        assert not isinstance(value, (int, float)), f"{key} is a bare number"

    assert row["publishedBy"] == "Wikiloc"
    assert row["sport"] == "hiking"
    assert row["start"] == {"lat": 41.609337, "lng": 1.767302}
    # The score other walkers gave now reaches the page, because the owner asked
    # for it on the card. It is the one claim that can never be recomputed, so
    # it can only ever read as the source's. The rest of Wikiloc's ranking still
    # never leaves: `trailrank` and `isTrending` are a discovery product's
    # furniture, and this is not one.
    assert row["rating"] == {"score": 4.92, "count": 13}
    for absent in ("id", "trailrank", "numRatings", "isTrending", "author"):
        assert absent not in row


def test_an_activity_wikiloc_has_added_since_is_left_null(monkeypatch):
    """A new picto gets no name rather than the wrong one."""
    _answers(
        monkeypatch,
        find={"spas": [{"id": 7, "prettyURL": "/hiking-trails/w-7", "name": "New thing",
                        "picto": 9999, "lat": 41.6, "lon": 1.8}]},
    )
    row = wikiloc_discovery.nearby(lat=41.6, lng=1.8).as_dict()["results"][0]
    assert row["sport"] is None
    assert row["published"]["distanceM"] is None


# --- paging -------------------------------------------------------------------


def test_two_pages_share_no_row(monkeypatch):
    """The Komoot side shipped this bug because nobody compared two pages.

    Wikiloc's `from`/`to` are honest: these two payloads are the real page 0 and
    page 1 of one box, captured on 2026-09-02, and they share no id. The windows
    asked for are half-open and do not overlap either.
    """
    asked = _answers(monkeypatch, find=FIND_PAGE_0)
    first = wikiloc_discovery.nearby(lat=41.6, lng=1.8, page=0, limit=6).as_dict()
    window_0 = asked.parameters()

    asked = _answers(monkeypatch, find=FIND_PAGE_1)
    second = wikiloc_discovery.nearby(lat=41.6, lng=1.8, page=1, limit=6).as_dict()
    window_1 = asked.parameters()

    assert (window_0["from"], window_0["to"]) == ("0", "6")
    assert (window_1["from"], window_1["to"]) == ("6", "12")
    assert window_0["sw"] == window_1["sw"] and window_0["ne"] == window_1["ne"]

    urls_0 = {row["url"] for row in first["results"]}
    urls_1 = {row["url"] for row in second["results"]}
    assert urls_0 and urls_1
    assert urls_0 & urls_1 == set()


def test_paging_stops_at_the_last_page_this_service_offers(monkeypatch):
    """Without a cap, page=999999 is a crawl with extra steps."""
    _answers(monkeypatch, find=FIND_PAGE_0)
    # Five rows for a window of five is a full window, so there may be more.
    assert wikiloc_discovery.nearby(lat=41.6, lng=1.8, limit=5).has_more is True
    # A short window is the last one, whatever the filtering did.
    assert wikiloc_discovery.nearby(lat=41.6, lng=1.8, limit=6).has_more is False

    last = wikiloc_discovery.nearby(lat=41.6, lng=1.8, limit=5, page=99)
    assert last.echo["page"] == wikiloc_discovery.PAGE_MAX
    assert last.has_more is False


def test_limit_and_radius_are_clamped_rather_than_refused(monkeypatch):
    """Somebody asking for a thousand wants "a lot"; the echo says what they got."""
    asked = _answers(monkeypatch, find=FIND_PAGE_0)
    listing = wikiloc_discovery.nearby(
        lat=41.6, lng=1.8, radius_m=999999, limit=1000, page=99
    )

    assert listing.echo["limit"] == wikiloc_discovery.NEARBY_LIMIT_MAX
    assert listing.echo["radiusM"] == wikiloc_discovery.RADIUS_MAX
    assert listing.echo["page"] == wikiloc_discovery.PAGE_MAX
    sent = asked.parameters()
    assert int(sent["to"]) - int(sent["from"]) == wikiloc_discovery.NEARBY_LIMIT_MAX

    listing = wikiloc_discovery.nearby(lat=41.6, lng=1.8, radius_m=0, limit=-5, page=-1)
    assert listing.echo["limit"] == 1
    assert listing.echo["radiusM"] == wikiloc_discovery.RADIUS_MIN
    assert listing.echo["page"] == 0

    # Search reads a bigger page, because `to` is capped at 25 rows upstream.
    assert wikiloc_discovery.search(query="montserrat", limit=1000).echo["limit"] == 25
    # A number that is not one falls back to the default.
    assert wikiloc_discovery.nearby(lat=41.6, lng=1.8).echo["radiusM"] == (
        wikiloc_discovery.RADIUS_DEFAULT
    )


def test_a_coordinate_off_the_earth_is_refused_rather_than_clamped(monkeypatch):
    """A latitude clamped to 90 answers Catalonia with the Arctic."""
    _never(monkeypatch)

    for lat, lng in [(91.0, 1.7), (-91.0, 1.7), (41.6, 181.0), (None, 1.7), (41.6, None)]:
        with pytest.raises(SourceError) as raised:
            wikiloc_discovery.nearby(lat=lat, lng=lng)
        assert raised.value.code == "location"

    with pytest.raises(SourceError) as raised:
        wikiloc_discovery.nearby(lat=float("nan"), lng=1.7)
    assert raised.value.code == "location"


# --- search, and its two calls ------------------------------------------------


def test_search_makes_exactly_two_calls_and_in_the_right_order(monkeypatch):
    """The place search, then the box. That is the whole fan-out ceiling."""
    asked = _answers(monkeypatch, find=FIND_PAGE_0, photon=PHOTON)
    listing = wikiloc_discovery.search(query="montserrat")

    assert len(asked.urls) == 2
    assert urlparse(asked.urls[0]).hostname == "photon.komoot.io"
    assert urlparse(asked.urls[1]).hostname == "www.wikiloc.com"
    # Never Wikiloc's own geocoder, which robots.txt disallows, and never its
    # map page either.
    for url in asked.urls:
        assert "geocode.do" not in url
        assert "map.do" not in url

    # The box is the place's own outline, trimmed to the radius cap.
    box = listing.echo["box"]
    assert (box["south"], box["west"]) == (41.5940903, 1.7800528)
    assert (box["north"], box["east"]) == (41.6129223, 1.8438239)


def test_search_names_the_places_it_found_and_credits_them(monkeypatch):
    """Five Montserrats, and only the visitor knows which they meant.

    The credit travels with them because the licence asks for it, and a page
    cannot render places it was not given.
    """
    _answers(monkeypatch, find=FIND_PAGE_0, photon=PHOTON)
    body = wikiloc_discovery.search(query="montserrat").as_dict()

    assert body["places"] == [
        {"name": "Montserrat, Catalonia, Spain", "lat": 41.6067129, "lng": 1.8108377},
        # The island is its own country, and a name is not repeated to fill a
        # pattern.
        {"name": "Montserrat", "lat": 16.7417041, "lng": -62.1916844},
        {"name": "Montserrat, Galicia, Spain", "lat": 43.3371433, "lng": -8.3919105},
    ]
    assert "url" not in body["places"][0]
    assert body["placesAttribution"] == (
        "Place search by Photon, data © OpenStreetMap contributors, ODbL"
    )
    assert "OpenStreetMap" in body["placesAttribution"]

    # Nearby geocodes nothing, so it has no places key and no credit to give.
    nearby = wikiloc_discovery.nearby(lat=41.6, lng=1.8).as_dict()
    assert "places" not in nearby
    assert "placesAttribution" not in nearby


def test_a_place_with_no_outline_gets_the_radius_box(monkeypatch):
    """Photon publishes an extent only where OSM has one."""
    only_a_point = {"features": [PHOTON["features"][2]]}
    asked = _answers(monkeypatch, find=EMPTY_FIND, photon=only_a_point)
    listing = wikiloc_discovery.search(query="montserrat")

    box = listing.echo["box"]
    expected = wikiloc_discovery._box(43.3371433, -8.3919105, wikiloc_discovery.RADIUS_DEFAULT)
    assert (box["south"], box["west"]) == expected[0]
    assert (box["north"], box["east"]) == expected[1]
    assert len(asked.urls) == 2


def test_an_outline_the_size_of_a_country_is_trimmed_to_the_radius_cap(monkeypatch):
    """A box that size answers "trails in Spain" with a handful of rows from
    anywhere in it."""
    island = {"features": [PHOTON["features"][1]]}
    _answers(monkeypatch, find=EMPTY_FIND, photon=island)
    box = wikiloc_discovery.search(query="montserrat").echo["box"]

    # The island's outline runs 30 km south of its centre and only 16 km north
    # of it, so the 25 km cap trims the south and leaves the north alone. Each
    # side is trimmed on its own, which is what keeps the box around the place
    # rather than around the middle of a circle.
    capped = wikiloc_discovery._box(16.7417041, -62.1916844, wikiloc_discovery.RADIUS_DEFAULT)
    assert box["south"] == capped[0][0] > 16.4737398
    assert box["north"] == 16.8885156 < capped[1][0]
    assert box["west"] == capped[0][1] > -62.4502432
    assert box["east"] == capped[1][1] < -61.9359751


def test_words_that_are_nowhere_spend_one_call_and_not_two(monkeypatch):
    """No place means no box, so there is nothing to ask Wikiloc."""
    asked = _answers(monkeypatch, photon=NO_PLACE)
    body = wikiloc_discovery.search(query="qqqqqqqq").as_dict()

    assert len(asked.urls) == 1
    assert body["results"] == []
    assert body["places"] == []
    assert body["query"]["box"] is None
    assert body["paging"]["hasMore"] is False
    assert body["paging"]["totalKnown"] is None


def test_a_blank_search_is_refused_and_a_long_one_is_cut(monkeypatch):
    _answers(monkeypatch, find=FIND_PAGE_0)
    for blank in (None, "", "   ", "a"):
        with pytest.raises(SourceError) as raised:
            wikiloc_discovery.search(query=blank)
        assert raised.value.code == "query"

    listing = wikiloc_discovery.search(query="x" * 400)
    assert len(listing.echo["query"]) == wikiloc_discovery.QUERY_MAX_CHARS


def test_an_empty_result_set_is_a_successful_answer(monkeypatch):
    """Nothing matched is a question answered, not a route that does not exist."""
    _answers(monkeypatch, find=EMPTY_FIND)
    body = wikiloc_discovery.nearby(lat=41.6, lng=1.8).as_dict()

    assert body["results"] == []
    assert body["droppedRows"] == 0
    assert body["setAside"] == {"otherActivity": 0, "outsideRadius": 0}
    assert body["paging"]["hasMore"] is False
    assert body["paging"]["totalKnown"] is None
    assert body["source"] == {"id": "wikiloc", "label": "Wikiloc"}


def test_an_upstream_refusal_is_a_failure_to_answer_not_a_missing_route(monkeypatch):
    """A list endpoint saying 404 is not one trail saying it does not exist.

    And the message says which of the two upstreams went quiet, because they
    fail for different reasons and only one of them is Wikiloc.
    """
    _answers(monkeypatch, status=403)
    with pytest.raises(SourceError) as raised:
        wikiloc_discovery.nearby(lat=41.6, lng=1.8)
    assert raised.value.code == "network"
    assert raised.value.detail == "Wikiloc answered 403"

    with pytest.raises(SourceError) as raised:
        wikiloc_discovery.search(query="montserrat")
    assert raised.value.code == "network"
    assert raised.value.detail == "the place search answered 403"


# --- the hosts ----------------------------------------------------------------


def test_the_geocoder_is_on_the_allowlist_and_spends_its_own_budget():
    """It runs on a komoot domain and it is not Komoot. Left to the pattern it
    would spend the budget the route pages need."""
    assert http.ALLOWED_HOST.match(http.GEOCODER_HOST)
    assert wikiloc_discovery.GEOCODE_URL.startswith(f"https://{http.GEOCODER_HOST}/")

    assert http._site("https://photon.komoot.io/api/?q=x") == "photon"
    assert http._site("https://www.komoot.com/api/search/discover") == "komoot"
    assert http._site("https://www.wikiloc.com/wikiloc/find.do") == "wikiloc"
    assert http._buckets("photon") is http._geocoder
    assert http._buckets("komoot") is http._sites


def test_a_wikiloc_search_spends_one_token_at_each_site(monkeypatch):
    """Two calls, two sites, and neither bucket paying for the other."""
    monkeypatch.setattr(http.requests, "get", _replies(200, b'{"spas": []}'))

    with http.request_budget("one-visitor"):
        http.fetch_text("https://photon.komoot.io/api/?q=montserrat")
        http.fetch_text("https://www.wikiloc.com/wikiloc/find.do?event=map")

    assert http._geocoder._levels["photon"].tokens == http.GEOCODER_CAPACITY - 1
    assert http._sites._levels["wikiloc"].tokens == http.SITE_CAPACITY - 1
    assert "komoot" not in http._sites._levels


def _replies(status, body):
    class _Response:
        status_code = status
        content = body
        encoding = "utf-8"

    def get(url, **kwargs):
        return _Response()

    return get


# --- the endpoints ------------------------------------------------------------

client = TestClient(service.app)


def test_the_vocabulary_endpoint_answers_per_source_and_spends_nothing(monkeypatch):
    """The dropdown changes with the source, so this is what feeds it."""
    _never(monkeypatch)

    komoot_body = client.get("/api/sports").json()
    assert komoot_body == {
        "ok": True,
        "sports": ["hike", "touringbicycle", "mtb", "racebike", "jogging", "mountaineering"],
        "default": "hike",
    }
    # Asking for Komoot by name is the same answer as not asking.
    assert client.get("/api/sports?source=komoot").json() == komoot_body

    body = client.get("/api/sports?source=wikiloc").json()
    assert body["ok"] is True
    assert body["default"] == "all"
    assert body["sports"][:4] == ["all", "hiking", "trail-running", "walking"]
    assert len(body["sports"]) == len(wikiloc_discovery.ACTIVITIES) + 1
    # The two vocabularies are never merged, and they share no word.
    assert set(body["sports"]) & set(komoot_body["sports"]) == set()
    # Labels and groups come with it, because eighty slugs is a wall otherwise.
    assert body["activities"][1] == {"id": "hiking", "label": "Hiking", "group": "On Foot"}
    assert {each["group"] for each in body["activities"]} >= {"On Foot", "Snow", "Water"}
    # Komoot's answer has no labels: this service does not know its display
    # names, and inventing them is how a dropdown shows words nobody chose.
    assert "activities" not in komoot_body


def test_a_site_this_service_does_not_read_is_refused(monkeypatch):
    _never(monkeypatch)

    for path, payload in [
        ("/api/search", {"source": "strava", "query": "montserrat"}),
        ("/api/nearby", {"source": "strava", "lat": 41.6, "lng": 1.8}),
    ]:
        response = client.post(path, json=payload)
        body = response.json()
        assert response.status_code == 400
        assert body["error"] == "source"
        assert "wikiloc" in body["detail"]

    response = client.get("/api/sports?source=strava")
    assert response.status_code == 400
    assert response.json()["error"] == "source"


def test_the_endpoints_answer_wikiloc_when_asked_and_komoot_when_not(monkeypatch):
    asked = _answers(monkeypatch, find=FIND_PAGE_0, photon=PHOTON)

    response = client.post(
        "/api/nearby",
        json={
            "source": "wikiloc",
            "lat": MONASTERY[0],
            "lng": MONASTERY[1],
            "radiusM": FIVE_KM,
            "sport": "hiking",
            "limit": 6,
        },
    )
    body = response.json()
    assert response.status_code == 200
    assert body["ok"] is True
    assert body["source"] == {"id": "wikiloc", "label": "Wikiloc"}
    assert body["query"]["sport"] == "hiking"
    assert body["paging"]["pageSize"] == 6
    assert len(body["results"]) == 3
    assert body["setAside"] == {"otherActivity": 2, "outsideRadius": 0}

    response = client.post(
        "/api/search", json={"source": "wikiloc", "query": "montserrat", "sport": "all"}
    )
    body = response.json()
    assert response.status_code == 200
    assert body["source"]["id"] == "wikiloc"
    assert len(asked.urls) == 3  # one nearby, then the search's two

    # A Wikiloc word sent to Komoot is still refused, which is what keeps the
    # two dropdowns from being quietly interchangeable.
    response = client.post("/api/search", json={"query": "montserrat", "sport": "hiking"})
    assert response.status_code == 400
    assert response.json()["error"] == "sport"


def test_a_wikiloc_list_answer_is_never_a_track(monkeypatch):
    """A row is a URL with Wikiloc's claims on it. Converting is a click away."""
    _answers(monkeypatch, find=FIND_PAGE_0, photon=PHOTON)
    text = client.post("/api/search", json={"source": "wikiloc", "query": "montserrat"}).text

    assert "gpx" not in text.lower()
    assert "measured" not in text.lower()
    assert "geom" not in text.lower()
