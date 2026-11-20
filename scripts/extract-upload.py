#!/usr/bin/env python3
"""Safely unpack ZIP uploads from /uploads into the repository root."""
from __future__ import annotations

import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
UPLOAD_DIR = ROOT / "uploads"
MAX_FILES = 10_000
MAX_UNPACKED_BYTES = 200 * 1024 * 1024
PROTECTED = {
    ".github/workflows/upload-zip.yml",
    "scripts/extract-upload.py",
}


def normalized_name(raw_name: str) -> PurePosixPath | None:
    name = raw_name.replace("\\", "/")
    path = PurePosixPath(name)
    if not name or path.is_absolute() or any(part in ("..", "") for part in path.parts):
        return None
    if path.parts and (":" in path.parts[0] or path.parts[0] == ".git"):
        return None
    return path


def read_archive(archive_path: Path):
    with zipfile.ZipFile(archive_path) as archive:
        records = []
        total_size = 0
        for info in archive.infolist():
            path = normalized_name(info.filename)
            if path is None or info.is_dir():
                continue
            if "__MACOSX" in path.parts or path.name in (".DS_Store", "Thumbs.db"):
                continue
            # Do not import files into the upload inbox or replace this importer.
            if path.parts[0] == "uploads" or path.as_posix() in PROTECTED:
                print(f"Skipped reserved path: {path.as_posix()}")
                continue
            mode = info.external_attr >> 16
            if stat.S_ISLNK(mode):
                print(f"Skipped symbolic link: {path.as_posix()}")
                continue
            if info.file_size > MAX_UNPACKED_BYTES:
                raise ValueError(f"File is too large to unpack: {path.as_posix()}")
            total_size += info.file_size
            if total_size > MAX_UNPACKED_BYTES:
                raise ValueError(f"Archive expands beyond {MAX_UNPACKED_BYTES // (1024 * 1024)} MB")
            records.append((path, info))
            if len(records) > MAX_FILES:
                raise ValueError(f"Archive contains more than {MAX_FILES} files")

        if not records:
            raise ValueError(f"No usable files found in {archive_path.name}")

        # ZIPs made from a project folder commonly contain one wrapper folder
        # (for example PokeDrop-main/). Strip it so files land at repo root.
        first_parts = [path.parts for path, _ in records]
        first_component = first_parts[0][0]
        wrapper_markers = {
            "README.md", "README", "index.html", "package.json", "pyproject.toml",
            "Cargo.toml", ".github", "src", "public", "scripts", "assets",
        }
        looks_like_project_root = any(parts[1] in wrapper_markers for parts in first_parts if len(parts) > 1)
        is_github_archive_folder = first_component.lower().endswith(
            ("-main", "-master", "-develop", "-development", "-dev", "-gh-pages")
        )
        if (
            all(parts[0] == first_component and len(parts) > 1 for parts in first_parts)
            and (looks_like_project_root or is_github_archive_folder)
        ):
            records = [(PurePosixPath(*path.parts[1:]), info) for path, info in records]

        output = []
        for path, info in records:
            relative = path.as_posix()
            if ".git" in path.parts or path.parts[0] == "uploads" or relative in PROTECTED:
                print(f"Skipped reserved path: {relative}")
                continue
            output.append((path, archive.read(info)))
        return output


def main() -> int:
    archives = sorted(UPLOAD_DIR.glob("*.zip"))
    if not archives:
        print("No ZIP uploads found in uploads/. Nothing to do.")
        return 0

    # Validate and read every archive before changing repository files.
    prepared = []
    for archive_path in archives:
        print(f"Reading {archive_path.relative_to(ROOT)}")
        prepared.extend(read_archive(archive_path))

    if not prepared:
        raise ValueError("No files remained after applying reserved-path protections")

    written = []
    for relative, content in prepared:
        destination = (ROOT / Path(*relative.parts)).resolve()
        if ROOT not in destination.parents:
            raise ValueError(f"Unsafe output path: {relative.as_posix()}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
        written.append(relative.as_posix())

    for archive_path in archives:
        archive_path.unlink()

    print(f"Extracted {len(written)} file(s):")
    for name in written:
        print(f"  {name}")
    print(f"Removed {len(archives)} processed ZIP upload(s).")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # GitHub Actions will show the actionable error.
        print(f"ZIP extraction failed: {exc}", file=sys.stderr)
        sys.exit(1)
