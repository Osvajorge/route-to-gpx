"""What the service owes every caller, whatever they ask for.

Two guards live above the endpoints rather than inside them: answers go out
compressed, and every request that this process does work for spends an inbound
token. Both were green in the suite while neither was true.
"""

import pytest
from fastapi.testclient import TestClient

from api import app as service
from api.sources import Route, shape as shapes

client = TestClient(service.app)


@pytest.fixture(autouse=True)
def _fresh_process():
    """Every test starts where a fresh process starts: nothing spent, nothing
    remembered."""
    service._inbound._levels.clear()
    service._shapes = shapes.Shapes()
    yield


def _route(url: str, points: int = 200) -> Route:
    return Route(
        source_id="wikiloc",
        source_label="Wikiloc",
        title="Sant Llorenc",
        url=url,
        points=[(41.6 + index / 1000.0, 1.7 + index / 1000.0, 600.0 + index) for index in range(points)],
        file_stem="sant-llorenc",
    )


def _one_source(monkeypatch, asked: list):
    """Stands in for every source site, and remembers how often it was asked."""

    def fetch(url):
        asked.append(url)
        return _route(url)

    monkeypatch.setattr(service, "adapter_for", lambda url: fetch)


# --- compression -------------------------------------------------------------


def test_a_track_leaves_compressed(monkeypatch):
    """A convert is the biggest thing this service sends, and it was going out
    as plain XML inside plain JSON."""
    _one_source(monkeypatch, [])
    response = client.post("/api/convert", json={"url": "https://www.wikiloc.com/t/1"})

    assert response.status_code == 200
    assert response.headers["content-encoding"] == "gzip"
    assert response.headers["vary"] == "Accept-Encoding"
    # httpx hands back the decoded body, so the header is what went over the
    # wire and the length of the content is what the caller would have paid
    # without this.
    assert int(response.headers["content-length"]) < len(response.content) / 2


def test_the_page_and_its_assets_leave_compressed():
    for path in ("/", "/assets/app.js", "/assets/app.css"):
        response = client.get(path)
        assert response.status_code == 200, path
        assert response.headers["content-encoding"] == "gzip", path


def test_a_caller_that_cannot_read_gzip_still_gets_the_file():
    plain = client.get("/assets/app.js", headers={"Accept-Encoding": "identity"})

    assert plain.status_code == 200
    assert "content-encoding" not in plain.headers
    # Announced, so a shared cache cannot hand this body to a caller that asked
    # for the compressed one.
    assert plain.headers["vary"] == "Accept-Encoding"


def test_an_answer_too_small_to_help_is_sent_as_it_is():
    """Compressing the liveness answer grows it from 11 bytes to 31."""
    response = client.get("/api/health")

    assert response.status_code == 200
    assert "content-encoding" not in response.headers


def test_a_cross_origin_header_survives_the_compression(monkeypatch):
    """Gzip sits underneath CORS, so the header is still on the answer."""
    _one_source(monkeypatch, [])
    response = client.post(
        "/api/convert",
        json={"url": "https://www.wikiloc.com/t/1"},
        headers={"Origin": "https://example.test"},
    )

    assert response.headers["access-control-allow-origin"] == "*"


# --- the inbound ceiling -----------------------------------------------------


def test_a_cached_outline_still_spends_an_inbound_token(monkeypatch):
    """The cache used to answer above the guard, which left this endpoint with
    no ceiling: one known URL could be asked for as fast as the socket allowed,
    while convert, search, nearby and sports were all bounded."""
    _one_source(monkeypatch, [])
    url = "https://www.wikiloc.com/hiking-trails/one-8001213"

    for number in range(service.INBOUND_MAX_REQUESTS):
        assert client.post("/api/shape", json={"url": url}).status_code == 200, number

    refused = client.post("/api/shape", json={"url": url})
    body = refused.json()
    assert refused.status_code == 429
    assert body["error"] == "busy"
    assert body["hint"] == "self"
    assert int(refused.headers["Retry-After"]) >= 1


def test_a_second_look_at_one_outline_asks_the_source_site_once(monkeypatch):
    """The reason the cache exists, and the reason the fix above had to leave it
    where it was: a trail page is 354 KB, and a reader scrolling back up a list
    must not cost Wikiloc a second one."""
    asked: list = []
    _one_source(monkeypatch, asked)
    url = "https://www.wikiloc.com/hiking-trails/one-8001213"

    first = client.post("/api/shape", json={"url": url}).json()
    second = client.post("/api/shape", json={"url": url}).json()

    assert first["trace"] == second["trace"]
    assert asked == [url]
