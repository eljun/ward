from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass(frozen=True)
class AppPaths:
    root: Path
    data_dir: Path
    memory_dir: Path
    universal_memory_dir: Path
    workspace_memory_dir: Path
    attachments_dir: Path
    db_path: Path


def build_paths(root: Optional[Path] = None) -> AppPaths:
    base_root = root or Path(os.environ.get("WARD_HOME", ".ward"))
    resolved_root = base_root.expanduser().resolve()
    data_dir = resolved_root / "data"
    memory_dir = resolved_root / "memory"
    return AppPaths(
        root=resolved_root,
        data_dir=data_dir,
        memory_dir=memory_dir,
        universal_memory_dir=memory_dir / "universal",
        workspace_memory_dir=memory_dir / "workspaces",
        attachments_dir=resolved_root / "attachments",
        db_path=data_dir / "ward.sqlite3",
    )
