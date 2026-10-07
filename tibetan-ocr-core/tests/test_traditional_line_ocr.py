"""Run with python3; no external model calls."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from io import BytesIO
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ai_vision_ocr_server as server


class TraditionalLineTests(unittest.TestCase):
    def test_main_ocr_uses_independent_row_images_and_continues_after_failure(self):
        output = BytesIO()
        Image.new('RGB', (1200, 400), 'white').save(output, format='PNG')
        image = output.getvalue()
        region = {'id': 'center', 'label': '中间', 'direction': 'horizontal',
                  'x': .1, 'y': .1, 'width': .8, 'height': .8}
        boxes = [{'x': .1, 'y': .1, 'width': .8, 'height': .1},
                 {'x': .1, 'y': .5, 'width': .8, 'height': .1}]
        requests = []

        def recognize(images, prompt, **kwargs):
            requests.append(images)
            assert '草稿' not in prompt
            for content, _ in images:
                with Image.open(BytesIO(content)) as crop:
                    self.assertGreaterEqual(crop.height, 160)
                    self.assertLessEqual(crop.height, 640)
                    self.assertLessEqual(crop.width, 1500)
            if len(requests) == 1:
                raise RuntimeError('sample failure')
            return {'text': 'བོད།', 'model': server.MODEL}

        with patch.object(server, 'detect_text_line_bboxes', return_value=boxes), \
             patch.object(server, 'USE_MODEL_AGGREGATOR', True), \
             patch.object(server, 'call_model_aggregator_images', side_effect=recognize):
            result = server.call_traditional_region_ocr(image, 'sample.png', '', [region])
        self.assertEqual(len(requests), 2)
        self.assertTrue(result['lines'][0]['error'])
        self.assertEqual(result['lines'][1]['text'], 'བོད།')
        metadata = result['lines'][1]['review_image']
        self.assertEqual(metadata['source_size']['width'], 1200)
        self.assertLess(metadata['crop_pixels']['height'], 150)
        bbox = result['lines'][1]['bbox']
        self.assertEqual(bbox['x'], metadata['crop_pixels']['x'] / 1200)
        self.assertEqual(bbox['height'], metadata['crop_pixels']['height'] / 400)

    def test_tiling_cuts_at_whitespace_instead_of_through_a_glyph(self):
        from PIL import ImageDraw
        image = Image.new('RGB', (2200, 160), 'white')
        draw = ImageDraw.Draw(image)
        draw.rectangle((1470, 20, 1530, 140), fill='black')
        tiles, ranges = server.split_enlarged_line(image, 1500)
        self.assertLess(ranges[0][1], 1470)
        self.assertEqual(ranges[-1][1], image.width)
        self.assertEqual(ranges[0][1], ranges[1][0])
        self.assertEqual(len(tiles), 2)

    def test_legacy_crops_exclude_neighbours_and_preserve_detached_marks(self):
        from PIL import ImageDraw
        image = Image.new('RGB', (800, 300), 'white')
        draw = ImageDraw.Draw(image)
        # Three close rows with detached upper marks and lower stacks.
        for top, colour in [(70, 'black'), (120, 'black'), (170, 'red')]:
            for x in range(200, 550, 35):
                draw.rectangle((x, top + 8, x + 12, top + 24), fill=colour)
                draw.rectangle((x + 3, top, x + 9, top + 3), fill=colour)
                draw.rectangle((x + 4, top + 26, x + 8, top + 30), fill=colour)
        output = BytesIO(); image.save(output, format='PNG'); content = output.getvalue()
        center = {'id': 'center', 'x': .1, 'y': .1, 'width': .8, 'height': .8}
        local = [{'x': .15, 'y': (top - 30) / 240, 'width': .6, 'height': 31 / 240}
                 for top in (70, 120, 170)]
        with patch.object(server, 'detect_traditional_column_bboxes', return_value=[center]), \
             patch.object(server, 'detect_text_line_bboxes', return_value=local):
            for top in (70, 120, 170):
                # Old boxes have no clip metadata; generous padding would mix rows.
                bbox = {'x': .25, 'y': top / 300, 'width': .45, 'height': 31 / 300}
                _, metadata = server.prepare_line_review_images(content, bbox)
                pixels = metadata['crop_pixels']
                self.assertLessEqual(pixels['y'], top)
                self.assertGreaterEqual(pixels['y'] + pixels['height'], top + 31)
                self.assertGreater(pixels['y'], top - 20)
                self.assertLess(pixels['y'] + pixels['height'], top + 50)
                self.assertEqual(metadata['crop_version'], server.LINE_CROP_VERSION)

    def test_vertical_side_crop_is_not_treated_as_body_row(self):
        bbox = {'x': .8, 'y': .4, 'width': .01, 'height': .2}
        with patch.object(server, 'detect_traditional_column_bboxes') as detector:
            self.assertEqual(server.bound_legacy_line_crop(b'no image needed', bbox), bbox)
            detector.assert_not_called()

    def test_bad_frame_does_not_fall_back_to_whole_page(self):
        with patch.object(server, 'detect_traditional_column_bboxes', return_value=[]), \
             patch.object(server, 'call_model_aggregator') as model:
            with self.assertRaisesRegex(RuntimeError, '定位失败'):
                server.call_vision_model(b'irrelevant', 'sample.png', '', 'traditional')
            model.assert_not_called()


if __name__ == '__main__':
    unittest.main()
