"""The GPX writer, checked with a parser instead of with a substring.

A title arrives from a remote site, so it carries whatever a stranger typed.
The question that matters is not whether one helper escaped one character: it
is whether the file we hand out parses at all.
"""

import xml.etree.ElementTree as ET

import pytest

from api import app as service
from api.core import gpx
from api.sources import Route

# A backspace, a null, a vertical tab, markup, both noncharacters at the top of
# the first plane, and a unit separator.
HOSTILE_TITLE = "Vall de N\x08\x00ria \x0b<tag> & ￾￿ \x1f"

POINTS = [(42.5, 0.7, 1456.5), (42.6, 0.71, 1500.0)]


def _names(document):
    return [node.text for node in ET.fromstring(document).iter() if node.tag.endswith("}name")]


def test_a_title_from_a_remote_site_cannot_stop_the_file_from_parsing():
    tree = ET.fromstring(gpx.build(POINTS, name=HOSTILE_TITLE))
    assert tree.tag.endswith("}gpx")


def test_the_whole_endpoint_payload_parses_when_the_title_is_hostile():
    """End to end: a route shaped the way the app shapes one, read back as XML.

    A test of the escape helper alone passes while this defect is live, which
    is how it stayed live.
    """
    route = Route(
        source_id="wikiloc",
        source_label="Wikiloc",
        title=HOSTILE_TITLE,
        url="https://www.wikiloc.com/trail-1",
        points=list(POINTS),
    )
    document = service.as_payload(route)["gpx"]
    assert document.encode("utf-8")
    assert _names(document) == ["Vall de Nria <tag> &"] * 2


def test_the_characters_xml_forbids_are_dropped_rather_than_escaped():
    """XML 1.0 gives no way to write these, not even as a numeric reference."""
    document = gpx.build(POINTS, name="a\x08b\x00c\x0bd\x1fe")
    assert _names(document) == ["abcde", "abcde"]
    assert "&#8;" not in document


def test_the_two_noncharacters_at_the_top_of_the_first_plane_are_dropped():
    document = gpx.build(POINTS, name="north￾￿ridge")
    assert _names(document) == ["northridge", "northridge"]


def test_a_lone_surrogate_never_reaches_the_bytes_we_hand_out():
    """Half a pair cannot be encoded as UTF-8, so the download itself fails."""
    document = gpx.build(POINTS, name="ridge\ud800run")
    assert document.encode("utf-8")
    assert _names(document) == ["ridgerun", "ridgerun"]


def test_a_newline_in_a_title_becomes_a_space_instead_of_a_second_line():
    document = gpx.build(POINTS, name="Pedraforca\nnorth face\tridge")
    assert _names(document) == ["Pedraforca north face ridge"] * 2


def test_a_carriage_return_in_a_link_stays_out_of_the_attribute():
    """A parser turns it into a space inside an attribute value anyway, so the
    URL silently changes on the way in. Doing it here keeps what the file says
    and what the writer meant to say the same string."""
    document = gpx.build(
        POINTS,
        name="Route",
        source_url="https://example.org/a\rb",
        source_label="Example",
    )
    assert '<link href="https://example.org/a b">' in document
    ET.fromstring(document)


def test_a_title_of_nothing_but_forbidden_characters_still_names_the_route():
    document = gpx.build(POINTS, name="\x08\x00\x1f")
    assert _names(document) == ["Route", "Route"]


def test_the_markup_characters_are_still_escaped_after_the_cleaning():
    document = gpx.build(POINTS, name='Coll de "A" & <B>')
    assert _names(document) == ['Coll de "A" & <B>'] * 2


@pytest.mark.parametrize("code", [0x20, 0xD7FF, 0xE000, 0xFFFD, 0x10000, 0x10FFFF])
def test_each_edge_of_the_char_rule_is_kept(code):
    assert gpx._is_xml_character(code)


@pytest.mark.parametrize("code", [0x00, 0x08, 0x0B, 0x0C, 0x1F, 0xD800, 0xDFFF, 0xFFFE, 0xFFFF])
def test_each_edge_outside_the_char_rule_is_refused(code):
    assert not gpx._is_xml_character(code)
