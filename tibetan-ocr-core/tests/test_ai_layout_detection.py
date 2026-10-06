import cv2
import numpy as np
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ai_vision_ocr_server import (
    _red_vertical_rule_candidates,
    _select_traditional_boundaries,
    detect_text_line_bboxes,
    detect_traditional_column_bboxes,
)
from bdrc_ocr_server import (
    is_red_dominant_ink,
    is_meaningful_ocr_line,
    map_local_bbox_to_page,
    merge_nearby_line_bboxes,
    normalize_sparse_page_number,
)


def test_horizontal_rules_do_not_create_text_blocks():
    image = np.full((240, 800, 3), 220, dtype=np.uint8)
    for y in (8, 232):
        cv2.line(image, (10, y), (790, y), (0, 0, 200), 2)
    for y in (90, 120, 160):
        for x in range(160, 650, 28):
            cv2.rectangle(image, (x, y), (x + 12, y + 12), (20, 20, 20), -1)

    encoded_ok, encoded = cv2.imencode(".png", image)
    assert encoded_ok
    boxes = detect_text_line_bboxes(encoded.tobytes())

    assert len(boxes) == 3
    assert all(0.25 < box["y"] < 0.8 for box in boxes)


def test_vertical_frame_rules_do_not_widen_text_line_boxes():
    image = np.full((280, 1000, 3), 224, dtype=np.uint8)
    red = (0, 80, 180)
    cv2.line(image, (55, 30), (55, 250), red, 3)
    cv2.line(image, (945, 30), (945, 250), red, 3)
    for y in (85, 145, 205):
        cv2.putText(image, "TIBETAN", (230, y), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (20, 20, 20), 2)

    encoded_ok, encoded = cv2.imencode(".png", image)
    assert encoded_ok
    boxes = detect_text_line_bboxes(encoded.tobytes())

    assert len(boxes) == 3
    assert all(box["width"] < 0.7 for box in boxes)


def test_nearby_projection_bands_merge_into_one_traditional_text_line():
    boxes = [
        {"x": 0.05, "y": 0.05, "width": 0.8, "height": 0.28},
        {"x": 0.10, "y": 0.39, "width": 0.7, "height": 0.04},
        {"x": 0.08, "y": 0.44, "width": 0.72, "height": 0.22},
        {"x": 0.42, "y": 0.80, "width": 0.32, "height": 0.10},
    ]

    merged = merge_nearby_line_bboxes(boxes, max_gap=0.02)

    assert len(merged) == 3
    assert merged[1] == {"x": 0.08, "y": 0.39, "width": 0.72, "height": 0.27}


def test_red_dominant_line_is_not_labeled_with_unreliable_black_ocr():
    red_line = np.full((100, 600, 3), 224, dtype=np.uint8)
    black_line = red_line.copy()
    cv2.putText(red_line, "TEXT", (80, 70), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (0, 80, 180), 3)
    cv2.putText(black_line, "TEXT", (80, 70), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (20, 20, 20), 3)

    assert is_red_dominant_ink(red_line)
    assert not is_red_dominant_ink(black_line)


def test_traditional_frame_returns_left_center_right_columns():
    image = np.full((320, 1600, 3), 224, dtype=np.uint8)
    red = (0, 80, 180)
    # Two narrow side strips and a wide center strip, matching the pecha frame.
    for x in (150, 190, 1430, 1465):
        cv2.line(image, (x, 65), (x, 288), red, 3)
    for y in (65, 288):
        cv2.line(image, (150, y), (1465, y), red, 3)
    for y in (95, 130, 165, 200, 235):
        cv2.putText(image, "TIBETAN", (230, y), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (20, 20, 20), 1)

    encoded_ok, encoded = cv2.imencode(".png", image)
    assert encoded_ok
    regions = detect_traditional_column_bboxes(encoded.tobytes())

    assert [region["id"] for region in regions] == ["left", "center", "right"]
    assert regions[0]["x"] < regions[1]["x"] < regions[2]["x"]
    assert regions[1]["width"] > regions[0]["width"] * 5
    assert regions[0]["role"] == "side"
    assert regions[0]["direction"] == "vertical"
    assert regions[1]["role"] == "body"
    assert regions[1]["direction"] == "horizontal"


def test_red_vertical_rule_candidates_detect_faint_slanted_frame_rules():
    """High-resolution scanned frames retain red rules after gray edges fade."""
    red_ink = np.zeros((900, 4600), dtype=bool)
    for start_x, end_x in ((280, 315), (860, 895), (3600, 3640), (4210, 4250)):
        cv2.line(red_ink.view(np.uint8), (start_x, 40), (end_x, 860), 1, 9)

    candidates = _red_vertical_rule_candidates(red_ink, 0, red_ink.shape[0])
    positions = sorted(position for position, _score in candidates)

    assert len(positions) >= 2
    assert any(abs(position - 3620) < 55 for position in positions)
    assert any(abs(position - 4230) < 55 for position in positions)


def test_traditional_boundary_selection_skips_red_title_glyph_candidates():
    """The wide middle column may contain red title glyphs between its rules."""
    clusters = [
        (905.0, 761.0),
        (1281.0, 621.0),
        (1977.0, 748.0),
        (2380.0, 747.0),
        (4923.0, 423.0),
        (6451.0, 587.0),
        (10875.0, 803.0),
        (11295.0, 613.0),
        (12072.0, 683.0),
        (12498.0, 713.0),
    ]

    assert _select_traditional_boundaries(clusters, 14223) == [905.0, 2380.0, 10875.0, 12498.0]


def test_scanned_title_page_returns_three_regions_instead_of_full_page_fallback():
    fixture = Path(__file__).resolve().parents[2] / "tmp/pdfs/tibetan-20261001/page-01.png"
    if not fixture.exists():
        return
    regions = detect_traditional_column_bboxes(fixture.read_bytes())

    assert [region["id"] for region in regions] == ["left", "center", "right"]
    assert regions[1]["width"] > regions[0]["width"] * 4
    assert regions[1]["width"] > regions[2]["width"] * 3


def test_traditional_region_drops_border_punctuation_but_keeps_tibetan_lines():
    assert not is_meaningful_ocr_line("་་")
    assert not is_meaningful_ocr_line("།")
    assert is_meaningful_ocr_line("གུ་རུ་གཏེར་སྟོན")
    assert normalize_sparse_page_number("7\\n1\\n1-689") == "1-689"


def test_region_line_bbox_maps_back_to_full_page_coordinates():
    mapped = map_local_bbox_to_page(
        {"x": 0.2, "y": 0.25, "width": 0.5, "height": 0.2},
        (100, 200, 800, 400),
        (1000, 1000),
    )
    assert mapped == {"x": 0.26, "y": 0.3, "width": 0.4, "height": 0.08}
