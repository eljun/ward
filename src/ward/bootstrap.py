from __future__ import annotations

from pathlib import Path
from typing import Optional

from ward.config import AppPaths
from ward.db import initialize_database
from ward.wiki import initialize_memory_root


def initialize_runtime(paths: AppPaths) -> None:
    paths.root.mkdir(parents=True, exist_ok=True)
    paths.data_dir.mkdir(parents=True, exist_ok=True)
    paths.attachments_dir.mkdir(parents=True, exist_ok=True)
    initialize_database(paths.db_path)
    initialize_memory_root(
        root=paths.memory_dir,
        universal_dir=paths.universal_memory_dir,
        workspaces_dir=paths.workspace_memory_dir,
    )


def resolve_repo_path(repo: Optional[str]) -> Optional[str]:
    if repo is None:
        return None
    return str(Path(repo).expanduser().resolve())
