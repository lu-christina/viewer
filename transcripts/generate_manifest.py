#!/usr/bin/env python3
"""Generate a manifest of all transcript files for the viewer."""

import json
import os
from pathlib import Path

RESULTS_DIR = Path(__file__).parent.parent.parent / "dynamics" / "results"
OUTPUT_FILE = Path(__file__).parent / "manifest.json"


def scan_transcripts():
    """Scan the results directory and build a manifest of all JSON files."""
    manifest = {}

    if not RESULTS_DIR.exists():
        print(f"Error: Results directory not found: {RESULTS_DIR}")
        return manifest

    # Iterate through model directories
    for model_dir in sorted(RESULTS_DIR.iterdir()):
        if not model_dir.is_dir():
            continue

        model_name = model_dir.name
        manifest[model_name] = {}

        # Iterate through subdirectories
        for subdir in sorted(model_dir.iterdir()):
            if not subdir.is_dir():
                continue

            subdir_name = subdir.name
            files = []

            # Find all JSON files recursively in this subdirectory
            for json_file in sorted(subdir.rglob("*.json")):
                # Get relative path from subdir
                rel_path = json_file.relative_to(subdir)
                files.append(str(rel_path))

            if files:
                manifest[model_name][subdir_name] = files

        # Remove model if it has no subdirectories with files
        if not manifest[model_name]:
            del manifest[model_name]

    return manifest


def main():
    print("Scanning transcript directories...")
    manifest = scan_transcripts()

    # Write manifest
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(manifest, f, indent=2)

    print(f"Manifest generated: {OUTPUT_FILE}")

    # Print summary
    total_files = sum(len(files) for model in manifest.values() for files in model.values())
    print(f"Found {len(manifest)} models, {total_files} total transcript files")

    for model, subdirs in sorted(manifest.items()):
        print(f"  {model}: {len(subdirs)} subdirectories")
        for subdir, files in sorted(subdirs.items()):
            print(f"    {subdir}: {len(files)} files")


if __name__ == "__main__":
    main()
