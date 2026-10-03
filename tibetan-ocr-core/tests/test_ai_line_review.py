import cv2
import numpy as np
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ai_vision_ocr_server import prepare_line_review_images


def test_red_rubric_crop_excludes_long_frame_and_blank_tail():
    image = np.full((260, 1600, 3), 220, dtype=np.uint8)
    cv2.line(image, (10, 180), (1590, 180), (20, 30, 210), 3)
    cv2.putText(image, 'RED TEXT', (400, 130), cv2.FONT_HERSHEY_SIMPLEX, 1, (20, 30, 210), 3)
    _, encoded = cv2.imencode('.png', image)
    tiles, meta = prepare_line_review_images(encoded.tobytes(),
        {'x': .2, 'y': .33, 'width': .7, 'height': .23})
    assert meta['crop_pixels']['width'] < 400, 'blank space and frame must not become 12 image tiles'
    assert meta['crop_pixels']['y'] + meta['crop_pixels']['height'] < 175
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
