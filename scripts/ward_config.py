#!/usr/bin/env python3
"""
ward_config.py — backing script for the /ward slash command.

Lets the user view and edit WARD settings without hand-editing
~/.ward/config.json. Subcommands:

  /ward status
      Print a summary of the active config and registered projects.

  /ward setup [--force]
      Run or re-run ~/.ward/ bootstrap.

  /ward voice <voice-name>
      Set the macOS voice or ElevenLabs voice id.

  /ward brain <provider> [model]
      Set brain_provider (ollama|openai|anthropic) and optional brain_model.

  /ward proactive <on|off|cooldown N|chat N>
      Toggle proactive behavior or tune cooldown_seconds / conversation_min_chars.

  /ward doctor
      Check Ollama reachability, key presence, and config health.
"""

import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR)


def _load_ward_home():
    from state_store import CONFIG_PATH, WARD_DIR, load_config
    return WARD_DIR, CONFIG_PATH, load_config


def _write_config(config_path: str, config: dict) -> None:
    os.makedirs(os.path.dirname(config_path), exist_ok=True)
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)


def cmd_status() -> int:
    ward_dir, config_path, load_config = _load_ward_home()
    config = load_config()
    if not config:
        print("WARD is not configured yet. Run: /ward setup")
        return 1

    print(f"WARD home: {ward_dir}")
    print(f"Config:    {config_path}")
    print(f"Persona:   {config.get('persona_name', '(unset)')}")
    print()
    print("Brain:")
    print(f"  provider: {config.get('brain_provider', 'ollama')}")
    print(f"  model:    {config.get('brain_model', 'gemma4:e4b')}")
    if config.get("brain_providers"):
        print(f"  per-mode: {json.dumps(config['brain_providers'])}")
    if config.get("brain_models"):
        print(f"  per-mode models: {json.dumps(config['brain_models'])}")
    print()
    print("Voice:")
    print(f"  tts_provider: {config.get('tts_provider', 'macos')}")
    print(f"  macos_voice:  {config.get('macos_voice', 'Ava')}")
    if config.get("tts_provider") == "elevenlabs":
        print(f"  elevenlabs_voice_id: {config.get('elevenlabs_voice_id', '')}")
    print()
    proactive = config.get("proactive", {})
    print("Proactive:")
    print(f"  enabled:                {proactive.get('enabled', True)}")
    print(f"  cooldown_seconds:       {proactive.get('cooldown_seconds', 30)}")
    print(f"  conversation_min_chars: {proactive.get('conversation_min_chars', 60)}")
    print()
    projects = config.get("projects", {}) or {}
    if projects:
        print(f"Projects ({len(projects)}):")
        for root, entry in projects.items():
            name = entry.get("project_name", "")
            tasks = entry.get("tasks_md_path", "")
            print(f"  - {name}  [{root}]  tasks={tasks}")
    else:
        print("Projects: none registered. Run /ward-init inside a project.")
    return 0


def cmd_setup(force: bool = False) -> int:
    from bootstrap import ensure_ward_home
    for message in ensure_ward_home(force=force):
        print(message)
    return 0


def cmd_voice(voice: str) -> int:
    ward_dir, config_path, load_config = _load_ward_home()
    config = load_config()
    if not config:
        print("WARD is not configured yet. Run /ward setup first.")
        return 1
    if config.get("tts_provider") == "elevenlabs":
        config["elevenlabs_voice_id"] = voice
        _write_config(config_path, config)
        print(f"Set elevenlabs_voice_id to: {voice}")
    else:
        config["macos_voice"] = voice
        _write_config(config_path, config)
        print(f"Set macos_voice to: {voice}")
    return 0


def cmd_brain(provider: str, model: str = "") -> int:
    ward_dir, config_path, load_config = _load_ward_home()
    config = load_config()
    if not config:
        print("WARD is not configured yet. Run /ward setup first.")
        return 1
    if provider not in {"ollama", "openai", "anthropic"}:
        print(f"Unknown provider: {provider}. Use ollama | openai | anthropic.")
        return 2
    config["brain_provider"] = provider
    if model:
        config["brain_model"] = model
    _write_config(config_path, config)
    print(f"Set brain_provider={provider}" + (f", brain_model={model}" if model else ""))
    return 0


def cmd_proactive(argv: list) -> int:
    if not argv:
        print("Usage: /ward proactive <on|off|cooldown N|chat N>")
        return 2
    ward_dir, config_path, load_config = _load_ward_home()
    config = load_config()
    if not config:
        print("WARD is not configured yet. Run /ward setup first.")
        return 1
    proactive = dict(config.get("proactive", {}))
    sub = argv[0]
    if sub == "on":
        proactive["enabled"] = True
    elif sub == "off":
        proactive["enabled"] = False
    elif sub in {"cooldown", "chat"}:
        if len(argv) < 2:
            print(f"Usage: /ward proactive {sub} N")
            return 2
        try:
            n = int(argv[1])
        except ValueError:
            print(f"{sub} expects an integer")
            return 2
        key = "cooldown_seconds" if sub == "cooldown" else "conversation_min_chars"
        proactive[key] = n
    else:
        print(f"Unknown subcommand: {sub}")
        return 2
    config["proactive"] = proactive
    _write_config(config_path, config)
    print(f"proactive: {json.dumps(proactive)}")
    return 0


def _check_ollama(host: str) -> tuple:
    url = host.rstrip("/") + "/api/tags"
    try:
        with urllib.request.urlopen(url, timeout=3) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        models = [m.get("name", "") for m in body.get("models", [])]
        return True, models
    except urllib.error.URLError as exc:
        return False, [str(exc.reason)]
    except Exception as exc:
        return False, [str(exc)]


def cmd_doctor() -> int:
    ward_dir, config_path, load_config = _load_ward_home()
    print(f"ward_dir:    {ward_dir}  exists={os.path.isdir(ward_dir)}")
    print(f"config.json: {config_path}  exists={os.path.exists(config_path)}")
    config = load_config()
    if not config:
        print("  config is empty or missing. Run /ward setup.")
        return 1

    provider = config.get("brain_provider", "ollama")
    model = config.get("brain_model", "gemma4:e4b")
    print(f"brain:       {provider} / {model}")

    if provider == "ollama":
        host = config.get("ollama_host", "http://127.0.0.1:11434")
        ok, info = _check_ollama(host)
        if ok:
            hit = model in info
            print(f"ollama:      reachable at {host}; {len(info)} models; target present={hit}")
            if not hit:
                print(f"             run: ollama pull {model}")
        else:
            print(f"ollama:      NOT reachable at {host}  ({info[0]})")
    elif provider == "openai":
        have = bool(os.environ.get("WARD_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY"))
        print(f"openai key:  {'set' if have else 'MISSING (set WARD_OPENAI_API_KEY)'}")
    elif provider == "anthropic":
        have = bool(os.environ.get("WARD_ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY"))
        print(f"anthropic key: {'set' if have else 'MISSING (set WARD_ANTHROPIC_API_KEY)'}")

    tts = config.get("tts_provider", "macos")
    print(f"tts:         {tts}")
    if tts == "macos":
        print(f"  say found: {bool(shutil.which('say'))}")
    elif tts == "elevenlabs":
        print(f"  key set:   {bool(os.environ.get('ELEVENLABS_API_KEY'))}")

    projects = config.get("projects", {}) or {}
    print(f"projects:    {len(projects)} registered")
    return 0


USAGE = """Usage:
  /ward status
  /ward setup [--force]
  /ward voice <voice-name>
  /ward brain <provider> [model]
  /ward proactive <on|off|cooldown N|chat N>
  /ward doctor
"""


def main(argv: list) -> int:
    if not argv or argv[0] in {"-h", "--help", "help"}:
        print(USAGE)
        return 0
    sub = argv[0]
    rest = argv[1:]
    if sub == "status":
        return cmd_status()
    if sub == "setup":
        force = "--force" in rest
        return cmd_setup(force=force)
    if sub == "voice":
        if not rest:
            print("Usage: /ward voice <voice-name>")
            return 2
        return cmd_voice(rest[0])
    if sub == "brain":
        if not rest:
            print("Usage: /ward brain <provider> [model]")
            return 2
        return cmd_brain(rest[0], rest[1] if len(rest) > 1 else "")
    if sub == "proactive":
        return cmd_proactive(rest)
    if sub == "doctor":
        return cmd_doctor()
    print(f"Unknown subcommand: {sub}")
    print(USAGE)
    return 2


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Exception as exc:
        print(f"[ward] ward_config error: {exc}", file=sys.stderr)
        raise SystemExit(1)
