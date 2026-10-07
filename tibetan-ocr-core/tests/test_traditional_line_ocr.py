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

    def test_bad_frame_does_not_fall_back_to_whole_page(self):
        with patch.object(server, 'detect_traditional_column_bboxes', return_value=[]), \
             patch.object(server, 'call_model_aggregator') as model:
            with self.assertRaisesRegex(RuntimeError, '定位失败'):
                server.call_vision_model(b'irrelevant', 'sample.png', '', 'traditional')
            model.assert_not_called()


if __name__ == '__main__':
    unittest.main()
