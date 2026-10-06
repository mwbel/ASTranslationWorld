import importlib.util
from pathlib import Path
import tempfile
import unittest
import io
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('configure', Path(__file__).resolve().parents[1] / 'configure_qwen_review.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ConfigureTests(unittest.TestCase):
    def test_official_base_and_local_key_validation(self):
        base, key = module.validate_inputs('https://example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/', 'sk-test-only-12345678')
        self.assertFalse(base.endswith('/'))
        with self.assertRaises(ValueError):
            module.validate_inputs('https://example.com/v1', key)
        with self.assertRaises(ValueError):
            module.validate_inputs(base, 'sk- ***')

    def test_unknown_listener_is_never_stopped(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(module.subprocess, 'run') as run, patch.object(module.os, 'kill') as kill:
                run.return_value.stdout = '1234'
                with self.assertRaisesRegex(RuntimeError, '未确认'):
                    module.stop_workspace_ai(Path(folder), 18092)
                kill.assert_not_called()

    def test_key_only_enters_child_environment(self):
        key = 'sk-test-only-12345678'
        with tempfile.TemporaryDirectory() as folder:
            with patch.dict(module.os.environ, {'BDRC_RUNTIME_DIR': folder}), patch.object(module, 'stop_workspace_ai') as stop, patch.object(module.subprocess, 'Popen') as spawn, patch.object(module, 'urlopen', return_value=io.StringIO('{"qwen":{"configured":true}}')):
                spawn.return_value.pid = 12345
                spawn.return_value.poll.return_value = None
                module.configure('https://example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', key)
                stop.assert_called_once()
                self.assertNotIn(key, str(spawn.call_args.args))
                self.assertEqual(spawn.call_args.kwargs['env']['QWEN_REVIEW_API_KEY'], key)
                self.assertEqual(sorted(path.name for path in Path(folder).iterdir()), ['ai_ocr.log', 'ai_ocr.pid'])
                self.assertNotIn(key, (Path(folder) / 'ai_ocr.pid').read_text())


if __name__ == '__main__':
    unittest.main()
