"""Both sites in one answer, with no network.

The rule these are about: WHAT THE ANSWER SAYS ABOUT ITSELF MUST BE TRUE OF
EVERY ROW IN IT. A merged list is two searches, and the two sites do not do the
same thing with a point the visitor picked. A Wikiloc search IS a bounding box,
so the point becomes the box and its rows can only be from there. Komoot reads
the words as a place itself and takes the point only as a nudge to the ranking,
which was measured against the live endpoint and written down in
`komoot_discovery.POINT_APPLIED`.

So one sentence over the whole list was false about half of it, and the answer
now carries the fact per site.
"""

import pytest

from api import http
from api import app as service
from api.sources import komoot_discovery, merged, wikiloc_discovery


# One tour and one place from Komoot, and one trail from Wikiloc. Cut to the
# fields the row builders read; the full shapes live in the two site suites.
KOMOOT_ANSWER = {
    "_embedded": {
        "items": [
            {
                "name": "Montserrat",
                "point": {"x": -0.6031, "y": 39.3576494},
                "address_entry": {"state": "Valencian Community", "country": "Spain"},
                "content_type": "location",
            },
            {
                "name": "Montserrat",
                "point": {"x": -62.1916844, "y": 16.7417041},
                "address_entry": {"country": "Montserrat"},
                "content_type": "location",
            },
            {
                "id": 14971309,
                "name": "Montserrat circular",
                "sport": "hike",
                "distance": 10616,
                "share_url": "https://www.komoot.com/smarttour/14971309/montserrat-circular",
                "start_point": {"lat": 41.640649, "lng": 1.788649},
                "content_type": "editorial_tour",
            },
        ]
    }
}

WIKILOC_ANSWER = {
    "count": 12,
    "spas": [
        {
            "id": 184968972,
            "prettyURL": "/hiking-trails/isles-bay-184968972",
            "name": "Isles Bay to Foxes Bay",
            "picto": 1,
            "pictoText": "Hiking",
            "lat": 16.73323,
            "lon": -62.232692,
            "uom": "mi",
            "uomslope": "f",
            "distance": "3.10",
            "slope": "820",
            "rating": 0.0,
            "numRatings": 0,
        }
    ],
}

PHOTON = {
    "features": [
        {
            "type": "Feature",
            "properties": {"name": "Montserrat", "country": "Montserrat"},
            "geometry": {"type": "Point", "coordinates": [-62.1916844, 16.7417041]},
        }
    ]
}

ISLAND = (16.7417041, -62.1916844)


@pytest.fixture(autouse=True)
def _empty_buckets():
    for buckets in (service._inbound, http._clients, http._sites, http._geocoder):
        buckets._levels.clear()
    yield


def _answers(monkeypatch, komoot=KOMOOT_ANSWER, wikiloc=WIKILOC_ANSWER, photon=PHOTON):
    """Both sites and the geocoder, answered by host so a swap cannot pass."""

    def komoot_call(url, timeout=None):
        return 200, komoot

    def wikiloc_call(url, timeout=None):
        return 200, photon if "photon" in url else wikiloc

    monkeypatch.setattr(komoot_discovery, "fetch_json", komoot_call)
    monkeypatch.setattr(wikiloc_discovery, "fetch_json", wikiloc_call)


def _sources(listing):
    return {row["id"]: row for row in listing.as_dict()["sources"]}


def test_a_picked_point_is_reported_per_site_because_the_two_differ(monkeypatch):
    _answers(monkeypatch)
    with http.request_budget("test", calls=http.FILTER_FAN_OUT):
        listing = merged.search(query="montserrat", near=ISLAND)

    rows = _sources(listing)
    # Wikiloc's search is the box, so the point is the search.
    assert rows["wikiloc"]["pointApplied"] is True
    # Komoot works the place out from the words whatever point it is handed.
    assert rows["komoot"]["pointApplied"] is False


def test_no_point_means_no_claim_about_one(monkeypatch):
    """A row saying `false` with nothing sent would read as a site refusing."""
    _answers(monkeypatch)
    with http.request_budget("test", calls=http.FILTER_FAN_OUT):
        listing = merged.search(query="montserrat")

    for row in listing.as_dict()["sources"]:
        assert "pointApplied" not in row


def test_a_pair_that_is_not_a_point_is_refused_rather_than_reported_on(monkeypatch):
    """Half a coordinate is a bad question, and it is answered as one.

    It never reaches the reporting at all, which is the right shape: a refusal
    says the point was wrong, where `pointApplied: false` would have said the
    point was fine and a site declined it.
    """
    from api.sources import SourceError

    _answers(monkeypatch)
    with http.request_budget("test", calls=http.FILTER_FAN_OUT):
        with pytest.raises(SourceError) as refused:
            merged.search(query="montserrat", near=(None, None))
    assert refused.value.code == "location"


def test_the_reporter_reads_a_point_the_way_wikiloc_does(monkeypatch):
    """One reader, so the report and the site that acts on it cannot disagree.

    Reporting that the point was applied while the site applying it threw the
    same pair away as unusable is the disagreement this field exists to end.
    """
    assert merged._point_given(ISLAND) is True
    assert merged._point_given(None) is False
    assert merged._point_given((None, None)) is False
    assert merged._point_given((200.0, 0.0)) is False


def test_nearby_says_nothing_about_a_picked_place_because_it_has_none(monkeypatch):
    """The point IS the question on Nearby. There is no pick to report on."""
    _answers(monkeypatch)
    with http.request_budget("test", calls=http.FILTER_FAN_OUT):
        listing = merged.nearby(lat=41.6, lng=1.8, activity="hiking")

    for row in listing.as_dict()["sources"]:
        assert "pointApplied" not in row


def test_the_two_values_are_read_from_the_sites_and_not_written_down_here(monkeypatch):
    """Whether a site can be pointed at a place is a fact about that site.

    It is measured against the site and written beside the code that sends the
    point. A second copy here would be the copy that goes stale.
    """
    assert merged.POINT_APPLIED == {
        "komoot": komoot_discovery.POINT_APPLIED,
        "wikiloc": wikiloc_discovery.POINT_APPLIED,
    }


def test_the_place_wikiloc_used_is_still_wikilocs_and_only_wikilocs(monkeypatch):
    """It agrees with the pick and says nothing at all about the other site.

    This is what made the old sentence look true: `placeUsed` echoes Wikiloc's
    leg, so comparing it against the pick compared the pick against itself.
    """
    _answers(monkeypatch)
    with http.request_budget("test", calls=http.FILTER_FAN_OUT):
        listing = merged.search(query="montserrat", near=ISLAND)

    used = listing.echo["placeUsed"]
    assert (used["lat"], used["lng"]) == ISLAND
    # And the rows prove the halves really are about two different places.
    starts = {row.published_by: row.start for row in listing.rows}
    assert starts["Wikiloc"]["lat"] == pytest.approx(16.73323)
    assert starts["Komoot"]["lat"] == pytest.approx(41.640649)


def test_a_site_that_failed_reports_no_point_either_way(monkeypatch):
    """It contributed no rows, so the point neither reached it nor missed it."""

    def komoot_call(url, timeout=None):
        return 503, {}

    def wikiloc_call(url, timeout=None):
        return 200, PHOTON if "photon" in url else WIKILOC_ANSWER

    monkeypatch.setattr(komoot_discovery, "fetch_json", komoot_call)
    monkeypatch.setattr(wikiloc_discovery, "fetch_json", wikiloc_call)

    with http.request_budget("test", calls=http.FILTER_FAN_OUT):
        listing = merged.search(query="montserrat", near=ISLAND)

    rows = _sources(listing)
    assert rows["komoot"]["ok"] is False
    # The key is still there and still honest: it is what would have happened.
    # What tells a reader to ignore it is `ok`, which the page reads first.
    assert rows["komoot"]["error"] == "network"
    assert rows["wikiloc"]["pointApplied"] is True
