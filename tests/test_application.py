import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from aizen import application


class ApplicationTests(unittest.TestCase):
    def setUp(self):
        self.client = application.app.test_client()

    def test_home_page_loads_without_provider_keys(self):
        with patch.object(application, "client", None), patch.object(application, "nvidia_client", None):
            response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Aizen AI", response.data)

    def test_chat_reports_missing_key_without_crashing(self):
        with patch.object(application, "client", None):
            response = self.client.post("/chat", json={"message": "Hello"})

        self.assertEqual(response.status_code, 503)
        self.assertIn("GROQ_API_KEY", response.get_json()["error"])

    def test_image_chat_reports_missing_vision_key(self):
        with patch.object(application, "nvidia_client", None):
            response = self.client.post("/chat", json={"message": "Describe it", "image": "image-data"})

        self.assertEqual(response.status_code, 503)
        self.assertIn("NVIDIA_API_KEY", response.get_json()["error"])

    def test_chat_caps_output_tokens_and_persists_history(self):
        response_message = SimpleNamespace(content="Hello there")
        completion = SimpleNamespace(choices=[SimpleNamespace(message=response_message)])
        provider = SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=Mock(return_value=completion)))
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            history_path = Path(temp_dir) / "chats.json"
            with patch.object(application, "client", provider), patch.object(
                application, "CHATS_FILE", str(history_path)
            ):
                result = application.process_chat("Hello", chat_id="test")

            self.assertEqual(result["response"], "Hello there")
            self.assertEqual(provider.chat.completions.create.call_args.kwargs["max_tokens"], 700)
            self.assertTrue(history_path.exists())


if __name__ == "__main__":
    unittest.main()
