class JailbreakEvalViewer {
    constructor() {
        this.currentModel = null;
        this.currentEval = 'jailbreak';
        this.modelIndex = null;
        this.currentPromptIndex = 0;
        this.currentPromptData = null;
        this.promptCache = new Map();
        this.viewMode = 'prompt'; // 'prompt' or 'response'
        
        // DOM elements
        this.modelSelect = document.getElementById('model-select');
        this.evalSelect = document.getElementById('eval-select');
        this.loadBtn = document.getElementById('load-btn');
        this.statusBar = document.getElementById('status-bar');
        this.loadingOverlay = document.getElementById('loading-overlay');
        
        // View toggle
        this.viewPromptBtn = document.getElementById('view-prompt-btn');
        this.viewResponseBtn = document.getElementById('view-response-btn');
        this.promptView = document.getElementById('prompt-view');
        this.responseTypeView = document.getElementById('response-type-view');
        
        // Prompt view elements
        this.prevPromptBtn = document.getElementById('prev-prompt-btn');
        this.nextPromptBtn = document.getElementById('next-prompt-btn');
        this.currentPromptNum = document.getElementById('current-prompt-num');
        this.totalPrompts = document.getElementById('total-prompts');
        this.promptQuestion = document.getElementById('prompt-question');
        this.promptPersona = document.getElementById('prompt-persona');
        this.promptCategory = document.getElementById('prompt-category');
        this.jailbreakResponses = document.getElementById('jailbreak-responses');
        this.defaultResponses = document.getElementById('default-responses');
        
        // Response type view elements
        this.filterJailbreak = document.getElementById('filter-jailbreak');
        this.filterDefault = document.getElementById('filter-default');
        this.filterMagnitude = document.getElementById('filter-magnitude');
        this.filterScore = document.getElementById('filter-score');
        this.applyFiltersBtn = document.getElementById('apply-filters-btn');
        this.responsesContainer = document.getElementById('responses-container');
        
        this.initEventListeners();
        this.loadAvailableModels();
    }
    
    initEventListeners() {
        this.loadBtn.addEventListener('click', () => this.loadModelData());
        this.viewPromptBtn.addEventListener('click', () => this.switchView('prompt'));
        this.viewResponseBtn.addEventListener('click', () => this.switchView('response'));
        this.prevPromptBtn.addEventListener('click', () => this.navigatePrompt(-1));
        this.nextPromptBtn.addEventListener('click', () => this.navigatePrompt(1));
        this.applyFiltersBtn.addEventListener('click', () => this.applyFilters());
        
        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (this.viewMode === 'prompt' && this.modelIndex) {
                if (e.key === 'ArrowLeft') this.navigatePrompt(-1);
                if (e.key === 'ArrowRight') this.navigatePrompt(1);
            }
        });
    }
    
    async loadAvailableModels() {
        try {
            // In production, this would scan the data directory
            // For now, we'll check for known model directories
            const models = ['llama-3.3-70b', 'gemma-2-27b', 'qwen-3-32b'];
            
            // Check which models have data
            const availableModels = [];
            for (const model of models) {
                try {
                    const response = await fetch(`data/${model}/index.json`);
                    if (response.ok) {
                        availableModels.push(model);
                    }
                } catch (e) {
                    // Model data not available
                }
            }
            
            // Populate model select
            this.modelSelect.innerHTML = '<option value="">Select Model</option>';
            availableModels.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                this.modelSelect.appendChild(option);
            });
            
            if (availableModels.length === 0) {
                this.setStatus('No model data found. Please run the data preparation script first.', 'error');
            } else {
                this.setStatus(`Found ${availableModels.length} model(s) with data`, 'success');
            }
        } catch (error) {
            console.error('Error loading models:', error);
            this.setStatus('Error loading available models', 'error');
        }
    }
    
    async loadModelData() {
        const modelName = this.modelSelect.value;
        if (!modelName) {
            this.setStatus('Please select a model', 'error');
            return;
        }
        
        this.showLoading(true);
        this.setStatus(`Loading ${modelName} data...`, 'loading');
        
        try {
            // Load the index file
            const response = await fetch(`data/${modelName}/index.json`);
            if (!response.ok) {
                throw new Error(`Failed to load index for ${modelName}`);
            }
            
            this.modelIndex = await response.json();
            this.currentModel = modelName;
            this.currentPromptIndex = 0;
            this.promptCache.clear();
            
            // Update UI with model info
            this.totalPrompts.textContent = this.modelIndex.total_prompts;
            
            // Update magnitude filter options
            this.updateMagnitudeOptions();
            
            // Load first prompt
            await this.loadPrompt(0);
            
            // Show appropriate view
            if (this.viewMode === 'prompt') {
                this.promptView.classList.add('active');
            } else {
                this.responseTypeView.classList.add('active');
            }
            
            this.setStatus(`Loaded ${modelName} with ${this.modelIndex.total_prompts} prompts`, 'success');
        } catch (error) {
            console.error('Error loading model data:', error);
            this.setStatus(`Error loading ${modelName}: ${error.message}`, 'error');
        } finally {
            this.showLoading(false);
        }
    }
    
    async loadPrompt(index) {
        if (!this.modelIndex || index < 0 || index >= this.modelIndex.prompt_ids.length) {
            return;
        }
        
        const promptId = this.modelIndex.prompt_ids[index];
        
        // Check cache first
        if (this.promptCache.has(promptId)) {
            this.currentPromptData = this.promptCache.get(promptId);
            this.currentPromptIndex = index;  // Update index even when loading from cache!
            this.displayPrompt();
            return;
        }
        
        try {
            const response = await fetch(`data/${this.currentModel}/prompts/${promptId}.json`);
            if (!response.ok) {
                throw new Error(`Failed to load prompt ${promptId}`);
            }
            
            const promptData = await response.json();
            
            // Cache the prompt (limit cache size)
            if (this.promptCache.size > 50) {
                const firstKey = this.promptCache.keys().next().value;
                this.promptCache.delete(firstKey);
            }
            this.promptCache.set(promptId, promptData);
            
            this.currentPromptData = promptData;
            this.currentPromptIndex = index;
            this.displayPrompt();
            
            // Preload adjacent prompts
            this.preloadAdjacentPrompts(index);
        } catch (error) {
            console.error(`Error loading prompt ${promptId}:`, error);
            this.setStatus(`Error loading prompt: ${error.message}`, 'error');
        }
    }
    
    async preloadAdjacentPrompts(currentIndex) {
        // Preload previous and next prompts for smoother navigation
        const indicesToPreload = [currentIndex - 1, currentIndex + 1];
        
        for (const index of indicesToPreload) {
            if (index >= 0 && index < this.modelIndex.prompt_ids.length) {
                const promptId = this.modelIndex.prompt_ids[index];
                if (!this.promptCache.has(promptId)) {
                    fetch(`data/${this.currentModel}/prompts/${promptId}.json`)
                        .then(response => response.json())
                        .then(data => {
                            if (this.promptCache.size <= 50) {
                                this.promptCache.set(promptId, data);
                            }
                        })
                        .catch(() => {}); // Silent fail for preloading
                }
            }
        }
    }
    
    displayPrompt() {
        if (!this.currentPromptData) return;
        
        // Update prompt header
        this.currentPromptNum.textContent = this.currentPromptIndex + 1;
        this.promptQuestion.textContent = this.currentPromptData.question;
        this.promptPersona.textContent = this.currentPromptData.persona;
        this.promptCategory.textContent = this.currentPromptData.harm_category;
        
        // Display responses
        this.displayResponseCards('jailbreak');
        this.displayResponseCards('default');
        
        // Update navigation buttons
        this.prevPromptBtn.disabled = this.currentPromptIndex === 0;
        this.nextPromptBtn.disabled = this.currentPromptIndex >= this.modelIndex.prompt_ids.length - 1;
    }
    
    displayResponseCards(type) {
        const container = type === 'jailbreak' ? this.jailbreakResponses : this.defaultResponses;
        container.innerHTML = '';
        
        const responses = this.currentPromptData.responses;
        
        // Add unsteered response
        if (responses.unsteered && responses.unsteered[type]) {
            const card = this.createResponseCard('0.0', responses.unsteered[type]);
            container.appendChild(card);
        }
        
        // Add steered responses
        if (responses.steered) {
            // Use the order from the index (already sorted appropriately for each model)
            const magnitudes = this.modelIndex.magnitudes ? 
                this.modelIndex.magnitudes.map(m => m.toString()) :
                Object.keys(responses.steered).sort((a, b) => parseFloat(b) - parseFloat(a));
            
            for (const magnitude of magnitudes) {
                if (responses.steered[magnitude] && responses.steered[magnitude][type]) {
                    const card = this.createResponseCard(magnitude, responses.steered[magnitude][type]);
                    container.appendChild(card);
                }
            }
        }
    }
    
    createResponseCard(magnitude, responseData) {
        const card = document.createElement('div');
        card.className = 'response-card';
        
        const header = document.createElement('div');
        header.className = 'response-header';
        
        const magLabel = document.createElement('span');
        magLabel.className = 'magnitude-label';
        magLabel.textContent = magnitude === '0.0' ? 'Unsteered' : `Magnitude: ${magnitude}`;
        
        const scoreBadge = document.createElement('span');
        scoreBadge.className = `score-badge ${responseData.score}`;
        
        // Map score types to display labels
        const scoreLabels = {
            "refusal": "REFUSAL",
            "refusal_and_justification": "REFUSAL & JUSTIFICATION",
            "nonsensical": "NONSENSICAL",
            "out_of_context": "OUT OF CONTEXT",
            "related_but_no_info": "RELATED",
            "almost_enough_info": "ALMOST HARMFUL",
            "enough_info": "HARMFUL INFO",
            "enough_info_and_follow_perfectly": "HARMFUL & FULLY OBEYING",
            "other": "OTHER"
        };
        
        scoreBadge.textContent = scoreLabels[responseData.score] || responseData.score.replace(/_/g, ' ').toUpperCase();
        
        header.appendChild(magLabel);
        header.appendChild(scoreBadge);
        
        const content = document.createElement('div');
        content.className = 'response-content';
        // Render markdown if marked is available
        if (typeof marked !== 'undefined') {
            content.innerHTML = marked.parse(responseData.response);
        } else {
            content.textContent = responseData.response;
        }
        
        card.appendChild(header);
        card.appendChild(content);
        
        return card;
    }
    
    navigatePrompt(direction) {
        const newIndex = this.currentPromptIndex + direction;
        if (newIndex >= 0 && newIndex < this.modelIndex.prompt_ids.length) {
            this.loadPrompt(newIndex);
        }
    }
    
    switchView(mode) {
        this.viewMode = mode;
        
        if (mode === 'prompt') {
            this.viewPromptBtn.classList.add('active');
            this.viewResponseBtn.classList.remove('active');
            this.promptView.classList.add('active');
            this.responseTypeView.classList.remove('active');
        } else {
            this.viewPromptBtn.classList.remove('active');
            this.viewResponseBtn.classList.add('active');
            this.promptView.classList.remove('active');
            this.responseTypeView.classList.add('active');
            
            if (this.modelIndex) {
                this.loadFilteredResponses();
            }
        }
    }
    
    updateMagnitudeOptions() {
        if (!this.modelIndex) return;
        
        this.filterMagnitude.innerHTML = '<option value="all">All Magnitudes</option>';
        this.filterMagnitude.innerHTML += '<option value="0">Unsteered (0.0)</option>';
        
        if (this.modelIndex.magnitudes) {
            this.modelIndex.magnitudes.forEach(mag => {
                const option = document.createElement('option');
                option.value = mag;
                option.textContent = `Magnitude: ${mag}`;
                this.filterMagnitude.appendChild(option);
            });
        }
    }
    
    async applyFilters() {
        if (!this.modelIndex) {
            this.setStatus('Please load a model first', 'error');
            return;
        }
        
        await this.loadFilteredResponses();
    }
    
    async loadFilteredResponses() {
        this.showLoading(true);
        this.setStatus('Applying filters...', 'loading');
        
        const includeJailbreak = this.filterJailbreak.checked;
        const includeDefault = this.filterDefault.checked;
        const magnitudeFilter = this.filterMagnitude.value;
        const scoreFilter = this.filterScore.value;
        
        this.responsesContainer.innerHTML = '';
        
        try {
            let displayCount = 0;
            const maxDisplay = 50; // Limit number of displayed responses
            const maxPromptsToCheck = 200; // Limit how many prompts we check
            let promptsChecked = 0;
            
            // Use a random sample of prompts for better diversity
            const promptIds = [...this.modelIndex.prompt_ids];
            const shuffled = promptIds.sort(() => Math.random() - 0.5);
            
            for (const promptId of shuffled) {
                if (displayCount >= maxDisplay) break;
                if (promptsChecked >= maxPromptsToCheck) break;
                promptsChecked++;
                
                // Load prompt data if not cached
                let promptData;
                if (this.promptCache.has(promptId)) {
                    promptData = this.promptCache.get(promptId);
                } else {
                    try {
                        const response = await fetch(`data/${this.currentModel}/prompts/${promptId}.json`);
                        if (!response.ok) continue;
                        promptData = await response.json();
                        
                        // Cache it
                        if (this.promptCache.size <= 50) {
                            this.promptCache.set(promptId, promptData);
                        }
                    } catch (e) {
                        continue; // Skip this prompt if loading fails
                    }
                }
                
                // Filter and display responses
                const matchingResponses = this.filterPromptResponses(
                    promptData, 
                    includeJailbreak, 
                    includeDefault, 
                    magnitudeFilter, 
                    scoreFilter
                );
                
                for (const response of matchingResponses) {
                    if (displayCount >= maxDisplay) break;
                    
                    const box = this.createResponseBox(promptData, response);
                    this.responsesContainer.appendChild(box);
                    displayCount++;
                }
            }
            
            if (displayCount === 0) {
                this.responsesContainer.innerHTML = '<p>No responses match the selected filters.</p>';
            }
            
            this.setStatus(`Showing ${displayCount} filtered responses`, 'success');
        } catch (error) {
            console.error('Error loading filtered responses:', error);
            this.setStatus('Error applying filters', 'error');
        } finally {
            this.showLoading(false);
        }
    }
    
    filterPromptResponses(promptData, includeJailbreak, includeDefault, magnitudeFilter, scoreFilter) {
        const results = [];
        
        // Check unsteered responses
        if (magnitudeFilter === 'all' || magnitudeFilter === '0') {
            if (includeJailbreak && promptData.responses.unsteered?.jailbreak) {
                const response = promptData.responses.unsteered.jailbreak;
                if (scoreFilter === 'all' || response.score === scoreFilter) {
                    results.push({
                        type: 'jailbreak',
                        magnitude: '0.0',
                        ...response
                    });
                }
            }
            
            if (includeDefault && promptData.responses.unsteered?.default) {
                const response = promptData.responses.unsteered.default;
                if (scoreFilter === 'all' || response.score === scoreFilter) {
                    results.push({
                        type: 'default',
                        magnitude: '0.0',
                        ...response
                    });
                }
            }
        }
        
        // Check steered responses
        if (promptData.responses.steered) {
            for (const [magnitude, responses] of Object.entries(promptData.responses.steered)) {
                if (magnitudeFilter !== 'all' && magnitudeFilter !== magnitude) continue;
                
                if (includeJailbreak && responses.jailbreak) {
                    if (scoreFilter === 'all' || responses.jailbreak.score === scoreFilter) {
                        results.push({
                            type: 'jailbreak',
                            magnitude,
                            ...responses.jailbreak
                        });
                    }
                }
                
                if (includeDefault && responses.default) {
                    if (scoreFilter === 'all' || responses.default.score === scoreFilter) {
                        results.push({
                            type: 'default',
                            magnitude,
                            ...responses.default
                        });
                    }
                }
            }
        }
        
        return results;
    }
    
    createResponseBox(promptData, response) {
        const box = document.createElement('div');
        box.className = 'response-box';
        
        const header = document.createElement('div');
        header.className = 'response-box-header';
        
        const question = document.createElement('div');
        question.className = 'response-box-question';
        question.textContent = promptData.question.substring(0, 100) + 
                              (promptData.question.length > 100 ? '...' : '');
        
        const metadata = document.createElement('div');
        metadata.className = 'response-box-metadata';
        // Map score types to display labels
        const scoreLabels = {
            "refusal": "REFUSAL",
            "refusal_and_justification": "REFUSAL & JUSTIFICATION",
            "nonsensical": "NONSENSICAL",
            "out_of_context": "OUT OF CONTEXT",
            "related_but_no_info": "RELATED",
            "almost_enough_info": "ALMOST HARMFUL",
            "enough_info": "HARMFUL INFO",
            "enough_info_and_follow_perfectly": "HARMFUL & FULLY OBEYING",
            "other": "OTHER"
        };
        
        metadata.innerHTML = `
            <span>Type: ${response.type}</span>
            <span>Magnitude: ${response.magnitude}</span>
            <span class="score-badge ${response.score}">${scoreLabels[response.score] || response.score.replace(/_/g, ' ').toUpperCase()}</span>
        `;
        
        const content = document.createElement('div');
        content.className = 'response-box-content';
        // Render markdown if marked is available
        if (typeof marked !== 'undefined') {
            content.innerHTML = marked.parse(response.response);
        } else {
            content.textContent = response.response;
        }
        
        header.appendChild(question);
        header.appendChild(metadata);
        box.appendChild(header);
        box.appendChild(content);
        
        return box;
    }
    
    setStatus(message, type = '') {
        this.statusBar.textContent = message;
        this.statusBar.className = `status-bar ${type}`;
    }
    
    showLoading(show) {
        if (show) {
            this.loadingOverlay.classList.add('active');
        } else {
            this.loadingOverlay.classList.remove('active');
        }
    }
}

// Initialize the viewer when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new JailbreakEvalViewer();
});