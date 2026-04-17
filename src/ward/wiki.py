from __future__ import annotations

from pathlib import Path


UNIVERSAL_INDEX = """# Universal Memory Index

- [preferences.md](preferences.md): Stable user preferences and working style.
- [playbooks.md](playbooks.md): Reusable workflows and routines.
- [routing.md](routing.md): Agent routing heuristics and learned policy.
"""

UNIVERSAL_LOG = """# Universal Memory Log

## Seed
- Initialized universal memory for Ward.
"""

WORKSPACE_INDEX = """# Workspace Wiki Index

- [overview.md](overview.md): Workspace summary and purpose.
- [goals.md](goals.md): Current goals and intended outcomes.
- [constraints.md](constraints.md): Hard constraints, assumptions, and non-goals.
- [decisions.md](decisions.md): Important decisions and tradeoffs.
- [blockers.md](blockers.md): Known blockers and open questions.
- [sessions.md](sessions.md): Session summaries and handoffs.
- [plans.md](plans.md): Approved plan packets and planning notes.
"""

WORKSPACE_LOG = """# Workspace Wiki Log

## Seed
- Initialized workspace wiki.
"""

SCHEMA_TEXT = """# Wiki Schema

The wiki is LLM-maintained compiled memory.

Rules:
- Raw source documents are immutable inputs.
- The wiki contains synthesized and human-readable knowledge.
- Update index.md whenever new pages are added.
- Append notable changes to log.md.
- Prefer concise factual updates over speculative prose.
"""


def initialize_memory_root(root: Path, universal_dir: Path, workspaces_dir: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    universal_dir.mkdir(parents=True, exist_ok=True)
    workspaces_dir.mkdir(parents=True, exist_ok=True)
    write_if_missing(universal_dir / "index.md", UNIVERSAL_INDEX)
    write_if_missing(universal_dir / "log.md", UNIVERSAL_LOG)
    write_if_missing(universal_dir / "preferences.md", "# Preferences\n\n")
    write_if_missing(universal_dir / "playbooks.md", "# Playbooks\n\n")
    write_if_missing(universal_dir / "routing.md", "# Routing Heuristics\n\n")
    write_if_missing(root / "SCHEMA.md", SCHEMA_TEXT)


def initialize_workspace_wiki(workspaces_dir: Path, slug: str, title: str, description: str) -> Path:
    workspace_dir = workspaces_dir / slug / "wiki"
    workspace_dir.mkdir(parents=True, exist_ok=True)
    write_if_missing(workspace_dir / "index.md", WORKSPACE_INDEX)
    write_if_missing(workspace_dir / "log.md", WORKSPACE_LOG)
    write_if_missing(
        workspace_dir / "overview.md",
        f"# {title}\n\n{description or 'Workspace created. Summary pending.'}\n",
    )
    write_if_missing(workspace_dir / "goals.md", "# Goals\n\n")
    write_if_missing(workspace_dir / "constraints.md", "# Constraints\n\n")
    write_if_missing(workspace_dir / "decisions.md", "# Decisions\n\n")
    write_if_missing(workspace_dir / "blockers.md", "# Blockers\n\n")
    write_if_missing(workspace_dir / "sessions.md", "# Sessions\n\n")
    write_if_missing(workspace_dir / "plans.md", "# Plans\n\n")
    return workspace_dir


def write_if_missing(path: Path, content: str) -> None:
    if not path.exists():
        path.write_text(content, encoding="utf-8")
