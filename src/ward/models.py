from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass
class Workspace:
    id: int
    name: str
    slug: str
    description: str
    status: str
    primary_repo_path: Optional[str]
    created_at: datetime
    updated_at: datetime
