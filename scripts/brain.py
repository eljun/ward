"""
brain.py — Claude Haiku API caller for WARD.

Single responsibility: receive event context, call Claude Haiku, return
either a spoken 1-2 sentence string or an updated state.json JSON string.

Usage:
  python3 brain.py '{"event": "session_start", "context": {...}, "mode": "speak"}'
  or imported: from brain import run
"""

import json
import os
import sys

WARD_DIR = os.path.expanduser("~/.ward")
CONFIG_PATH = os.path.join(WARD_DIR, "config.json")
PERSONA_PATH = os.path.join(WARD_DIR, "persona.txt")

CONFIG_DEFAULTS = {
    "tts_provider": "macos",
    "macos_voice": "Ava",
    "persona_name": "Dev",
}


def load_config() -> dict:
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH) as f:
                return {**CONFIG_DEFAULTS, **json.load(f)}
        except Exception:
            pass
    return dict(CONFIG_DEFAULTS)


def load_persona(config: dict) -> str:
    persona_name = config.get("persona_name", "Dev")
    if os.path.exists(PERSONA_PATH):
        try:
            with open(PERSONA_PATH) as f:
                persona = f.read()
            return persona.replace("{persona_name}", persona_name)
        except Exception:
            pass
    # Minimal fallback persona if persona.txt is missing
    return (
        f"You are Ward, a senior software engineer pair-programming with {persona_name}. "
        "Speak casually and directly. Keep every response to 1-2 sentences. "
        "When mode is 'speak', return only the spoken text with no labels or markdown. "
        "When mode is 'state', return only valid JSON. Silence is better than noise."
    )


def run(event: str, context: dict, mode: str = "speak") -> str:
    """
    event: session_start | tool_error | session_end | recap
    context: dict of relevant fields per event type
    mode: "speak" returns 1-2 sentence string | "state" returns JSON string
    """
    try:
        import anthropic
    except ImportError:
        _install_deps()
        import anthropic

    config = load_config()
    persona = load_persona(config)
    api_key = os.environ.get("WARD_ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise EnvironmentError("Set WARD_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY) in your shell profile")

    client = anthropic.Anthropic(api_key=api_key)

    user_message = f"Event: {event}\nContext: {json.dumps(context)}\nMode: {mode}"

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=150 if mode == "speak" else 500,
        system=persona,
        messages=[{"role": "user", "content": user_message}],
    )

    return response.content[0].text.strip()


def _install_deps() -> None:
    import subprocess
    requirements = os.path.join(os.path.dirname(__file__), "..", "requirements.txt")
    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", "-r", requirements, "-q"]
    )


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print('Usage: python3 brain.py \'{"event": "session_start", "context": {}, "mode": "speak"}\'')
        sys.exit(1)
    payload = json.loads(sys.argv[1])
    result = run(
        event=payload.get("event", "session_start"),
        context=payload.get("context", {}),
        mode=payload.get("mode", "speak"),
    )
    print(result)
