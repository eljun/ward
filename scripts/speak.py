"""
speak.py — TTS dispatcher for WARD.

Fallback chain:
  1. ElevenLabs streaming (if tts_provider == "elevenlabs" and key is set)
  2. macOS `say` command
  3. Silent stderr write (non-Mac or all else fails — never crash)

Usage:
  python3 speak.py "Text to speak"
  or imported: from speak import speak
"""

import json
import os
import subprocess
import sys
import tempfile

from ward_paths import ward_config_path

CONFIG_PATH = ward_config_path()

DEFAULTS = {
    "tts_provider": "macos",
    "macos_voice": "Ava",
    "elevenlabs_voice_id": "21m00Tcm4TlvDq8ikWAM",
    "elevenlabs_model": "eleven_turbo_v2",
}


def load_config() -> dict:
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH) as f:
                return {**DEFAULTS, **json.load(f)}
        except Exception:
            pass
    return dict(DEFAULTS)


def speak(text: str) -> None:
    if not text or not text.strip():
        return
    config = load_config()
    if (
        config.get("tts_provider") == "elevenlabs"
        and os.environ.get("ELEVENLABS_API_KEY")
    ):
        try:
            _speak_elevenlabs(text, config)
            return
        except Exception as e:
            print(f"[ward] ElevenLabs failed, falling back to macOS say: {e}", file=sys.stderr)
    _speak_macos(text, config)


def _speak_elevenlabs(text: str, config: dict) -> None:
    import urllib.request

    voice_id = config.get("elevenlabs_voice_id", DEFAULTS["elevenlabs_voice_id"])
    model_id = config.get("elevenlabs_model", DEFAULTS["elevenlabs_model"])
    api_key = os.environ["ELEVENLABS_API_KEY"]

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream"
    payload = json.dumps({
        "text": text,
        "model_id": model_id,
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
    }).encode()

    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
    )

    with urllib.request.urlopen(req, timeout=10) as resp:
        audio_data = resp.read()

    # Write to temp file and play with afplay
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        tmp.write(audio_data)
        tmp_path = tmp.name

    try:
        subprocess.run(["afplay", tmp_path], check=True)
    finally:
        os.unlink(tmp_path)


def _speak_macos(text: str, config: dict) -> None:
    voice = config.get("macos_voice", DEFAULTS["macos_voice"])
    try:
        subprocess.run(["say", "-v", voice, text], check=True)
    except FileNotFoundError:
        # `say` not available (non-Mac)
        print(f"[ward] (no TTS available): {text}", file=sys.stderr)
    except subprocess.CalledProcessError as e:
        print(f"[ward] macOS say failed: {e}", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 speak.py \"Text to speak\"")
        sys.exit(1)
    speak(" ".join(sys.argv[1:]))
