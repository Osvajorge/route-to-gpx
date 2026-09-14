"""What leaving this process costs, and what it writes down.

Three things went untested together, and they are here together because they
are one story: the module that talks to the outside world was silent, it
accepted as much body as a server felt like sending, and the robots.txt rule
it promises to apply at every hop was only ever exercised on a first URL.
"""

import logging

import pytest

from api import http, limits


CHUNK = 64 * 1024


@pytest.fixture(autouse=True)
def _empty_buckets():
    """Every test starts where a fresh process starts: nothing spent."""
    for buckets in (http._clients, http._sites, http._geocoder):
        buckets._levels.clear()
    yield


class _Streamed:
    """An answer that arrives in pieces, like a real one.

    `content` raises rather than returning bytes. That is the whole test for
    the cap: the old shape asked for the entire body first and sliced it
    afterwards, so any code path that still does cannot pass through here.
    """

    status_code = 200
    encoding = "utf-8"
    headers: dict = {}

    def __init__(self, chunks: int):
        self.chunks = chunks
        self.handed_over = 0
        self.closed = False

    @property
    def content(self):
        raise AssertionError("the whole body was buffered before the cap ran")

    def iter_content(self):
        for _ in range(self.chunks):
            self.handed_over += 1
            yield b"x" * CHUNK

    def close(self):
        self.closed = True


def test_a_body_that_never_ends_stops_at_the_cap_instead_of_filling_memory(monkeypatch):
    """The cap has to bound what is RECEIVED, not only what is parsed.

    Measured against a local server that sends chunked blocks and never
    stops: reading it whole accepted 1451.8 MB in a five second window over
    loopback and then failed on timeout, while reading it with the cap in the
    loop stopped at 8.00 MB in 0.02 s.
    """
    # Four times the cap, so a reader that does not stop is obvious.
    answer = _Streamed(chunks=4 * http.MAX_BYTES // CHUNK)
    monkeypatch.setattr(http.requests, "get", lambda url, **_: answer)

    with http.request_budget("one-visitor"):
        status, body = http.fetch_text("https://www.komoot.com/tour/1")

    assert status == 200
    assert len(body) == http.MAX_BYTES
    # One chunk of overshoot is the cost of reading in pieces. More than that
    # means the loop ran on after the limit.
    assert answer.handed_over <= http.MAX_BYTES // CHUNK + 1
    assert answer.closed, "a streamed answer holds its connection open until it is closed"


def test_a_body_that_dies_partway_is_a_failure_and_not_half_a_page(monkeypatch):
    """Reading is part of the call now, so a connection that drops mid-body
    arrives where nothing used to be able to fail."""

    class _Broken(_Streamed):
        def iter_content(self):
            yield b"<html>"
            raise OSError("the connection went away")

    answer = _Broken(chunks=0)
    monkeypatch.setattr(http.requests, "get", lambda url, **_: answer)

    with http.request_budget("one-visitor"):
        assert http.fetch_text("https://www.komoot.com/tour/1") == (0, "")

    assert answer.closed


class _Hop:
    def __init__(self, status, location=None, body=b"{}"):
        self.status_code = status
        self.headers = {"location": location} if location else {}
        self.encoding = "utf-8"
        self.body = body
        self.closed = False

    def iter_content(self):
        yield self.body

    def close(self):
        self.closed = True


def test_a_redirect_onto_a_path_robots_txt_closes_is_refused(monkeypatch):
    """A link on an open path that redirects onto a closed one is the same
    request with an extra step, and the rule has to survive the step.

    The suite tested the closed-path rule on a first URL only. Nothing asked
    what happens when Wikiloc answers an ordinary trail link with
    `Location: /wikiloc/map.do`, which is the shape this service would have no
    business following.
    """
    asked = []

    def fake_get(url, **_):
        asked.append(url)
        if url.endswith("/wikiloc/rutas/a-1"):
            return _Hop(302, "https://www.wikiloc.com/wikiloc/map.do?id=8001213")
        return _Hop(200)

    monkeypatch.setattr(http.requests, "get", fake_get)

    with pytest.raises(http.BlockedHost):
        http._follow("https://www.wikiloc.com/wikiloc/rutas/a-1", 5)

    # The closed page was never asked for.
    assert asked == ["https://www.wikiloc.com/wikiloc/rutas/a-1"]


PRIVATE = ("attacker.example", "secret-cabin", "map.do", "9999", "montseny")


def _wrote(caplog) -> str:
    return "\n".join(record.getMessage() for record in caplog.records)


REFUSED_URLS = [
    "https://wikiloc.com.attacker.example/rutas/secret-cabin",
    "http://www.komoot.com/tour/secret-cabin",
    "https://www.wikiloc.com:9999/wikiloc/rutas/secret-cabin",
    "https://www.wikiloc.com/wikiloc/map.do?id=1",
]


@pytest.mark.parametrize("url", REFUSED_URLS)
def test_a_refusal_is_written_down_and_the_link_is_not(url, caplog):
    """The operator needs to know this service refused something. The page
    tells visitors their links are not written down anywhere, and a log line
    is somewhere, so the reason goes in and the link stays out."""
    with caplog.at_level(logging.DEBUG, logger="api.http"):
        with pytest.raises(http.BlockedHost):
            http.fetch_text(url)

    written = _wrote(caplog)
    assert written, "a refusal that nobody can see is a refusal nobody can count"
    for secret in PRIVATE:
        assert secret not in written


def test_a_call_nothing_is_paying_for_is_loud(caplog):
    """`OutsideRequest` says in its own docstring that both its causes are
    bugs in this service and both should be loud in the log."""
    with caplog.at_level(logging.DEBUG, logger="api.http"):
        with pytest.raises(http.OutsideRequest):
            http.fetch_text("https://www.komoot.com/tour/1")

    loud = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert loud, "nothing paid for that call and nothing said so"
    assert "komoot" in _wrote(caplog)


def test_the_fan_out_ceiling_is_loud_too(caplog):
    with caplog.at_level(logging.DEBUG, logger="api.http"):
        with http.request_budget("one-visitor", calls=0):
            with pytest.raises(http.OutsideRequest):
                http.fetch_text("https://www.komoot.com/tour/1")

    assert [r for r in caplog.records if r.levelno >= logging.ERROR]


def test_an_empty_shared_bucket_is_written_down_with_the_site_that_emptied_it(caplog):
    """Whether SITE_CAPACITY is still the right number is decided by how often
    this line appears, so it has to appear."""
    now = limits.now()
    with limits.LOCK:
        for _ in range(http.SITE_CAPACITY):
            http._sites.spend("komoot", now)

    with caplog.at_level(logging.DEBUG, logger="api.http"):
        with http.request_budget("one-visitor"):
            with pytest.raises(http.BudgetExhausted):
                http.fetch_text("https://www.komoot.com/tour/1")

    written = _wrote(caplog)
    assert "komoot" in written
    assert [r for r in caplog.records if r.levelno >= logging.WARNING]


def test_what_a_source_site_answered_is_written_down(monkeypatch, caplog):
    """A source site that starts answering 403 is the failure this service
    cannot see from the outside, because the page says only 'network'."""
    monkeypatch.setattr(http.requests, "get", lambda url, **_: _Hop(403, body=b"no"))

    with caplog.at_level(logging.DEBUG, logger="api.http"):
        with http.request_budget("one-visitor"):
            status, _ = http.fetch_text("https://www.wikiloc.com/wikiloc/rutas/a-1")

    assert status == 403
    written = _wrote(caplog)
    assert "wikiloc" in written and "403" in written
    assert "rutas" not in written


def test_a_host_that_never_answers_is_written_down_without_curls_message(monkeypatch, caplog):
    """curl puts the URL it was handed into the text of most of its errors,
    and that URL is the visitor's, so only the class of failure is kept."""

    def refuses(url, **_):
        raise ConnectionError(f"failed to connect to {url}")

    monkeypatch.setattr(http.requests, "get", refuses)

    with caplog.at_level(logging.DEBUG, logger="api.http"):
        with http.request_budget("one-visitor"):
            assert http.fetch_text("https://www.komoot.com/tour/secret-cabin") == (0, "")

    written = _wrote(caplog)
    assert "ConnectionError" in written
    assert "secret-cabin" not in written
