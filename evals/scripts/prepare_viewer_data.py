#!/usr/bin/env python3
"""
Script to transform jailbreak evaluation data for the viewer.
Creates an index file and individual prompt files for lazy loading.
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


def process_model_data(model_dir, output_dir):
    """Process all data files for a given model with lazy loading structure."""
    model_name = model_dir.name
    print(f"Processing model: {model_name}")
    
    # File paths
    unsteered_dir = model_dir / "unsteered"
    steered_dir = model_dir / "steered"
    
    files = {
        'unsteered_jailbreak': unsteered_dir / "unsteered_scores.jsonl",
        'unsteered_default': unsteered_dir / "unsteered_default_scores.jsonl",
        'steered_jailbreak': steered_dir / "jailbreak_1100_scores.jsonl",
        'steered_default': steered_dir / "default_1100_scores.jsonl"
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
    
    # Create prompts subdirectory for individual prompt files
    prompts_dir = model_output_dir / "prompts"
    prompts_dir.mkdir(parents=True, exist_ok=True)
    
    # Build index structure
    index = {
        "model": model_name,
        "eval": "jailbreak",
        "prompt_ids": [],
        "magnitudes": [],
        "harm_categories": set(),
        "total_prompts": 0
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
    
    # Process unsteered jailbreak data first
    for entry in data['unsteered_jailbreak']:
        prompt_id = str(entry['id'])
        
        # Skip if this ID doesn't have steered data
        if prompt_id not in valid_ids:
            continue
        
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
            "responses": {
                "unsteered": {
                    "jailbreak": {
                        "response": entry.get('response', ''),
                        "score": entry.get('score', '')
                    }
                }
            }
        }
        
        # Add to index metadata
        if entry.get('harm_category'):
            index["harm_categories"].add(entry['harm_category'])
    
    # Add unsteered default responses
    for entry in data['unsteered_default']:
        prompt_id = str(entry['id'])
        if prompt_id in prompts_data:  # Will only be true if ID is in valid_ids
            prompts_data[prompt_id]["responses"]["unsteered"]["default"] = {
                "response": entry.get('response', ''),
                "score": entry.get('score', '')
            }
    
    # Process steered data
    steered_by_magnitude = defaultdict(lambda: {"jailbreak": {}, "default": {}})
    
    for entry in data['steered_jailbreak']:
        prompt_id = str(entry['id'])
        magnitude_value = entry.get('magnitude', 0)
        magnitude = str(int(magnitude_value))
        steered_by_magnitude[magnitude]["jailbreak"][prompt_id] = {
            "response": entry.get('response', ''),
            "score": entry.get('score', '')
        }
    
    for entry in data['steered_default']:
        prompt_id = str(entry['id'])
        magnitude_value = entry.get('magnitude', 0)
        magnitude = str(int(magnitude_value))
        steered_by_magnitude[magnitude]["default"][prompt_id] = {
            "response": entry.get('response', ''),
            "score": entry.get('score', '')
        }
    
    # Add steered responses to prompts data
    for prompt_id in prompts_data:
        prompts_data[prompt_id]["responses"]["steered"] = {}
        
        for magnitude in sorted(steered_by_magnitude.keys(), key=lambda x: float(x), reverse=True):
            mag_data = steered_by_magnitude[magnitude]
            
            if prompt_id in mag_data["jailbreak"] or prompt_id in mag_data["default"]:
                prompts_data[prompt_id]["responses"]["steered"][magnitude] = {}
                
                if prompt_id in mag_data["jailbreak"]:
                    prompts_data[prompt_id]["responses"]["steered"][magnitude]["jailbreak"] = \
                        mag_data["jailbreak"][prompt_id]
                
                if prompt_id in mag_data["default"]:
                    prompts_data[prompt_id]["responses"]["steered"][magnitude]["default"] = \
                        mag_data["default"][prompt_id]
    
    # Remove prompts that ended up with no steered data (safety check)
    prompts_to_remove = []
    for prompt_id, prompt_data in prompts_data.items():
        if not prompt_data["responses"]["steered"]:  # Empty dict
            prompts_to_remove.append(prompt_id)
    
    for prompt_id in prompts_to_remove:
        del prompts_data[prompt_id]
        print(f"  Removed prompt {prompt_id} - no steered data found")
    
    # Save individual prompt files and build index
    for prompt_id, prompt_data in prompts_data.items():
        # Save individual prompt file
        prompt_file = prompts_dir / f"{prompt_id}.json"
        with open(prompt_file, 'w') as f:
            json.dump(prompt_data, f)
        
        # Add to index
        index["prompt_ids"].append(prompt_id)
    
    # Finalize index
    index["prompt_ids"] = sorted(index["prompt_ids"], key=int)
    index["total_prompts"] = len(index["prompt_ids"])
    index["harm_categories"] = sorted(list(index["harm_categories"]))
    
    # Get unique magnitudes and sort based on model type
    all_magnitudes = set()
    for prompt_data in prompts_data.values():
        if "steered" in prompt_data["responses"]:
            all_magnitudes.update(prompt_data["responses"]["steered"].keys())
    
    # Sort magnitudes based on model
    # Llama: ascending order (3, 6, 9, 12, 15, 18, 21, 24)
    # Qwen/Gemma: descending order (high to low negative values)
    if 'llama' in model_name.lower():
        index["magnitudes"] = sorted([float(m) for m in all_magnitudes], reverse=False)  # Ascending
    else:  # qwen, gemma
        index["magnitudes"] = sorted([float(m) for m in all_magnitudes], reverse=True)  # Descending
    
    # Save index file
    index_file = model_output_dir / "index.json"
    with open(index_file, 'w') as f:
        json.dump(index, f, indent=2)
    
    print(f"  Created index with {index['total_prompts']} prompts")
    print(f"  Saved individual prompt files to {prompts_dir}")
    print(f"  Index saved to {index_file}")
    
    return index


def main():
    parser = argparse.ArgumentParser(description='Prepare jailbreak evaluation data for viewer with lazy loading')
    parser.add_argument('--input-dir', type=Path, default=Path('/root/git/persona-subspace/evals/jailbreak'),
                        help='Directory containing model evaluation data')
    parser.add_argument('--output-dir', type=Path, default=Path('/root/git/persona-subspace/viewer/evals/data'),
                        help='Output directory for processed data')
    args = parser.parse_args()
    
    # Create output directory if it doesn't exist
    args.output_dir.mkdir(parents=True, exist_ok=True)
    
    # Process each model directory
    model_dirs = [d for d in args.input_dir.iterdir() if d.is_dir() and d.name not in ['scripts', 'viewer']]
    
    for model_dir in model_dirs:
        index_data = process_model_data(model_dir, args.output_dir)
        if index_data:
            print(f"  Successfully processed {model_dir.name}")
            print()


if __name__ == "__main__":
    main()