import cv2
import numpy as np
import sys
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ai_vision_ocr_server as ai_vision
from ai_vision_ocr_server import prepare_line_review_images


def test_long_middle_line_removes_red_frame_but_keeps_red_text():
    image = np.full((150, 1800, 3), 235, dtype=np.uint8)
    cv2.line(image, (0, 8), (1799, 10), (25, 40, 210), 4)
    cv2.line(image, (1790, 0), (1790, 149), (25, 40, 210), 4)
    cv2.putText(image, 'RED', (700, 90), cv2.FONT_HERSHEY_SIMPLEX, 1, (25, 40, 210), 3)
    from PIL import Image
    cropped = ai_vision.remove_crop_frame_rules(Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB)))
    rgb = np.asarray(cropped).astype(np.int16)
    assert int(((rgb[5:15, 50:600, 0] - rgb[5:15, 50:600, 1]) > 70).sum()) < 20
    assert int(((rgb[:, -10:, 0] - rgb[:, -10:, 1]) > 70).sum()) < 20
    assert int(((rgb[55:100, 700:800, 0] - rgb[55:100, 700:800, 1]) > 70).sum()) > 40


def test_red_rubric_crop_excludes_long_frame_and_blank_tail():
    image = np.full((260, 1600, 3), 220, dtype=np.uint8)
    cv2.line(image, (10, 180), (1590, 180), (20, 30, 210), 3)
    cv2.putText(image, 'RED TEXT', (400, 130), cv2.FONT_HERSHEY_SIMPLEX, 1, (20, 30, 210), 3)
    _, encoded = cv2.imencode('.png', image)
    tiles, meta = prepare_line_review_images(encoded.tobytes(),
        {'x': .2, 'y': .33, 'width': .7, 'height': .23})
    assert meta['crop_pixels']['width'] < 400, 'blank space and frame must not become 12 image tiles'
    assert meta['crop_pixels']['height'] >= 80, 'vertical padding must preserve Tibetan stacked marks'
    assert meta['crop_pixels']['y'] + meta['crop_pixels']['height'] <= 260
    assert len(tiles) <= 3


def test_line_review_keeps_red_ink_and_upscales_tight_crop_without_downsampling():
    image = np.full((240, 1200, 3), (224, 218, 196), dtype=np.uint8)
    red = (25, 45, 210)
    cv2.putText(image, "RED TEXT", (360, 160), cv2.FONT_HERSHEY_SIMPLEX, 0.72, red, 2)
    ok, encoded = cv2.imencode(".png", image)
    assert ok

    tiles, metadata = prepare_line_review_images(
        encoded.tobytes(),
        {"x": 0.28, "y": 0.48, "width": 0.42, "height": 0.16},
    )

    assert metadata["tile_count"] == len(tiles)
    assert len(tiles) >= 1
    decoded = [cv2.imdecode(np.frombuffer(tile, dtype=np.uint8), cv2.IMREAD_COLOR) for tile in tiles]
    assert all(tile is not None for tile in decoded)
    assert all(tile.shape[0] >= 480 for tile in decoded)
    assert all(tile.shape[1] <= 1600 for tile in decoded)
    # The red channel remains materially stronger than blue/green after the crop
    # and upscale; line review must not silently turn rubric text into grayscale.
    joined = np.concatenate(decoded, axis=1)
    assert int((joined[:, :, 2] > joined[:, :, 1] + 40).sum()) > 100


def test_vertical_side_crop_drops_red_frame_when_dark_text_is_present():
    image = np.full((500, 120, 3), 235, dtype=np.uint8)
    cv2.line(image, (57, 65), (57, 435), (20, 30, 210), 9)
    for y in (115, 190, 265, 340):
        cv2.rectangle(image, (29, y), (33, y + 10), (20, 20, 20), -1)
        cv2.rectangle(image, (30, y - 4), (32, y - 2), (20, 20, 20), -1)
    ok, encoded = cv2.imencode('.png', image)
    assert ok

    _, metadata = prepare_line_review_images(
        encoded.tobytes(), {'x': .16, 'y': .1, 'width': .38, 'height': .8}
    )

    crop = metadata['crop_pixels']
    assert crop['width'] < 35, 'the unrelated red frame must not keep the crop wide'
    assert crop['x'] + crop['width'] < 52, 'the crop must stop before the red frame'
    assert crop['height'] >= 300, 'vertical side inscriptions must keep their full height'


def test_vertical_side_crop_drops_broken_red_frame_segments_without_center_clips():
    image = np.full((500, 120, 3), 235, dtype=np.uint8)
    for top, bottom in ((65, 160), (210, 305), (355, 450)):
        cv2.line(image, (57, top), (57, bottom), (20, 30, 210), 3)
    for y in (115, 190, 265, 340):
        cv2.rectangle(image, (29, y), (33, y + 10), (20, 20, 20), -1)
    ok, encoded = cv2.imencode('.png', image)
    assert ok

    _, metadata = prepare_line_review_images(
        encoded.tobytes(), {'x': .16, 'y': .1, 'width': .38, 'height': .8}
    )

    crop = metadata['crop_pixels']
    assert crop['x'] + crop['width'] < 52, 'broken frame segments must not survive outside a center-column clip'


def test_vertical_side_crop_uses_tight_padding_near_red_frame():
    image = np.full((500, 120, 3), 235, dtype=np.uint8)
    cv2.line(image, (57, 65), (57, 435), (20, 30, 210), 3)
    for y in (115, 190, 265, 340):
        cv2.rectangle(image, (50, y), (54, y + 10), (20, 20, 20), -1)
    ok, encoded = cv2.imencode('.png', image)
    assert ok

    _, metadata = prepare_line_review_images(
        encoded.tobytes(), {'x': .16, 'y': .1, 'width': .38, 'height': .8}
    )

    crop = metadata['crop_pixels']
    assert crop['x'] + crop['width'] < 57, 'padding must not pull a nearby red frame into the side-text crop'


def test_vertical_side_crop_drops_pale_red_frame_below_rubric_threshold():
    image = np.full((500, 120, 3), 235, dtype=np.uint8)
    cv2.line(image, (57, 65), (57, 435), (60, 60, 100), 3)
    for y in (115, 190, 265, 340):
        cv2.rectangle(image, (29, y), (33, y + 10), (20, 20, 20), -1)
    ok, encoded = cv2.imencode('.png', image)
    assert ok

    _, metadata = prepare_line_review_images(
        encoded.tobytes(), {'x': .16, 'y': .1, 'width': .38, 'height': .8}
    )

    crop = metadata['crop_pixels']
    assert crop['width'] < 35, 'pale frame ink must not widen a side-text crop'
    assert crop['x'] + crop['width'] < 57, 'the crop must stop before a pale red frame'


def test_legacy_multiline_bbox_is_narrowed_to_nearest_physical_row():
    image = np.full((400, 900, 3), 245, dtype=np.uint8)
    cv2.line(image, (20, 70), (880, 70), (60, 90, 205), 3)
    for y in (100, 132):
        for x in range(150, 760, 32):
            cv2.rectangle(image, (x, y), (x + 9, y + 24), (20, 20, 20), -1)
    ok, encoded = cv2.imencode('.png', image)
    assert ok
    center = {'id': 'center', 'x': 0.0, 'y': 0.0, 'width': 1.0, 'height': 1.0}
    # This saved bbox spans both physical rows and already has broad clip bounds.
    bbox = {'x': .1, 'y': .3, 'width': .8, 'height': .2,
            'clip_top': .05, 'clip_bottom': .8}

    with patch.object(ai_vision, 'detect_traditional_column_bboxes', return_value=[center]):
        bounded = ai_vision.bound_legacy_line_crop(encoded.tobytes(), bbox)
        _, metadata = prepare_line_review_images(encoded.tobytes(), bbox)

    assert bounded['physical_row_index'] == 1, 'a block centered on row two must select row two'
    assert bounded['physical_row_count'] == 2, 'the two rows must remain separate'
    crop = metadata['crop_pixels']
    assert crop['y'] > 90, 'the horizontal page rule must remain above the selected physical row'
    assert crop['height'] < 50, 'the crop must exclude the neighboring printed row'


def test_center_row_crop_keeps_detached_top_and_bottom_strokes():
    image = np.full((200, 800, 3), 245, dtype=np.uint8)
    # Simulate Tibetan top and bottom marks detached from the OCR detector's
    # central body box; the row clip safely separates this from adjacent rows.
    cv2.rectangle(image, (180, 70), (620, 77), (20, 20, 20), -1)
    cv2.rectangle(image, (180, 96), (620, 116), (20, 20, 20), -1)
    cv2.rectangle(image, (180, 145), (620, 153), (20, 20, 20), -1)
    ok, encoded = cv2.imencode('.png', image)
    assert ok
    center = {'id': 'center', 'x': 0.0, 'y': 0.0, 'width': 1.0, 'height': 1.0}
    detected_row = {'x': .2, 'y': .32, 'width': .6, 'height': .46}

    with patch.object(ai_vision, 'detect_traditional_column_bboxes', return_value=[center]), \
         patch.object(ai_vision, 'detect_physical_text_line_bboxes', return_value=[detected_row]):
        _, metadata = prepare_line_review_images(
            encoded.tobytes(), {'x': .2, 'y': .48, 'width': .6, 'height': .1}
        )

    crop = metadata['crop_pixels']
    assert crop['y'] - metadata['padding_pixels'] <= 50, 'the crop must leave visible margin above detached top marks'
    assert crop['y'] + crop['height'] + metadata['padding_pixels'] >= 174, 'the crop must leave visible margin below detached lower marks'


def test_stale_preview_metadata_drops_old_vertical_clip_limits():
    bbox = {'x': .2, 'y': .4, 'width': .6, 'height': .1}
    metadata = {
        'crop_version': 12,
        'source_size': {'width': 800, 'height': 200},
        'source_bbox': {**bbox, 'clip_top': .48, 'clip_bottom': .51, 'crop_pad_y': .01},
    }
    resolved = ai_vision.resolve_line_preview_bbox(bbox, metadata, metadata['source_size'])
    assert 'clip_top' not in resolved
    assert 'clip_bottom' not in resolved
    assert 'crop_pad_y' not in resolved
    assert resolved['y'] == bbox['y'] and resolved['height'] == bbox['height']
