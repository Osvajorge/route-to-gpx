"""Regressions for three defects an adversarial review found.

Each of these passed review as "working" before it was measured. They are here
because the suite was green while all three were live.
"""

import pytest

from api import http, limits
from api.sources import komoot_discovery


def test_a_number_past_the_float_ceiling_clamps_instead_of_crashing():
    """Python integers have no ceiling, floats do, and `float()` raises.

    Reached from five request fields. It answered 500 as text/plain, which is
    the one shape the service promises never to return.
    """
    for enormous in (10**309, -(10**309), 10**400):
        assert komoot_discovery._finite(enormous) is None
        assert komoot_discovery._clamp(enormous, 1, 25, 10) == 10

    # The ordinary "a lot" still clamps, as the docstring promises.
    assert komoot_discovery._clamp(10**308, 1, 25, 10) == 25
    assert komoot_discovery._clamp(1000, 1, 25, 10) == 25
    assert komoot_discovery._clamp(-5, 1, 25, 10) == 1


class _Response:
    def __init__(self, status, location=None):
        self.status_code = status
        self.headers = {"location": location} if location else {}
        self.content = b"{}"
        self.encoding = "utf-8"


def test_a_redirect_off_the_allowlist_is_refused(monkeypatch):
    """Following redirects blindly checks only the first URL.

    A source site that redirected off its own domain would take this service
    with it, which is the open proxy the allowlist exists to prevent.
    """
    hops = []

    def fake_get(url, **_):
        hops.append(url)
        if "komoot" in url:
            return _Response(302, "https://evil.example.org/collect")
        return _Response(200)

    monkeypatch.setattr(http.requests, "get", fake_get)

    with pytest.raises(http.BlockedHost):
        http._follow("https://www.komoot.com/tour/1", 5)

    # The foreign host was never asked for anything.
    assert hops == ["https://www.komoot.com/tour/1"]


def test_a_redirect_inside_the_allowlist_is_followed(monkeypatch):
    """Wikiloc answers a trail link with a redirect to its canonical slug, so
    refusing every redirect would refuse ordinary links."""
    hops = []

    def fake_get(url, **_):
        hops.append(url)
        if url.endswith("/short"):
            return _Response(301, "https://www.wikiloc.com/hiking-trails/real-8001213")
        return _Response(200)

    monkeypatch.setattr(http.requests, "get", fake_get)
    response = http._follow("https://www.wikiloc.com/short", 5)

    assert response.status_code == 200
    assert len(hops) == 2


def test_a_redirect_loop_stops(monkeypatch):
    monkeypatch.setattr(
        http.requests,
        "get",
        lambda url, **_: _Response(302, "https://www.komoot.com/tour/2"),
    )
    with pytest.raises(http.BlockedHost):
        http._follow("https://www.komoot.com/tour/1", 5)


def test_the_bucket_sweep_is_amortised_and_still_bounded():
    """Sweeping on every new key is a pass over the whole dictionary while
    holding the lock the whole service shares. Somebody rotating addresses
    would make every other request wait behind it."""
    buckets = limits.Buckets(
        capacity=1,
        refill_per_second=1,
        sweep_above=8,
        keep_at_most=16,
        sweep_every=8,
    )
    swept = []
    original = buckets._evict
    buckets._evict = lambda now: (swept.append(len(buckets._levels)), original(now))[1]

    clock = 0.0
    for i in range(400):
        buckets.wait(f"client-{i}", clock)
        buckets.spend(f"client-{i}", clock)
        clock += 0.001

    # Bounded memory, which was never the doubt. The cap carries a sweep's
    # worth of slack, because enforcing it exactly is what made every insertion
    # pay for a full pass.
    assert len(buckets._levels) <= buckets.keep_at_most + buckets.sweep_every
    # And bounded work: nowhere near one sweep per insertion.
    assert len(swept) < 400 / 4, f"{len(swept)} sweeps for 400 keys"


def test_nearby_never_asks_for_a_page_size_that_repeats_rows():
    """Nearby pages correctly at 6 and no higher.

    Above that the upstream silently answers page 0 again, so `load more` would
    show the visitor the same routes with nothing in the response admitting it.
    Measured live: limit 9 page 1 returned all nine rows of page 0.
    """
    assert komoot_discovery.NEARBY_LIMIT_MAX == 6
    # Whatever is asked for, what goes upstream paginates.
    for asked in (1, 6, 9, 12, 25, 1000):
        assert komoot_discovery._clamp(
            asked, 1, komoot_discovery.NEARBY_LIMIT_MAX, komoot_discovery.NEARBY_LIMIT_MAX
        ) <= 6

    # Search has no such limit, and must not inherit one.
    assert komoot_discovery.LIMIT_MAX > komoot_discovery.NEARBY_LIMIT_MAX
