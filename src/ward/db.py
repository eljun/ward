from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from ward.models import Workspace

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    primary_repo_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    source_path TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'document',
    created_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned',
    type TEXT NOT NULL DEFAULT 'task',
    priority TEXT NOT NULL DEFAULT 'normal',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL,
    task_id INTEGER,
    agent_kind TEXT NOT NULL,
    mode TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned',
    summary TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,
    ended_at TEXT,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS session_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memory_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    workspace_id INTEGER,
    record_type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5,
    source_refs TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    source TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5,
    updated_at TEXT NOT NULL,
    UNIQUE(scope, key)
);
"""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect(db_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with connect(db_path) as connection:
        connection.executescript(SCHEMA)


def create_workspace(
    db_path: Path,
    *,
    name: str,
    slug: str,
    description: str,
    primary_repo_path: Optional[str],
) -> Workspace:
    timestamp = utc_now()
    with connect(db_path) as connection:
        cursor = connection.execute(
            """
            INSERT INTO workspaces (
                name, slug, description, status, primary_repo_path, created_at, updated_at
            ) VALUES (?, ?, ?, 'active', ?, ?, ?)
            """,
            (name, slug, description, primary_repo_path, timestamp, timestamp),
        )
        workspace_id = int(cursor.lastrowid)
    return get_workspace_by_id(db_path, workspace_id)


def list_workspaces(db_path: Path) -> list[Workspace]:
    with connect(db_path) as connection:
        rows = connection.execute(
            """
            SELECT id, name, slug, description, status, primary_repo_path, created_at, updated_at
            FROM workspaces
            ORDER BY updated_at DESC
            """
        ).fetchall()
    return [workspace_from_row(row) for row in rows]


def get_workspace_by_id(db_path: Path, workspace_id: int) -> Workspace:
    with connect(db_path) as connection:
        row = connection.execute(
            """
            SELECT id, name, slug, description, status, primary_repo_path, created_at, updated_at
            FROM workspaces
            WHERE id = ?
            """,
            (workspace_id,),
        ).fetchone()
    if row is None:
        raise ValueError(f"Workspace {workspace_id} does not exist.")
    return workspace_from_row(row)


def workspace_from_row(row: sqlite3.Row) -> Workspace:
    return Workspace(
        id=int(row["id"]),
        name=str(row["name"]),
        slug=str(row["slug"]),
        description=str(row["description"]),
        status=str(row["status"]),
        primary_repo_path=str(row["primary_repo_path"]) if row["primary_repo_path"] else None,
        created_at=datetime.fromisoformat(str(row["created_at"])),
        updated_at=datetime.fromisoformat(str(row["updated_at"])),
    )
