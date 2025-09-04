# Susceptibility Viewer Implementation Plan

## Requirements

### Data Structure
- **Question-centric organization**: Navigate by question (1-5), then cycle through role variants within each question
- **Separate datasets**: Role-prompted (100 per question) and Default (10 per question) are independent
- **Steering magnitude pairing**: Same ID has unsteered + steered responses (like jailbreak)
- **No role/default pairing**: Role and default responses cycle independently

### Visual Layout (Exact Copy of Jailbreak)
- **Same HTML structure**: Use jailbreak.html as template, just change labels
- **Same CSS classes**: `prompt-view`, `responses-grid`, `response-card`, etc.
- **Same navigation**: Two navigation bars (Question nav + Role nav)
- **Same response display**: Two horizontal rows of cards (Role-Prompted + Default Assistant)

### Navigation Flow
1. **Question Navigation**: ← Previous Question | Question X/5 | Next Question →
2. **Role Navigation**: ← Previous Role | Role X/100 | Next Role → (independent cycling and buttons above each Row)
3. **Response Display**: 
   - Row 1: "Role-Prompted" - all steering magnitudes horizontally for current role
   - Row 2: "Default Assistant" - all steering magnitudes horizontally for current default (cycles independently)

### Data Preparation Script Structure
```json
// Index: question_chunks
{
  "0": {
    "role_prompted_chunks": ["q0_role_0", "q0_role_1"], // ~100 entries
    "default_chunks": ["q0_default_0", "q0_default_1", ...] // ~10 entries
  }
}

// Chunk: q0_role_0.json
[
  {
    "id": "accountant_0",
    "role": "accountant",
    "question_id": 0,
    "question": "Who are you?",
    "responses": {
      "unsteered": {"response": "...", "score": ""},
      "steered": {
        "-2.0": {"response": "...", "score": "", "magnitude": -2.0},
        "-4.0": {"response": "...", "score": "", "magnitude": -4.0},
        // ... all steering magnitudes
      }
    }
  }
]
```

## Implementation Steps

### 1. Copy jailbreak.html → susceptibility.html
- Change title to "Susceptibility Evaluation Viewer"  
- Change labels: "Jailbreak" → "Role-Prompted", "No Jailbreak" → "Default Assistant"
- Change metadata: "Persona" → "Role", remove "Category"
- Keep exact same CSS and HTML structure

### 2. Copy jailbreak.js → susceptibility.js  
- Change class name to `SusceptibilityEvalViewer`
- Change navigation logic for questions instead of prompts
- Load role + default data separately for current question
- Independent cycling: role and default responses cycle separately with different buttons
- Same response card display logic (horizontal magnitudes)

### 3. New data preparation script
- Ensure question-centric chunking
- Separate role/default chunks 
- Same data structure as jailbreak (unsteered + steered per ID)
- No scores for now
- Extract the fields: id, question, prompt (which should remove the end of the string that is the question field), response
- Default responses in default_50.jsonl and role-prompted responses in susceptibility_50.jsonl
- Steered and unsteered responses paired by ID

### 4. Key Differences from Jailbreak
- **Navigation**: Question-based (5 questions) instead of prompt-based (1000+ prompts)
- **Role cycling**: Within each question, cycle through role variants for role-prompted and default separately
- **Independent datasets**: Role and default are separate, not paired responses to same prompt
- **Labels**: "Role-Prompted" vs "Default Assistant" instead of "Jailbreak" vs "No Jailbreak"

## Success Criteria
- [ ] Page looks identical to jailbreak.html
- [ ] Shows multiple steering magnitude cards horizontally 
- [ ] Question navigation works (1-5)
- [ ] Role navigation works within question (1-100 role-prompted and 1-10 default)
- [ ] Default responses cycle independently from role responses
- [ ] All steering coefficients display properly (-16.0, -14.0, ..., 4.0)