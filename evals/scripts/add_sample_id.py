#!/usr/bin/env python3
"""
Script to add sample_id: 0 to JSONL entries that are missing this field.
Fixes default_50_scores.jsonl files in susceptibility evaluation data.
"""

import json
import os
from pathlib import Path

def add_sample_id_to_file(file_path):
    """Add sample_id: 0 to entries missing this field."""
    print(f"Processing: {file_path}")
    
    # Read all entries
    entries = []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line:
                    entry = json.loads(line)
                    # Add sample_id: 0 if not present
                    if 'sample_id' not in entry:
                        entry['sample_id'] = 0
                    entries.append(entry)
    except Exception as e:
        print(f"Error reading {file_path}: {e}")
        return False
    
    # Write back with sample_id added
    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            for entry in entries:
                f.write(json.dumps(entry, ensure_ascii=False) + '\n')
        print(f"  ✓ Updated {len(entries)} entries")
        return True
    except Exception as e:
        print(f"Error writing {file_path}: {e}")
        return False

def main():
    base_dir = Path('/root/git/persona-subspace/evals/susceptibility')
    
    # Find all default_50_scores.jsonl files
    models = ['gemma-2-27b', 'llama-3.3-70b', 'qwen-3-32b']
    subdirs = ['steered', 'unsteered']
    
    files_to_process = []
    for model in models:
        for subdir in subdirs:
            file_path = base_dir / model / subdir / 'default_50_scores.jsonl'
            if file_path.exists():
                files_to_process.append(file_path)
            else:
                print(f"Warning: File not found: {file_path}")
    
    if not files_to_process:
        print("No files found to process")
        return
    
    print(f"Found {len(files_to_process)} files to process:")
    for file_path in files_to_process:
        print(f"  {file_path}")
    
    # Process each file
    success_count = 0
    for file_path in files_to_process:
        if add_sample_id_to_file(file_path):
            success_count += 1
    
    print(f"\nCompleted: {success_count}/{len(files_to_process)} files processed successfully")

if __name__ == '__main__':
    main()