"""
brain.py — provider-configurable model caller for WARD.

Single responsibility: receive event context, call the configured model,
return spoken text or JSON state/decision payloads.
"""

import json
import os
import sys
import urllib.request

from ward_paths import ward_config_path, ward_home, ward_persona_path

WARD_DIR = ward_home()
CONFIG_PATH = ward_config_path()
PERSONA_PATH = ward_persona_path()

CONFIG_DEFAULTS = {
    "tts_provider": "macos",
    "macos_voice": "Ava",
    "persona_name": "Dev",
    "brain_provider": "ollama",
    "brain_model": "gemma4:e4b",
    "brain_providers": {},
    "brain_models": {},
    "ollama_host": "http://127.0.0.1:11434",
    "ollama_think": False,
    "ollama_think_modes": {},
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


def _resolve_brain_setting(config: dict, event: str, mode: str, singular_key: str, plural_key: str, default: str) -> str:
    overrides = config.get(plural_key, {})
    candidates = (
        f"{event}:{mode}",
        event,
        mode,
        "default",
    )
    for candidate in candidates:
        value = overrides.get(candidate)
        if value:
            return value
    return config.get(singular_key, default)


def _resolve_provider_and_model(config: dict, event: str, mode: str) -> tuple[str, str]:
    provider = _resolve_brain_setting(
        config=config,
        event=event,
        mode=mode,
        singular_key="brain_provider",
        plural_key="brain_providers",
        default=CONFIG_DEFAULTS["brain_provider"],
    ).lower()
    model = _resolve_brain_setting(
        config=config,
        event=event,
        mode=mode,
        singular_key="brain_model",
        plural_key="brain_models",
        default=CONFIG_DEFAULTS["brain_model"],
    )
    return provider, model


def _resolve_ollama_think(config: dict, event: str, mode: str):
    overrides = config.get("ollama_think_modes", {})
    candidates = (
        f"{event}:{mode}",
        event,
        mode,
        "default",
    )
    for candidate in candidates:
        if candidate in overrides:
            return overrides[candidate]
    return config.get("ollama_think", CONFIG_DEFAULTS["ollama_think"])


def _call_anthropic(persona: str, user_message: str, model: str, max_tokens: int) -> str:
    try:
        import anthropic
    except ImportError:
        _install_deps()
        import anthropic

    api_key = os.environ.get("WARD_ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise EnvironmentError("Set WARD_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY) in your shell profile")

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=persona,
        messages=[{"role": "user", "content": user_message}],
    )
    return response.content[0].text.strip()


def _extract_openai_text(response) -> str:
    output_text = getattr(response, "output_text", "")
    if output_text:
        return output_text.strip()

    output = getattr(response, "output", []) or []
    for item in output:
        if getattr(item, "type", "") != "message":
            continue
        for content in getattr(item, "content", []) or []:
            if getattr(content, "type", "") == "output_text":
                text = getattr(content, "text", "")
                if text:
                    return text.strip()
    return ""


def _call_openai(persona: str, user_message: str, model: str, max_tokens: int) -> str:
    try:
        from openai import OpenAI
    except ImportError:
        _install_deps()
        from openai import OpenAI

    api_key = os.environ.get("WARD_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise EnvironmentError("Set WARD_OPENAI_API_KEY (or OPENAI_API_KEY) in your shell profile")

    client = OpenAI(api_key=api_key)
    response = client.responses.create(
        model=model,
        instructions=persona,
        input=user_message,
        max_output_tokens=max_tokens,
    )
    return _extract_openai_text(response)


def _call_ollama(config: dict, persona: str, user_message: str, model: str, max_tokens: int, event: str, mode: str) -> str:
    host = config.get("ollama_host", CONFIG_DEFAULTS["ollama_host"]).rstrip("/")
    url = f"{host}/api/chat"
    body = {
        "model": model,
        "stream": False,
        "messages": [
            {"role": "system", "content": persona},
            {"role": "user", "content": user_message},
        ],
        "options": {
            "num_predict": max_tokens,
        },
        "think": _resolve_ollama_think(config, event=event, mode=mode),
    }
    if mode in {"decision", "state"}:
        body["format"] = "json"
    payload = json.dumps(body).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=120) as response:
        data = json.loads(response.read().decode("utf-8"))

    message = data.get("message", {})
    content = message.get("content", "")
    return str(content).strip()


def run(event: str, context: dict, mode: str = "speak") -> str:
    """
    event: session_start | tool_error | session_end | recap | post_response | summary_request
    context: dict of relevant fields per event type
    mode: "speak" returns 1-2 sentence string
          "summary" returns spoken summary text
          "state" returns JSON string
          "decision" returns JSON string
    """
    config = load_config()
    persona = load_persona(config)

    schema_hint = ""
    if mode == "state":
        schema_hint = (
            "\n\nFill in ONLY these exact fields from the conversation above. "
            "Replace each placeholder with the real value. No other keys. No prose. Return valid JSON only:\n"
            '{\n'
            '  "current_task": "<main task being worked on, or empty string if unclear>",\n'
            '  "top_priorities": ["<highest priority item>"],\n'
            '  "recent_completions": ["<what was completed this session>"],\n'
            '  "pending_prs": [],\n'
            '  "last_summary": "<one sentence: what was worked on and current status>",\n'
            '  "project": "<project name>"\n'
            '}'
        )
    elif mode == "decision":
        schema_hint = (
            "\n\nFill in ONLY these exact fields. No other keys. No prose. Return valid JSON only:\n"
            '{\n'
            '  "should_speak": false,\n'
            '  "reason": "<risk|completion|handoff|nudge|silence>",\n'
            '  "speech": "<one short sentence or empty string>",\n'
            '  "summary_offer_available": false\n'
            '}'
        )

    user_message = f"Event: {event}\nContext: {json.dumps(context)}\nMode: {mode}{schema_hint}"
    provider, model = _resolve_provider_and_model(config, event, mode)
    max_tokens_by_mode = {"speak": 150, "summary": 280, "decision": 240, "state": 1200}
    max_tokens = max_tokens_by_mode.get(mode, 200)

    if provider == "anthropic":
        return _call_anthropic(persona, user_message, model, max_tokens)
    if provider == "openai":
        return _call_openai(persona, user_message, model, max_tokens)
    if provider == "ollama":
        return _call_ollama(config, persona, user_message, model, max_tokens, event, mode)
    raise ValueError(f"Unsupported brain_provider: {provider}")


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
