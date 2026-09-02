"""Search and Nearby, with no network.

Every payload below was captured from one real anonymous call on 2026-09-02, to
the addresses named beside it, and then cut down to the fields this service
reads. Keeping the real shapes here means these tests fail when Komoot changes
the shape, and pass without asking Komoot anything.
"""

import json
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from api import app as service
from api import http
from api.sources import SourceError, komoot, komoot_discovery


# https://www.komoot.com/api/search/discover?query=montseny
#   &entities=editorial_tours,places&sport=all&limit=12&page=0
#
# One tour and one place, which is what a mixed query really returns. The share
# URL carries the "e" prefix and a search token in its query string; the brief
# also recorded a share URL with a bare id, so the second tour is that shape.
SEARCH_PAYLOAD = {
    "_embedded": {
        "items": [
            {
                "name": "Montseny",
                "point": {"x": 2.3952061, "y": 41.7593697},
                "content_type": "location",
            },
            {
                "id": 14597,
                "tour_id": 995566070,
                "name": "Panoramic route of Turó l'Home",
                "sport": "racebike",
                "distance": 27553,
                "duration": 5468,
                "elevation_up": 536.3764041862166,
                "elevation_down": 533.4021419517729,
                "share_url": "https://www.komoot.com/smarttour/e995566070/ruta-panor-mica?query=d01An",
                "score": 6.403685748208087,
                "start_point": {"lat": 41.687192, "lng": 2.486443},
                "_links": {
                    "self": {"href": "https://api.komoot.de/v007/discover_tours/e995566070"}
                },
                "content_type": "editorial_tour",
            },
            {
                "id": 14971309,
                "tour_id": 14971309,
                "name": "Montseny circular",
                "sport": "hike",
                "distance": 10616,
                "duration": 10975,
                "elevation_up": 250.71,
                "elevation_down": 250.68,
                "share_url": "https://www.komoot.com/smarttour/14971309/montseny-circular",
                "start_point": {"lat": 41.640649, "lng": 1.788649},
                "content_type": "editorial_tour",
            },
        ]
    }
}

# https://www.komoot.com/api/v007/discover_tours/from_location/
#   ?lat=41.7593697&lng=2.3952061&sport=hike&max_distance=25000&limit=3&page=0
NEARBY_PAYLOAD = {
    "_embedded": {
        "items": [
            {
                "id": "e1357821789",
                "status": "public",
                "name": "Tourdera Trail: Montseny Loop",
                "start_point": {"lat": 41.759424, "lng": 2.395278, "alt": 518.8},
                "distance": 9052.888084332455,
                "duration": 9831,
                "elevation_up": 303.4749832359257,
                "elevation_down": 301.5467580312343,
                "sport": "hike",
                "share_url": "https://www.komoot.com/smarttour/e1357821789/tourdera-trail?query=d01An",
            },
            # The same item with no share_url. The brief documented the nearby
            # envelope but never an item body, so a Komoot that stops sending
            # one must still not send rows to the wrong endpoint.
            {
                "id": "e1358505775",
                "name": "Turó de l'Home circular from Montseny",
                "start_point": {"lat": 41.76, "lng": 2.39},
                "distance": 17805.88736339556,
                "duration": 20000,
                "elevation_up": 900.5,
                "elevation_down": 900.1,
                "sport": "hike",
            },
        ]
    },
    "page": {"size": 3, "totalElements": 12, "totalPages": 4, "number": 0},
}

EMPTY_NEARBY_PAYLOAD = {
    "_embedded": {"items": []},
    "page": {"size": 10, "totalElements": 0, "totalPages": 0, "number": 0},
}


@pytest.fixture(autouse=True)
def _empty_buckets():
    """Every test starts where a fresh process starts: nothing spent."""
    for buckets in (service._inbound, http._clients, http._sites):
        buckets._levels.clear()
    yield


class _Asked:
    """Stands in for Komoot, and remembers what it was asked for."""

    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status
        self.urls = []

    def __call__(self, url, timeout=None):
        self.urls.append(url)
        self.timeout = timeout
        return self.status, self.payload

    def parameters(self, index=0):
        return {key: value[0] for key, value in parse_qs(urlparse(self.urls[index]).query).items()}


def _answers(monkeypatch, payload, status=200):
    asked = _Asked(payload, status)
    monkeypatch.setattr(komoot_discovery, "fetch_json", asked)
    return asked


def test_a_sport_komoot_does_not_have_is_refused_before_any_request(monkeypatch):
    """A bad sport costs no upstream token, and the answer names the good ones."""

    def never(url, timeout=None):
        raise AssertionError(f"asked Komoot for {url} instead of reading the sport")

    monkeypatch.setattr(komoot_discovery, "fetch_json", never)

    for call in (
        lambda: komoot_discovery.search(query="montseny", sport="nonsense"),
        lambda: komoot_discovery.nearby(lat=41.6, lng=1.7, sport="nonsense"),
    ):
        with pytest.raises(SourceError) as raised:
            call()
        assert raised.value.code == "sport"
        for sport in komoot_discovery.SPORTS:
            assert sport in raised.value.detail


def test_nearby_needs_a_sport_and_search_does_not(monkeypatch):
    """Upstream demands one, and a hidden default would hand a cyclist a walk."""
    asked = _answers(monkeypatch, SEARCH_PAYLOAD)
    assert komoot_discovery.search(query="montseny").echo["sport"] == "all"
    assert asked.parameters()["sport"] == "all"

    with pytest.raises(SourceError) as raised:
        komoot_discovery.nearby(lat=41.6, lng=1.7, sport=None)
    assert raised.value.code == "sport"


def test_a_blank_search_is_refused_and_a_long_one_is_cut(monkeypatch):
    _answers(monkeypatch, SEARCH_PAYLOAD)
    for blank in (None, "", "   ", "a"):
        with pytest.raises(SourceError) as raised:
            komoot_discovery.search(query=blank)
        assert raised.value.code == "query"

    listing = komoot_discovery.search(query="x" * 400)
    assert len(listing.echo["query"]) == komoot_discovery.QUERY_MAX_CHARS


def test_limit_and_radius_are_clamped_rather_than_refused(monkeypatch):
    """Somebody asking for a thousand wants "a lot"; the echo says what they got.

    Nearby stops at NEARBY_LIMIT_MAX rather than LIMIT_MAX, because above six
    the upstream stops paginating and silently repeats page 0.
    """
    asked = _answers(monkeypatch, NEARBY_PAYLOAD)
    listing = komoot_discovery.nearby(
        lat=41.6, lng=1.7, sport="hike", radius_m=999999, limit=1000, page=99
    )

    assert listing.echo["limit"] == komoot_discovery.NEARBY_LIMIT_MAX
    assert listing.echo["radiusM"] == komoot_discovery.RADIUS_MAX
    assert listing.echo["page"] == komoot_discovery.PAGE_MAX

    sent = asked.parameters()
    assert sent["limit"] == str(komoot_discovery.NEARBY_LIMIT_MAX)
    assert sent["max_distance"] == str(komoot_discovery.RADIUS_MAX)
    assert sent["page"] == str(komoot_discovery.PAGE_MAX)

    # And the other end of each range, including a radius asked for as nothing.
    listing = komoot_discovery.nearby(
        lat=41.6, lng=1.7, sport="hike", radius_m=0, limit=-5, page=-1
    )
    assert listing.echo["limit"] == 1
    assert listing.echo["radiusM"] == komoot_discovery.RADIUS_MIN
    assert listing.echo["page"] == 0

    # A number that is not one falls back to the default rather than failing.
    # Nearby's default is its maximum, because that maximum is already the
    # largest page the upstream will actually paginate.
    listing = komoot_discovery.nearby(lat=41.6, lng=1.7, sport="hike", limit=None)
    assert listing.echo["limit"] == komoot_discovery.NEARBY_LIMIT_MAX
    assert listing.echo["radiusM"] == komoot_discovery.RADIUS_DEFAULT


def test_a_coordinate_off_the_earth_is_refused_rather_than_clamped(monkeypatch):
    """A latitude clamped to 90 answers Catalonia with the Arctic."""

    def never(url, timeout=None):
        raise AssertionError("asked Komoot with a coordinate that is not a place")

    monkeypatch.setattr(komoot_discovery, "fetch_json", never)

    for lat, lng in [(91.0, 1.7), (-91.0, 1.7), (41.6, 181.0), (None, 1.7), (41.6, None)]:
        with pytest.raises(SourceError) as raised:
            komoot_discovery.nearby(lat=lat, lng=lng, sport="hike")
        assert raised.value.code == "location"

    with pytest.raises(SourceError) as raised:
        komoot_discovery.nearby(lat=float("nan"), lng=1.7, sport="hike")
    assert raised.value.code == "location"


def test_an_empty_result_set_is_a_successful_answer(monkeypatch):
    """Nothing matched is a question answered, not a route that does not exist."""
    _answers(monkeypatch, EMPTY_NEARBY_PAYLOAD)
    listing = komoot_discovery.nearby(lat=41.6, lng=1.7, sport="hike")
    body = listing.as_dict()

    assert body["results"] == []
    assert body["droppedRows"] == 0
    assert body["paging"]["hasMore"] is False
    assert body["paging"]["totalKnown"] == 0

    _answers(monkeypatch, {"_embedded": {"items": []}})
    search_body = komoot_discovery.search(query="qqqqqqq").as_dict()
    assert search_body["results"] == []
    assert search_body["places"] == []
    # Search has no envelope, so the total is not known rather than zero.
    assert search_body["paging"]["totalKnown"] is None


def test_rows_that_could_not_be_opened_are_counted_rather_than_hidden(monkeypatch):
    """Otherwise the page shows "nothing found" for ever while Komoot answers."""
    unreadable = {
        "_embedded": {
            "items": [
                # A browse page, not a route.
                {
                    "name": "Somewhere",
                    "share_url": "https://www.komoot.com/discover/hiking-trails",
                    "content_type": "editorial_tour",
                },
                # A host this service does not read.
                {
                    "name": "Elsewhere",
                    "share_url": "https://example.org/smarttour/e1",
                    "content_type": "editorial_tour",
                },
                # No link at all, and no id to build one from.
                {"name": "Nowhere", "content_type": "editorial_tour"},
            ]
        }
    }
    _answers(monkeypatch, unreadable)
    body = komoot_discovery.search(query="montseny").as_dict()

    assert body["results"] == []
    assert body["droppedRows"] == 3


def test_a_row_url_is_one_the_converter_can_already_open(monkeypatch):
    """Both id spaces, both proved against the converter's own reader."""
    _answers(monkeypatch, SEARCH_PAYLOAD)
    rows = komoot_discovery.search(query="montseny").as_dict()["results"]

    assert [row["url"] for row in rows] == [
        # The search token is dropped: it is Komoot's, not the route's address.
        "https://www.komoot.com/smarttour/e995566070/ruta-panor-mica",
        "https://www.komoot.com/smarttour/14971309/montseny-circular",
    ]
    # The "e" sends one to the tour endpoint and its absence sends the other to
    # the smart-tour endpoint. Same word in the path, different route entirely.
    assert komoot._link(rows[0]["url"]) == ("tour", "995566070")
    assert komoot._link(rows[1]["url"]) == ("smart_tour", "14971309")

    _answers(monkeypatch, NEARBY_PAYLOAD)
    nearby_rows = komoot_discovery.nearby(lat=41.7, lng=2.4, sport="hike").as_dict()["results"]
    assert [row["url"] for row in nearby_rows] == [
        "https://www.komoot.com/smarttour/e1357821789/tourdera-trail",
        # Composed from the id, with the prefix left exactly as Komoot wrote it.
        "https://www.komoot.com/smarttour/e1358505775",
    ]
    assert komoot._link(nearby_rows[1]["url"]) == ("tour", "1358505775")


def test_the_e_prefix_is_never_added_and_never_stripped():
    """The trap is silent: the wrong endpoint answers 200 with another mountain."""
    assert (
        komoot_discovery._convertible_url(None, "e945461356")
        == "https://www.komoot.com/smarttour/e945461356"
    )
    assert (
        komoot_discovery._convertible_url(None, "945461356")
        == "https://www.komoot.com/smarttour/945461356"
    )
    assert komoot._link("https://www.komoot.com/smarttour/e945461356") == ("tour", "945461356")
    assert komoot._link("https://www.komoot.com/smarttour/945461356") == (
        "smart_tour",
        "945461356",
    )
    # An id that is not an id at all builds nothing rather than a wrong link.
    assert komoot_discovery._convertible_url(None, "not-an-id") is None
    assert komoot_discovery._convertible_url(None, None) is None


def test_a_row_carries_no_number_of_its_own(monkeypatch):
    """Every figure sits inside `published`, where reading it reads as a claim."""
    _answers(monkeypatch, SEARCH_PAYLOAD)
    row = komoot_discovery.search(query="montseny").as_dict()["results"][1]

    assert set(row) == {"url", "title", "sport", "start", "thumbnail", "rating",
        "difficulty", "updatedAt", "publishedBy", "published"}

    # The rule this test exists for, asserted as the rule rather than as a list:
    # no figure sits at the top level of a row, where printing it would read as
    # something this tool worked out. `rating` is the one exception and it is a
    # dict, not a number, because it is the single claim we can never recompute:
    # there is nothing to compare an opinion against, so it can only ever be
    # the source's.
    for key, value in row.items():
        assert not isinstance(value, (int, float)), f"{key} is a bare number"

    assert row["publishedBy"] == "Komoot"
    assert row["title"] == "Montseny circular"
    assert row["start"] == {"lat": 41.640649, "lng": 1.788649}
    assert row["published"] == {
        "distanceM": 10616.0,
        "ascentM": 250.71,
        "descentM": 250.68,
        "durationS": 10975.0,
        "elevationMinM": None,
        "elevationMaxM": None,
        # How many points a track carries is the figure this product exists to
        # check, and a list never says it.
        "pointCount": None,
    }
    # Komoot's own relevance never leaves: it means nothing to a visitor, and
    # showing it invites a "best match" badge and then a ranking of our own.
    assert "score" not in row


def test_a_figure_komoot_left_out_stays_null(monkeypatch):
    """Never zero, never worked out from a neighbour."""
    _answers(
        monkeypatch,
        {"_embedded": {"items": [{
            "name": "Flat and short",
            "share_url": "https://www.komoot.com/smarttour/e1",
            "elevation_up": 0.0,
            "content_type": "editorial_tour",
        }]}},
    )
    published = komoot_discovery.search(query="montseny").as_dict()["results"][0]["published"]
    # A flat route publishing 0.0 is an answer; a missing field is not.
    assert published["ascentM"] == 0.0
    assert published["distanceM"] is None
    assert published["durationS"] is None


def test_places_ride_in_on_the_same_call_and_carry_no_link(monkeypatch):
    """The nearby form needs coordinates from a name, not a second request."""
    asked = _answers(monkeypatch, SEARCH_PAYLOAD)
    body = komoot_discovery.search(query="montseny").as_dict()

    assert len(asked.urls) == 1
    # x is the longitude. Read in written order, every place lands in the sea.
    assert body["places"] == [{"name": "Montseny", "lat": 41.7593697, "lng": 2.3952061}]
    assert "url" not in body["places"][0]

    # Nearby has nothing to geocode, so it has no places key at all.
    _answers(monkeypatch, NEARBY_PAYLOAD)
    assert "places" not in komoot_discovery.nearby(lat=41.7, lng=2.4, sport="hike").as_dict()


def test_paging_stops_at_the_last_page_this_service_offers(monkeypatch):
    """Without a cap, page=999999 is a crawl with extra steps."""
    _answers(monkeypatch, NEARBY_PAYLOAD)
    assert komoot_discovery.nearby(lat=41.7, lng=2.4, sport="hike").has_more is True
    # Page four is the last, so the page cannot render a button into page five.
    last = komoot_discovery.nearby(lat=41.7, lng=2.4, sport="hike", page=4)
    assert last.has_more is False
    assert last.total_known == 12

    # Search has no envelope: a page filled to the size asked for is the only
    # evidence there is more, and tours and places share that page.
    _answers(monkeypatch, SEARCH_PAYLOAD)
    assert komoot_discovery.search(query="montseny", limit=3).has_more is True
    assert komoot_discovery.search(query="montseny", limit=10).has_more is False


def test_an_upstream_refusal_is_a_failure_to_answer_not_a_missing_route(monkeypatch):
    """A list endpoint saying 404 is not one route saying it does not exist."""
    _answers(monkeypatch, None, status=404)
    with pytest.raises(SourceError) as raised:
        komoot_discovery.search(query="montseny")
    assert raised.value.code == "network"


def test_nothing_reaches_the_network_without_an_inbound_request(monkeypatch):
    """robots.txt forbids walking the site, so this is the rule as code."""

    def never(*args, **kwargs):
        raise AssertionError("reached the network with nobody asking")

    monkeypatch.setattr(http.requests, "get", never)

    with pytest.raises(http.OutsideRequest):
        http.fetch_text("https://www.komoot.com/api/v007/tours/1")


def test_the_fan_out_ceiling_stops_a_third_call(monkeypatch):
    """Two is the designed fan-out for a plain request, and a third is a bug.

    There are now two tiers, not one. Two is what a conversion or an unfiltered
    listing gets, and it is still the default. Filtering earns more, because
    Wikiloc will not filter without an account and Komoot ignores the parameter,
    so the rows have to be read here and set aside here. What has not changed is
    that a caller cannot name its own number.
    """
    monkeypatch.setattr(http.requests, "get", _replies(200, b"{}"))

    with http.request_budget("someone"):
        http.fetch_text("https://www.komoot.com/api/v007/tours/1")
        http.fetch_text("https://www.komoot.com/api/v007/tours/1/coordinates")
        with pytest.raises(http.OutsideRequest) as raised:
            http.fetch_text("https://www.komoot.com/api/v007/tours/2")
    assert "ceiling" in str(raised.value)

    # The default is still two, and it is what every unfiltered path opens with.
    with http.request_budget("plain") as budget:
        assert budget.remaining == http.FAN_OUT_CEILING

    # A filtered listing may ask for more, up to the named tier and no further.
    with http.request_budget("filtering", calls=http.FILTER_FAN_OUT) as budget:
        assert budget.remaining == http.FILTER_FAN_OUT

    # And a caller still cannot name its own number.
    with http.request_budget("greedy", calls=99) as budget:
        assert budget.remaining == http.FILTER_FAN_OUT


def test_the_outbound_budget_refuses_a_client_past_its_share(monkeypatch):
    """Eight in a burst, then the ninth waits. Fairness, not safety."""
    monkeypatch.setattr(http.requests, "get", _replies(200, b"{}"))

    spent = 0
    refused = None
    for _ in range(http.CLIENT_CAPACITY + 4):
        try:
            with http.request_budget("one-visitor", calls=1):
                http.fetch_text("https://www.komoot.com/api/v007/tours/1")
            spent += 1
        except http.BudgetExhausted as error:
            refused = error
            break

    assert spent == http.CLIENT_CAPACITY
    assert refused is not None
    assert refused.hint == "self"
    assert 1 <= refused.retry_after <= 6
    assert "coordinates" not in refused.detail  # nothing of the request in the log

    # Another visitor is untouched: the empty bucket was theirs, not the site's.
    with http.request_budget("another-visitor", calls=1):
        assert http.fetch_text("https://www.komoot.com/api/v007/tours/1")[0] == 200


def test_the_site_budget_is_the_one_no_client_key_can_dodge(monkeypatch):
    """Rotating the client key spends the shared bucket faster, never past it."""
    monkeypatch.setattr(http.requests, "get", _replies(200, b"{}"))

    spent = 0
    refused = None
    for number in range(http.SITE_CAPACITY + 5):
        try:
            with http.request_budget(f"visitor-{number}", calls=1):
                http.fetch_text("https://www.komoot.com/api/v007/tours/1")
            spent += 1
        except http.BudgetExhausted as error:
            refused = error
            break

    assert spent == http.SITE_CAPACITY
    assert refused is not None
    assert refused.hint == "shared"
    # Long enough that a queue of callers does not come back once a second.
    assert refused.retry_after >= 5

    # Wikiloc has its own bucket, so komoot filling up does not close it.
    with http.request_budget("someone", calls=1):
        assert http.fetch_text("https://www.wikiloc.com/trail-1")[0] == 200


def test_a_failed_call_still_costs_a_token(monkeypatch):
    """Refunding on error is how an outage becomes a hammering loop."""

    def refuses(*args, **kwargs):
        raise OSError("no route to host")

    monkeypatch.setattr(http.requests, "get", refuses)
    with http.request_budget("one-visitor") as budget:
        assert http.fetch_text("https://www.komoot.com/api/v007/tours/1") == (0, "")
        assert budget.remaining == http.FAN_OUT_CEILING - 1


def _replies(status, body):
    class _Response:
        status_code = status
        content = body
        encoding = "utf-8"

    def get(url, **kwargs):
        return _Response()

    return get


# --- the endpoints, through the shared error envelope ------------------------

client = TestClient(service.app)


def test_the_sports_endpoint_spends_nothing(monkeypatch):
    def never(url, timeout=None):
        raise AssertionError("asked Komoot for a list it already has")

    monkeypatch.setattr(komoot_discovery, "fetch_json", never)

    body = client.get("/api/sports").json()
    assert body == {
        "ok": True,
        "sports": ["hike", "touringbicycle", "mtb", "racebike", "jogging", "mountaineering"],
        "default": "hike",
    }


def test_search_answers_rows_and_places(monkeypatch):
    _answers(monkeypatch, SEARCH_PAYLOAD)
    response = client.post("/api/search", json={"query": "montseny", "limit": 1000})
    body = response.json()

    assert response.status_code == 200
    assert body["ok"] is True
    assert body["source"] == {"id": "komoot", "label": "Komoot"}
    assert body["query"] == {"query": "montseny", "sport": "all", "limit": 25, "page": 0}
    assert len(body["results"]) == 2
    assert body["paging"]["pageSize"] == 25
    assert body["droppedRows"] == 0


def test_a_list_answer_is_never_a_track(monkeypatch):
    """A row is a URL with the source's claims on it. Converting is a click away."""
    _answers(monkeypatch, SEARCH_PAYLOAD)
    text = client.post("/api/search", json={"query": "montseny"}).text
    body = json.loads(text)

    assert "gpx" not in body
    assert "measurements" not in body
    assert "measured" not in text.lower()


def test_every_bad_input_leaves_through_the_same_envelope(monkeypatch):
    _answers(monkeypatch, SEARCH_PAYLOAD)

    for path, payload, code, status in [
        ("/api/search", {"query": "  "}, "query", 400),
        ("/api/search", {"query": "montseny", "sport": "nonsense"}, "sport", 400),
        ("/api/search", {"query": "montseny", "near": {"lat": 200, "lng": 0}}, "location", 400),
        ("/api/nearby", {"lat": 41.6, "lng": 1.7}, "sport", 400),
        ("/api/nearby", {"lat": 200, "lng": 1.7, "sport": "hike"}, "location", 400),
    ]:
        response = client.post(path, json=payload)
        body = response.json()
        assert response.status_code == status, (path, body)
        assert set(body) == {"ok", "error", "hint", "detail"}
        assert body["ok"] is False
        assert body["error"] == code


def test_a_malformed_body_is_answered_in_this_services_own_shape():
    """Otherwise the page reads FastAPI's shape and blames the route."""
    response = client.post("/api/search", json={"query": 5})
    body = response.json()

    assert response.status_code == 400
    assert body["ok"] is False
    assert body["error"] == "request"

    # The same fix reaches the endpoint that had the bug: `{"url": 5}` used to
    # tell a visitor the page no longer carried the track.
    assert client.post("/api/convert", json={"url": 5}).json()["error"] == "request"


def test_the_inbound_guard_refuses_the_twenty_first_request():
    """A request that never reaches Komoot still costs this process something."""
    for number in range(service.INBOUND_MAX_REQUESTS):
        assert client.get("/api/sports").status_code == 200, number

    response = client.get("/api/sports")
    body = response.json()
    assert response.status_code == 429
    assert body["error"] == "busy"
    assert body["hint"] == "self"
    assert int(response.headers["Retry-After"]) >= 1

    # The liveness probe is exempt: the platform calls it on a schedule, and
    # counting it would refuse the probe and evict real visitors to do it.
    assert client.get("/api/health").status_code == 200
