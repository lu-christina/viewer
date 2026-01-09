#!/usr/bin/env python3
"""
Data preparation script for Susceptibility Evaluation Viewer.
Converts raw susceptibility evaluation data into chunked format for the viewer.

Data sources:
- Unsteered: /root/git/persona-subspace/evals/susceptibility/{model}/unsteered/
- Steered: /workspace/{model}/evals/results/
"""

import json
import os
import sys
from collections import defaultdict
from pathlib import Path


def normalize_score(score):
    """Normalize score values to ensure consistency with viewer expectations."""
    if not score:
        return score

    # Normalize weird_ai to weird_role
    if score == 'weird_ai':
        return 'weird_role'

    return score


def extract_system_prompt(full_prompt, question, role):
    """Extract system prompt by removing the question from the full prompt."""
    if not full_prompt or not question:
        return full_prompt or ""

    # For default role, if prompt equals question, use a standard description
    if role == 'default' and full_prompt == question:
        return "Default Assistant response with no specific system prompt"

    # Remove question from end of prompt
    if full_prompt.endswith(question):
        system_prompt = full_prompt[:-len(question)].strip()
        # Clean up any trailing punctuation or whitespace
        return system_prompt.rstrip('. ')

    return full_prompt


def load_jsonl(file_path):
    """Load data from a JSONL file."""
    data = []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line:
                    data.append(json.loads(line))
    except FileNotFoundError:
        print(f"Warning: File not found: {file_path}")
    except Exception as e:
        print(f"Error loading {file_path}: {e}")

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


def group_by_id_and_question(data):
    """Group data by ID, sample_id and question_id to pair steered/unsteered responses."""
    grouped = defaultdict(lambda: defaultdict(list))

    for entry in data:
        entry_id = entry.get('id')
        sample_id = entry.get('sample_id', 0)
        question_id = entry.get('question_id')
        if entry_id is not None and question_id is not None:
            # Use (id, sample_id) as the grouping key
            composite_id = (entry_id, sample_id)
            grouped[composite_id][question_id].append(entry)

    return grouped


def create_response_structure(entries, steering_types):
    """Create response structure organized by steering_type -> coeff."""
    responses = {st: {} for st in steering_types}

    for entry in entries:
        magnitude = entry.get('magnitude')
        experiment_id = entry.get('experiment_id')

        response_data = {
            'response': entry.get('response', ''),
            'score': normalize_score(entry.get('score', '')),
        }

        if magnitude is not None and magnitude == 0.0:
            # Unsteered entry - add to all steering types at coeff 0
            for st in steering_types:
                responses[st]["0"] = response_data
        elif experiment_id:
            # Steered entry - parse experiment_id
            steering_type, coeff = parse_experiment_id(experiment_id)
            if steering_type and coeff is not None:
                coeff_str = str(coeff)
                if steering_type not in responses:
                    responses[steering_type] = {}
                responses[steering_type][coeff_str] = response_data

    return responses


def chunk_data(data, chunk_size=25):
    """Split data into chunks of specified size."""
    chunks = []
    for i in range(0, len(data), chunk_size):
        chunks.append(data[i:i + chunk_size])
    return chunks


def process_model(model_name, unsteered_dir, steered_dir, output_dir):
    """Process data for a single model."""
    print(f"Processing model: {model_name}")

    model_unsteered_dir = Path(unsteered_dir) / model_name / 'unsteered'
    model_steered_dir = Path(steered_dir) / model_name / 'evals' / 'results'
    model_output_dir = Path(output_dir) / model_name

    # Create output directories
    model_output_dir.mkdir(parents=True, exist_ok=True)
    chunks_dir = model_output_dir / 'chunks'
    chunks_dir.mkdir(exist_ok=True)

    # Load unsteered data
    unsteered_susceptibility = load_jsonl(model_unsteered_dir / 'susceptibility_50_scores.jsonl')
    unsteered_default = load_jsonl(model_unsteered_dir / 'default_50_scores.jsonl')

    # Load steered data
    steered_susceptibility = load_jsonl(model_steered_dir / 'rp_pc1_contrast_susceptibility_50_scores.jsonl')
    steered_default = load_jsonl(model_steered_dir / 'rp_pc1_contrast_default_50_scores.jsonl')

    print(f"  Loaded {len(unsteered_susceptibility)} unsteered susceptibility entries")
    print(f"  Loaded {len(unsteered_default)} unsteered default entries")
    print(f"  Loaded {len(steered_susceptibility)} steered susceptibility entries")
    print(f"  Loaded {len(steered_default)} steered default entries")

    # Combine steered and unsteered data
    all_susceptibility = steered_susceptibility + unsteered_susceptibility
    all_default = steered_default + unsteered_default

    if not all_susceptibility and not all_default:
        print(f"Warning: No data found for model {model_name}")
        return

    # Get all unique steering types and coefficients from steered data
    steering_types = set()
    coefficients_by_type = defaultdict(set)

    for entry in steered_susceptibility + steered_default:
        experiment_id = entry.get('experiment_id', '')
        steering_type, coeff = parse_experiment_id(experiment_id)
        if steering_type and coeff is not None:
            steering_types.add(steering_type)
            coefficients_by_type[steering_type].add(coeff)

    # Add 0 (unsteered) to all steering types
    for st in steering_types:
        coefficients_by_type[st].add(0)

    steering_types = sorted(list(steering_types))
    print(f"  Found steering types: {steering_types}")

    # Group data by ID and question
    susceptibility_grouped = group_by_id_and_question(all_susceptibility)
    default_grouped = group_by_id_and_question(all_default)

    # Process data by question (0-4)
    questions_data = {}
    total_questions = 5

    for question_id in range(total_questions):
        question_str = str(question_id)

        # Process role-prompted (susceptibility) data for this question
        role_entries = []
        for composite_id, questions in susceptibility_grouped.items():
            if question_id in questions:
                entries = questions[question_id]
                if entries:
                    # Get question text and system prompt from first entry
                    first_entry = entries[0]
                    question_text = first_entry.get('question', '')
                    full_prompt = first_entry.get('prompt', '')
                    role = first_entry.get('role', 'unknown')
                    system_prompt = extract_system_prompt(full_prompt, question_text, role)

                    # Create structured entry - use composite ID as unique identifier
                    structured_entry = {
                        'id': f"{composite_id[0]}_{composite_id[1]}",  # Format: "id_sampleid"
                        'role': role,
                        'question': question_text,
                        'system_prompt': system_prompt,
                        'prompt_id': first_entry.get('prompt_id', 0),  # Include for sorting
                        'responses': create_response_structure(entries, steering_types)
                    }
                    role_entries.append(structured_entry)

        # Process default assistant data for this question
        default_entries = []
        for composite_id, questions in default_grouped.items():
            if question_id in questions:
                entries = questions[question_id]
                if entries:
                    # Get question text and system prompt from first entry
                    first_entry = entries[0]
                    question_text = first_entry.get('question', '')
                    full_prompt = first_entry.get('prompt', '')
                    role = 'default'
                    system_prompt = extract_system_prompt(full_prompt, question_text, role)

                    # Create structured entry - use composite ID as unique identifier
                    structured_entry = {
                        'id': f"{composite_id[0]}_{composite_id[1]}",  # Format: "id_sampleid"
                        'role': 'default',
                        'question': question_text,
                        'system_prompt': system_prompt,
                        'prompt_id': first_entry.get('prompt_id', 0),  # Include for sorting
                        'responses': create_response_structure(entries, steering_types)
                    }
                    default_entries.append(structured_entry)

        # Sort entries by prompt_id then ID for consistent ordering
        role_entries.sort(key=lambda x: (x.get('prompt_id', 0), x['id']))
        default_entries.sort(key=lambda x: (x.get('prompt_id', 0), x['id']))

        # Create chunks for role-prompted and default data
        role_chunks = chunk_data(role_entries)
        default_chunks = chunk_data(default_entries)

        # Save chunks and collect chunk names
        role_chunk_names = []
        for i, chunk in enumerate(role_chunks):
            chunk_name = f"q{question_id}_role_{i}"
            chunk_file = chunks_dir / f"{chunk_name}.json"
            with open(chunk_file, 'w', encoding='utf-8') as f:
                json.dump(chunk, f, indent=2, ensure_ascii=False)
            role_chunk_names.append(chunk_name)

        default_chunk_names = []
        for i, chunk in enumerate(default_chunks):
            chunk_name = f"q{question_id}_default_{i}"
            chunk_file = chunks_dir / f"{chunk_name}.json"
            with open(chunk_file, 'w', encoding='utf-8') as f:
                json.dump(chunk, f, indent=2, ensure_ascii=False)
            default_chunk_names.append(chunk_name)

        questions_data[question_str] = {
            'role_prompted_chunks': role_chunk_names,
            'default_chunks': default_chunk_names
        }

        print(f"  Question {question_id}: {len(role_entries)} role entries, {len(default_entries)} default entries")

    # Create index file
    index_data = {
        'model': model_name,
        'eval': 'susceptibility',
        'total_questions': total_questions,
        'steering_types': steering_types,
        'coefficients': {st: sorted(list(coeffs)) for st, coeffs in coefficients_by_type.items()},
        'questions': questions_data
    }

    index_file = model_output_dir / 'index.json'
    with open(index_file, 'w', encoding='utf-8') as f:
        json.dump(index_data, f, indent=2, ensure_ascii=False)

    print(f"  Created index with steering types: {steering_types}")
    return index_data


def main():
    unsteered_dir = Path('/root/git/persona-subspace/evals/susceptibility')
    steered_dir = Path('/workspace')
    output_dir = Path('/root/git/persona-subspace/viewer/evals/data/susceptibility')

    print(f"Unsteered directory: {unsteered_dir}")
    print(f"Steered directory: {steered_dir}")
    print(f"Output directory: {output_dir}")

    # Find available models
    models = ['llama-3.3-70b', 'gemma-2-27b', 'qwen-3-32b']

    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)

    # Process each model
    for model in models:
        # Check if both unsteered and steered directories exist
        model_unsteered = unsteered_dir / model / 'unsteered'
        model_steered = steered_dir / model / 'evals' / 'results'

        if not model_unsteered.exists():
            print(f"Skipping {model} - unsteered directory not found: {model_unsteered}")
            continue
        if not model_steered.exists():
            print(f"Skipping {model} - steered directory not found: {model_steered}")
            continue

        try:
            process_model(model, unsteered_dir, steered_dir, output_dir)
            print(f"Successfully processed {model}")
        except Exception as e:
            print(f"Error processing {model}: {e}")
            import traceback
            traceback.print_exc()

    print(f"\nData preparation complete. Output saved to: {output_dir}")


if __name__ == '__main__':
    main()
