from __future__ import annotations

import argparse
from pathlib import Path
from typing import List, Optional

from ward.bootstrap import initialize_runtime, resolve_repo_path
from ward.config import build_paths
from ward.db import create_workspace, list_workspaces
from ward.helpers import slugify
from ward.wiki import initialize_workspace_wiki


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ward",
        description="Local-first personal developer command center bootstrap.",
    )
    parser.add_argument(
        "--home",
        type=Path,
        help="Runtime home directory. Defaults to WARD_HOME or ./.ward.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("init", help="Initialize the local runtime directories and SQLite database.")
    subparsers.add_parser("status", help="Show runtime status and workspace count.")

    create_parser = subparsers.add_parser("create-workspace", help="Create a new workspace.")
    create_parser.add_argument("name", help="Workspace name.")
    create_parser.add_argument("--description", default="", help="Workspace description.")
    create_parser.add_argument("--repo", help="Primary local repository path.")

    subparsers.add_parser("list-workspaces", help="List all workspaces.")
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    paths = build_paths(args.home)

    if args.command == "init":
        initialize_runtime(paths)
        print(f"Initialized runtime at {paths.root}")
        return 0

    initialize_runtime(paths)

    if args.command == "status":
        workspaces = list_workspaces(paths.db_path)
        print(f"Runtime root: {paths.root}")
        print(f"Database: {paths.db_path}")
        print(f"Universal wiki: {paths.universal_memory_dir}")
        print(f"Workspace wikis: {paths.workspace_memory_dir}")
        print(f"Workspace count: {len(workspaces)}")
        return 0

    if args.command == "create-workspace":
        slug = slugify(args.name)
        repo_path = resolve_repo_path(args.repo)
        workspace = create_workspace(
            paths.db_path,
            name=args.name,
            slug=slug,
            description=args.description,
            primary_repo_path=repo_path,
        )
        wiki_dir = initialize_workspace_wiki(
            workspaces_dir=paths.workspace_memory_dir,
            slug=workspace.slug,
            title=workspace.name,
            description=workspace.description,
        )
        print(f"Created workspace {workspace.id}: {workspace.name}")
        print(f"Slug: {workspace.slug}")
        print(f"Wiki: {wiki_dir}")
        return 0

    if args.command == "list-workspaces":
        workspaces = list_workspaces(paths.db_path)
        if not workspaces:
            print("No workspaces found.")
            return 0
        for workspace in workspaces:
            print(f"[{workspace.id}] {workspace.name} ({workspace.slug}) - {workspace.status}")
            if workspace.primary_repo_path:
                print(f"  repo: {workspace.primary_repo_path}")
        return 0

    parser.error(f"Unsupported command: {args.command}")
    return 2
