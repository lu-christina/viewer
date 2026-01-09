#!/usr/bin/env python3
"""
Script to transform jailbreak evaluation data for the viewer.
Creates an index file and individual prompt files for lazy loading.

Data sources:
- Unsteered: /workspace/{model}/evals/unsteered/
- Steered: /workspace/{model}/evals/results/
"""

import json
import os
from pathlib import Path
from collections import defaultdict
import argparse


def load_jsonl(filepath):
    """Load a JSONL file and return a list of dictionaries."""
    data = []
    with open(filepath, 'r') as f:
        for line in f:
            data.append(json.loads(line))
    return data


def parse_experiment_id(experiment_id):
    """Parse experiment_id like 'layer_40-role_pc1-coeff:-1.25'"""
    steering_type = None
    coeff = None

    # Find steering type
    if '-contrast-' in experiment_id or experiment_id.endswith('-contrast'):
        steering_type = 'contrast'
    elif '-role_pc1-' in experiment_id or experiment_id.endswith('-role_pc1'):
        steering_type = 'role_pc1'

    # Find coefficient - look for coeff: pattern
    if 'coeff:' in experiment_id:
        coeff_part = experiment_id.split('coeff:')[1]
        # The coeff value might have more content after it, but typically it's at the end
        try:
            coeff = float(coeff_part)
        except ValueError:
            pass

    return steering_type, coeff


def process_model_data(model_name, workspace_dir, output_dir, chunk_size=25):
    """Process all data files for a given model with lazy loading structure."""
    print(f"Processing model: {model_name}")

    # File paths
    unsteered_dir = workspace_dir / model_name / "evals" / "unsteered"
    steered_dir = workspace_dir / model_name / "evals" / "results"

    files = {
        'unsteered_jailbreak': unsteered_dir / "unsteered_scores.jsonl",
        'unsteered_default': unsteered_dir / "unsteered_default_scores.jsonl",
        'steered_jailbreak': steered_dir / "asst_pc1_contrast_jailbreak_1100_scores.jsonl",
        'steered_default': steered_dir / "asst_pc1_contrast_default_1100_scores.jsonl"
    }

    # Check if all files exist
    for name, path in files.items():
        if not path.exists():
            print(f"  Warning: {name} file not found at {path}")
            return None

    # Load all data
    data = {}
    for name, path in files.items():
        data[name] = load_jsonl(path)
        print(f"  Loaded {len(data[name])} entries from {name}")

    # Create model-specific output directory
    model_output_dir = output_dir / model_name
    model_output_dir.mkdir(parents=True, exist_ok=True)

    # Create chunks subdirectory for chunk files
    chunks_dir = model_output_dir / "chunks"
    chunks_dir.mkdir(parents=True, exist_ok=True)

    # Get all unique steering types and coefficients from steered data
    steering_types = set()
    coefficients_by_type = defaultdict(set)

    for entry in data['steered_jailbreak']:
        experiment_id = entry.get('experiment_id', '')
        steering_type, coeff = parse_experiment_id(experiment_id)
        if steering_type and coeff is not None:
            steering_types.add(steering_type)
            coefficients_by_type[steering_type].add(coeff)

    # Add 0 (unsteered) to all steering types
    for st in steering_types:
        coefficients_by_type[st].add(0)

    print(f"  Found steering types: {steering_types}")
    print(f"  Coefficients by type: {dict((k, sorted(v)) for k, v in coefficients_by_type.items())}")

    # Build index structure
    index = {
        "model": model_name,
        "eval": "jailbreak",
        "prompt_ids": [],
        "steering_types": sorted(list(steering_types)),
        "coefficients": {st: sorted(list(coeffs)) for st, coeffs in coefficients_by_type.items()},
        "harm_categories": set(),
        "total_prompts": 0,
        "chunk_size": chunk_size,
        "total_chunks": 0,
        "prompt_to_chunk_map": {}
    }

    # First, find IDs that exist in both unsteered and steered datasets
    unsteered_ids = set(str(entry['id']) for entry in data['unsteered_jailbreak'])
    steered_ids = set(str(entry['id']) for entry in data['steered_jailbreak'])

    # Only keep IDs that have both unsteered and steered data
    valid_ids = unsteered_ids & steered_ids

    print(f"  Found {len(valid_ids)} prompts with both unsteered and steered data")
    print(f"  Filtered out {len(unsteered_ids - valid_ids)} unsteered prompts without steered data")

    # Process data by prompt ID
    prompts_data = {}

    # Build unsteered data lookup by ID
    unsteered_jailbreak_by_id = {}
    for entry in data['unsteered_jailbreak']:
        prompt_id = str(entry['id'])
        if prompt_id in valid_ids:
            unsteered_jailbreak_by_id[prompt_id] = entry

    unsteered_default_by_id = {}
    for entry in data['unsteered_default']:
        prompt_id = str(entry['id'])
        if prompt_id in valid_ids:
            unsteered_default_by_id[prompt_id] = entry

    # Process unsteered jailbreak data first to set up prompt structure
    for prompt_id, entry in unsteered_jailbreak_by_id.items():
        # Truncate persona to first 10 words (plus ellipsis if truncated)
        persona = entry.get('persona', '')
        persona_words = persona.split()
        if len(persona_words) > 10:
            persona_truncated = ' '.join(persona_words[:10]) + '...'
        else:
            persona_truncated = persona

        # Extract safe fields only (excluding the harmful prompt field entirely)
        prompts_data[prompt_id] = {
            "id": prompt_id,
            "question": entry.get('question', ''),
            "persona": persona_truncated,
            "harm_category": entry.get('harm_category', ''),
            "responses": {}  # Will be organized by steering_type -> coeff -> jailbreak/default
        }

        # Initialize response structure for all steering types
        for st in steering_types:
            prompts_data[prompt_id]["responses"][st] = {}
            # Add unsteered at coeff 0 for each steering type
            prompts_data[prompt_id]["responses"][st]["0"] = {
                "jailbreak": {
                    "response": entry.get('response', ''),
                    "score": entry.get('score', '')
                }
            }

        # Add to index metadata
        if entry.get('harm_category'):
            index["harm_categories"].add(entry['harm_category'])

    # Add unsteered default responses
    for prompt_id, entry in unsteered_default_by_id.items():
        if prompt_id in prompts_data:
            for st in steering_types:
                if "0" in prompts_data[prompt_id]["responses"][st]:
                    prompts_data[prompt_id]["responses"][st]["0"]["default"] = {
                        "response": entry.get('response', ''),
                        "score": entry.get('score', '')
                    }

    # Process steered jailbreak data
    for entry in data['steered_jailbreak']:
        prompt_id = str(entry['id'])
        if prompt_id not in prompts_data:
            continue

        experiment_id = entry.get('experiment_id', '')
        steering_type, coeff = parse_experiment_id(experiment_id)

        if steering_type is None or coeff is None:
            continue

        coeff_str = str(coeff)

        if steering_type not in prompts_data[prompt_id]["responses"]:
            prompts_data[prompt_id]["responses"][steering_type] = {}

        if coeff_str not in prompts_data[prompt_id]["responses"][steering_type]:
            prompts_data[prompt_id]["responses"][steering_type][coeff_str] = {}

        prompts_data[prompt_id]["responses"][steering_type][coeff_str]["jailbreak"] = {
            "response": entry.get('response', ''),
            "score": entry.get('score', '')
        }

    # Process steered default data
    for entry in data['steered_default']:
        prompt_id = str(entry['id'])
        if prompt_id not in prompts_data:
            continue

        experiment_id = entry.get('experiment_id', '')
        steering_type, coeff = parse_experiment_id(experiment_id)

        if steering_type is None or coeff is None:
            continue

        coeff_str = str(coeff)

        if steering_type not in prompts_data[prompt_id]["responses"]:
            prompts_data[prompt_id]["responses"][steering_type] = {}

        if coeff_str not in prompts_data[prompt_id]["responses"][steering_type]:
            prompts_data[prompt_id]["responses"][steering_type][coeff_str] = {}

        prompts_data[prompt_id]["responses"][steering_type][coeff_str]["default"] = {
            "response": entry.get('response', ''),
            "score": entry.get('score', '')
        }

    # Remove prompts that ended up with no steered data (safety check)
    prompts_to_remove = []
    for prompt_id, prompt_data in prompts_data.items():
        has_steered = False
        for st, coeffs in prompt_data["responses"].items():
            for coeff, responses in coeffs.items():
                if coeff != "0" and responses:  # Has non-unsteered data
                    has_steered = True
                    break
            if has_steered:
                break
        if not has_steered:
            prompts_to_remove.append(prompt_id)

    for prompt_id in prompts_to_remove:
        del prompts_data[prompt_id]
        print(f"  Removed prompt {prompt_id} - no steered data found")

    # Save chunk files and build index
    prompt_items = list(prompts_data.items())
    chunks = []

    # Create chunks
    for i in range(0, len(prompt_items), chunk_size):
        chunk_data = []
        chunk_prompts = prompt_items[i:i + chunk_size]

        for prompt_id, prompt_data in chunk_prompts:
            chunk_data.append(prompt_data)
            # Add to prompt_to_chunk_map
            chunk_index = len(chunks)
            prompt_index_within_chunk = len(chunk_data) - 1
            index["prompt_to_chunk_map"][prompt_id] = {
                "chunk_index": chunk_index,
                "prompt_index": prompt_index_within_chunk
            }

        chunks.append(chunk_data)

    # Save chunk files
    for chunk_index, chunk_data in enumerate(chunks):
        chunk_file = chunks_dir / f"chunk_{chunk_index}.json"
        with open(chunk_file, 'w') as f:
            json.dump(chunk_data, f)

    # Add prompt IDs to index in sorted order
    for prompt_id, _ in prompt_items:
        index["prompt_ids"].append(prompt_id)

    # Finalize index
    index["prompt_ids"] = sorted(index["prompt_ids"], key=int)
    index["total_prompts"] = len(index["prompt_ids"])
    index["total_chunks"] = len(chunks)
    index["harm_categories"] = sorted(list(index["harm_categories"]))

    # Save index file
    index_file = model_output_dir / "index.json"
    with open(index_file, 'w') as f:
        json.dump(index, f, indent=2)

    print(f"  Created index with {index['total_prompts']} prompts")
    print(f"  Saved {index['total_chunks']} chunk files to {chunks_dir} (chunk size: {chunk_size})")
    print(f"  Index saved to {index_file}")

    return index


def main():
    parser = argparse.ArgumentParser(description='Prepare jailbreak evaluation data for viewer with chunked loading')
    parser.add_argument('--workspace-dir', type=Path, default=Path('/workspace'),
                        help='Workspace directory containing model data')
    parser.add_argument('--output-dir', type=Path, default=Path('/root/git/persona-subspace/viewer/evals/data/jailbreak'),
                        help='Output directory for processed data')
    parser.add_argument('--chunk-size', type=int, default=25,
                        help='Number of prompts per chunk file (default: 25)')
    args = parser.parse_args()

    # Create output directory if it doesn't exist
    args.output_dir.mkdir(parents=True, exist_ok=True)

    # Process each model directory
    models = ['llama-3.3-70b', 'gemma-2-27b', 'qwen-3-32b']

    for model_name in models:
        model_path = args.workspace_dir / model_name
        if model_path.exists():
            index_data = process_model_data(model_name, args.workspace_dir, args.output_dir, args.chunk_size)
            if index_data:
                print(f"  Successfully processed {model_name}")
                print()
        else:
            print(f"  Skipping {model_name} - directory not found")


if __name__ == "__main__":
    main()
