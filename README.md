# Aizen AI

Aizen is a Flask chat application with optional image analysis, PDF uploads, and voice input/output.

## Setup

1. Install Python 3.10 or newer.
2. Create and activate a virtual environment:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```

3. Install dependencies:

   ```powershell
   python -m pip install -r requirements.txt
   ```

4. Create your local environment file and add your own provider keys:

   ```powershell
   Copy-Item .env.example .env
   ```

   Set `GROQ_API_KEY` for chat and server-side voice transcription. Set `NVIDIA_API_KEY` for image analysis. The app can start without keys, but the corresponding AI features will report that configuration is missing.

5. Start the app:

   ```powershell
   python run.py
   ```

   Open <http://127.0.0.1:5000>.

Microphone access requires a secure browser context; `localhost` is supported. Browser speech recognition and speech synthesis availability depends on the browser and operating system. When speech recognition is unavailable, Aizen uses Groq transcription.

## Tests

```powershell
python -m unittest discover -s tests -v
```

## Project layout

```text
aizen/                   Flask application package
  application.py         Routes, provider setup, and chat services
  static/                Frontend JavaScript and styles
  templates/             Jinja templates
examples/                Standalone voice assistant example
instance/                Local chat history; not committed
tests/                   Automated tests
.env.example             Safe environment-variable template
app.py                    Backward-compatible entry point
run.py                    Application entry point
requirements.txt          Python dependencies
```

Never commit `.env`, provider credentials, or local chat history. If credentials were previously committed or shared, revoke them with the provider and create replacements.
