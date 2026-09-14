"""The allowlist, tested by what it must REFUSE.

Every assertion the suite made about `ALLOWED_HOST` was a match. A table of
matches cannot fail on a pattern that matches too much, and that was the
defect: each branch ended `komoot\\.[a-z.]+$`, `[a-z.]+` matches dots, and so
`wikiloc.com.attacker.example` was on the allowlist. `/api/convert` fetched
whatever that name resolved to, from the deployment's own address, which is
the open proxy `http.py` opens by saying it prevents.

The hole was invisible twice over. Deleting the `_check(url)` call from the
top of `fetch_text` left all 105 tests passing, and so did letting the scheme
be plain http. Both halves of the table below are therefore in ONE list: a
host that is allowed and a host that is refused are the same claim about the
same pattern, and splitting them is how they drift.
"""

import pytest

from api import http


ALLOWED_HOSTS = [
    "www.komoot.com",
    "www.komoot.de",
    "www.komoot.es",
    "komoot.com",
    "photon.komoot.io",
    "tourpic-vector.maps.komoot.net",
    "www.wikiloc.com",
    "wikiloc.com",
    "www.alltrails.com",
]

REFUSED_HOSTS = [
    # The defect: an unbounded tail let any registrable name carry an allowed
    # label in front of it.
    "wikiloc.com.attacker.example",
    "komoot.com.evil.example",
    "alltrails.com.evil.example",
    "www.komoot.com.evil.example",
    # `.co` is a real TLD, so `komoot.com.co` is a name somebody can buy. A
    # rule that bounded the tail at two labels would still have allowed it.
    "komoot.com.co",
    "wikiloc.com.co",
    # A name that merely contains the word.
    "notkomoot.com",
    "komootcom",
    "fakewikiloc.com",
    # Nothing to do with either site.
    "evil.example",
    "localhost",
    "127.0.0.1",
    "169.254.169.254",
    "[::1]",
]


@pytest.mark.parametrize("host", ALLOWED_HOSTS)
def test_a_host_this_service_reads_is_allowed(host):
    assert http.ALLOWED_HOST.match(host), f"{host} should be allowed"


@pytest.mark.parametrize("host", REFUSED_HOSTS)
def test_a_host_this_service_does_not_read_is_refused(host):
    assert not http.ALLOWED_HOST.match(host), f"{host} should be refused"


@pytest.mark.parametrize("host", REFUSED_HOSTS)
def test_a_refused_host_names_no_budget(host):
    """A host off the allowlist must not spend a source site's allowance.

    `SITE` was looser than `ALLOWED_HOST` and keyed on the same unbounded
    tail, so a lookalike was charged to the real site's bucket: an attacker
    could empty Wikiloc's shared allowance for every visitor.
    """
    assert http._site(f"https://{host}/x") == "other"


REFUSED_URLS = [
    # The lookalike, through the check the request actually passes through.
    "https://wikiloc.com.attacker.example/rutas/a-1",
    "https://komoot.com.evil.example/tour/1",
    # Scheme. Plain http is how a metadata endpoint answers.
    "http://www.komoot.com/tour/1",
    "file:///etc/passwd",
    "ftp://www.komoot.com/tour/1",
    # Port. An allowed name pointed at another port is another service.
    "https://www.wikiloc.com:9999/wikiloc/rutas/a-1",
    "https://www.komoot.com:22/tour/1",
    # robots.txt closed paths, and the two shapes that walked past the
    # prefix check when it compared the path raw.
    "https://www.wikiloc.com/wikiloc/map.do?id=1",
    "https://www.wikiloc.com/wikiloc/%6Dap.do?id=1",
    "https://www.wikiloc.com/wikiloc/%256Dap.do?id=1",
    "https://www.wikiloc.com/x/../wikiloc/map.do",
    "https://www.wikiloc.com/./wikiloc/geocode.do",
    "https://www.alltrails.com/api/x",
    "https://www.alltrails.com/members/someone",
    "https://www.alltrails.com/explore/map/x",
]


@pytest.mark.parametrize("url", REFUSED_URLS)
def test_check_refuses_the_url(url):
    with pytest.raises(http.BlockedHost):
        http._check(url)


READABLE_URLS = [
    "https://www.komoot.com/tour/1",
    "https://www.wikiloc.com/wikiloc/rutas/a-1",
    "https://www.wikiloc.com:443/wikiloc/rutas/a-1",
    "https://photon.komoot.io/api/?q=Montserrat",
    "https://www.alltrails.com/trail/spain/barcelona/x",
]


@pytest.mark.parametrize("url", READABLE_URLS)
def test_check_allows_the_url(url):
    http._check(url)


def test_a_redirect_onto_a_lookalike_is_refused():
    """The per-hop guard is only as good as the pattern it calls.

    While the tail was unbounded, a source site answering with
    `Location: https://komoot.com.evil.example/x` was followed, so the
    re-check at every hop refused nothing.
    """
    with pytest.raises(http.BlockedHost):
        http._check("https://komoot.com.evil.example/collect")


@pytest.mark.parametrize("url", REFUSED_URLS)
def test_fetch_text_refuses_before_it_reaches_the_network(url):
    """The call site, not just the function.

    Every test above exercises `_check` directly, and that is not the same
    claim. Removing the `_check(url)` line from the top of `fetch_text` left
    the whole suite green, because nothing asserted the two were connected.
    This does. It needs no budget and no monkeypatching: the refusal happens
    before a token is spent and long before anything is sent.
    """
    with pytest.raises(http.BlockedHost):
        http.fetch_text(url)
