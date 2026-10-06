import sys
from pathlib import Path
from unittest.mock import patch
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ai_vision_ocr_server as server


class ProviderReviewTests(unittest.TestCase):
    def test_qwen_preserves_selected_model_and_crop(self):
        raw = {'model': 'qwen3.7-plus', 'choices': [{'finish_reason': 'stop', 'message': {'content': 'བོད་'}}]}
        with patch.object(server, 'QWEN_REVIEW_API_KEY', 'test-only'), patch.object(server, 'QWEN_REVIEW_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1'), patch.object(server, 'prepare_line_review_images', return_value=([b'png'], {'crop': 'tight'})), patch.object(server, 'post_json', return_value=raw) as request:
            result = server.call_qwen_line_review(b'page', 'page.png', {'x': .1}, 'qwen3.7-plus')
            url, body, key = request.call_args.args
            self.assertTrue(url.endswith('/chat/completions'))
            self.assertEqual(body['model'], 'qwen3.7-plus')
            self.assertFalse(body['enable_thinking'])
            self.assertEqual(body['messages'][0]['content'][1]['max_pixels'], 8388608)
            self.assertEqual(result['provider'], 'qwen')
            self.assertEqual(result['review_image']['crop'], 'tight')
            self.assertEqual(result['text'], 'བོད་')

    def test_qwen_missing_key_bad_model_or_host_never_sends(self):
        with patch.object(server, 'post_json') as request:
            with self.assertRaisesRegex(RuntimeError, '允许列表'):
                server.call_qwen_line_review(b'', '', {}, 'unknown-model')
            with patch.object(server, 'QWEN_REVIEW_API_KEY', ''):
                with self.assertRaisesRegex(RuntimeError, '未配置'):
                    server.call_qwen_line_review(b'', '', {}, 'qwen3.5-ocr')
            with patch.object(server, 'QWEN_REVIEW_API_KEY', 'test-only'), patch.object(server, 'QWEN_REVIEW_BASE_URL', 'https://example.com/v1'):
                with self.assertRaisesRegex(RuntimeError, '官方 HTTPS'):
                    server.call_qwen_line_review(b'', '', {}, 'qwen3.5-ocr')
            request.assert_not_called()

    def test_truncated_qwen_is_rejected(self):
        with patch.object(server, 'QWEN_REVIEW_API_KEY', 'test-only'), patch.object(server, 'QWEN_REVIEW_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1'), patch.object(server, 'prepare_line_review_images', return_value=([b'png'], {})), patch.object(server, 'post_json', return_value={'choices': [{'finish_reason': 'length', 'message': {'content': 'བོད་'}}]}):
            with self.assertRaisesRegex(RuntimeError, '完整'):
                server.call_qwen_line_review(b'', '', {}, 'qwen3.5-ocr')

    def test_transcript_rejects_unrelated_json_and_preserves_tibetan(self):
        for value in ['```text\n{"vin码":"se72k210400000000000000"}\n```', 'No text found', '{"text":"བོད་"}']:
            with self.assertRaisesRegex(RuntimeError, '非藏文'):
                server.validate_qwen_transcript(value)
        self.assertEqual(server.validate_qwen_transcript('```text\nབོད་\n```'), 'བོད་')
        self.assertEqual(server.validate_qwen_transcript('689'), '689')

    def test_gemini_override_is_request_scoped_no_fallback(self):
        captured = []
        def upstream(url, body, key):
            if url.endswith('/upload'):
                return {'ok': True, 'id': 'test-image'}
            captured.append(body)
            return {'ok': True, 'modelRef': 'gemini:gemini-3.1-flash-lite', 'text': 'བོད་'}
        original_model = server.MODEL
        with patch.object(server, 'post_json', side_effect=upstream), patch.object(server, 'attach_layout_bboxes', return_value=([], [])):
            result = server.call_model_aggregator_images([(b'png', 'line.png')], 'read', preserve_size=True, model_override='gemini:gemini-3.1-flash-lite')
            self.assertEqual(captured[0]['models'], ['gemini:gemini-3.1-flash-lite'])
            self.assertFalse(captured[0]['allowFallback'])
            self.assertEqual(result['model'], 'gemini:gemini-3.1-flash-lite')
            self.assertEqual(server.MODEL, original_model)

    def test_gemini_selected_model_reaches_crop_request(self):
        with patch.object(server, 'USE_MODEL_AGGREGATOR', True), patch.object(server, 'prepare_line_review_images', return_value=([b'png'], {})), patch.object(server, 'call_model_aggregator_images', return_value={'text': 'བོད་'}) as request:
            server.call_line_review_vision(b'', '', {}, '', 'gemini-3.1-flash-lite')
            self.assertEqual(request.call_args.kwargs['model_override'], 'gemini:gemini-3.1-flash-lite')
            with self.assertRaisesRegex(RuntimeError, '允许列表'):
                server.call_line_review_vision(b'', '', {}, '', 'qwen3.5-ocr')


if __name__ == '__main__':
    unittest.main()
