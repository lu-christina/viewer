class JailbreakEvalViewer {
    constructor() {
        this.currentModel = null;
        this.currentEval = 'jailbreak';
        this.modelIndex = null;
        this.currentPromptIndex = 0;
        this.currentPromptData = null;
        this.chunkCache = new Map(); // Cache chunks instead of individual prompts
        this.viewMode = 'prompt'; // 'prompt' or 'response'
        this.currentFilterIndex = 0; // Track position for loading more filtered results
        this.isUpdatingUrl = false; // Prevent infinite loops when updating URL
        
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
        this.loadAvailableModels().then(() => {
            this.initFromUrl();
        });
    }
    
    initEventListeners() {
        this.loadBtn.addEventListener('click', () => this.loadModelData());
        this.viewPromptBtn.addEventListener('click', () => this.switchView('prompt'));
        this.viewResponseBtn.addEventListener('click', () => this.switchView('response'));
        this.prevPromptBtn.addEventListener('click', () => this.navigatePrompt(-1));
        this.nextPromptBtn.addEventListener('click', () => this.navigatePrompt(1));
        this.applyFiltersBtn.addEventListener('click', () => this.applyFilters());
        
        // Update URL when model/eval changes
        this.modelSelect.addEventListener('change', () => {
            this.currentModel = this.modelSelect.value;
            this.updateUrl();
        });
        this.evalSelect.addEventListener('change', () => {
            this.currentEval = this.evalSelect.value;
            this.updateUrl();
        });
        
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
                    const response = await fetch(`data/jailbreak/${model}/index.json`);
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
            const response = await fetch(`data/jailbreak/${modelName}/index.json`);
            if (!response.ok) {
                throw new Error(`Failed to load index for ${modelName}`);
            }
            
            this.modelIndex = await response.json();
            this.currentModel = modelName;
            this.currentPromptIndex = 0;
            this.chunkCache.clear();
            
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
            this.updateUrl();
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
        
        // Get chunk information for this prompt
        const chunkInfo = this.modelIndex.prompt_to_chunk_map[promptId];
        if (!chunkInfo) {
            console.error(`No chunk information found for prompt ${promptId}`);
            return;
        }
        
        const chunkIndex = chunkInfo.chunk_index;
        const promptIndexInChunk = chunkInfo.prompt_index;
        
        // Check if chunk is already cached
        if (this.chunkCache.has(chunkIndex)) {
            const chunkData = this.chunkCache.get(chunkIndex);
            this.currentPromptData = chunkData[promptIndexInChunk];
            this.currentPromptIndex = index;
            this.displayPrompt();
            return;
        }
        
        try {
            const response = await fetch(`data/jailbreak/${this.currentModel}/chunks/chunk_${chunkIndex}.json`);
            if (!response.ok) {
                throw new Error(`Failed to load chunk ${chunkIndex}`);
            }
            
            const chunkData = await response.json();
            
            // Cache the chunk (limit cache size to ~10 chunks = ~250 prompts)
            if (this.chunkCache.size > 10) {
                const firstKey = this.chunkCache.keys().next().value;
                this.chunkCache.delete(firstKey);
            }
            this.chunkCache.set(chunkIndex, chunkData);
            
            this.currentPromptData = chunkData[promptIndexInChunk];
            this.currentPromptIndex = index;
            this.displayPrompt();
            this.updateUrl();
            
            // Preload adjacent chunks
            this.preloadAdjacentChunks(chunkIndex);
        } catch (error) {
            console.error(`Error loading chunk ${chunkIndex}:`, error);
            this.setStatus(`Error loading prompt: ${error.message}`, 'error');
        }
    }
    
    async preloadAdjacentChunks(currentChunkIndex) {
        // Preload previous and next chunks for smoother navigation
        const chunksToPreload = [currentChunkIndex - 1, currentChunkIndex + 1];
        
        for (const chunkIndex of chunksToPreload) {
            if (chunkIndex >= 0 && chunkIndex < this.modelIndex.total_chunks) {
                if (!this.chunkCache.has(chunkIndex)) {
                    fetch(`data/jailbreak/${this.currentModel}/chunks/chunk_${chunkIndex}.json`)
                        .then(response => response.json())
                        .then(data => {
                            if (this.chunkCache.size <= 10) {
                                this.chunkCache.set(chunkIndex, data);
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
        
        // Use the unified magnitude order from the index (includes 0.0 in proper position)
        const magnitudes = this.modelIndex.magnitudes ? 
            this.modelIndex.magnitudes.map(m => m.toString()) :
            // Fallback if no magnitudes in index
            Object.keys(responses.steered || {}).sort((a, b) => parseFloat(b) - parseFloat(a));
        
        for (const magnitude of magnitudes) {
            let responseData = null;
            
            // Handle unsteered (0.0 or 0) response
            if (magnitude === '0' || magnitude === '0.0') {
                if (responses.unsteered && responses.unsteered[type]) {
                    responseData = responses.unsteered[type];
                }
            } 
            // Handle steered responses
            else if (responses.steered && responses.steered[magnitude] && responses.steered[magnitude][type]) {
                responseData = responses.steered[magnitude][type];
            }
            
            if (responseData) {
                const card = this.createResponseCard(magnitude, responseData);
                container.appendChild(card);
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
        magLabel.textContent = magnitude === '0.0' || magnitude === '0' ? 'Unsteered' : `Steering Coefficient: ${magnitude}`;
        
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
        this.updateUrl();
    }
    
    updateMagnitudeOptions() {
        if (!this.modelIndex) return;
        
        this.filterMagnitude.innerHTML = '<option value="all">All Steering Coefficients</option>';
        this.filterMagnitude.innerHTML += '<option value="0">Unsteered (0.0)</option>';
        
        if (this.modelIndex.magnitudes) {
            this.modelIndex.magnitudes.forEach(mag => {
                const option = document.createElement('option');
                option.value = mag;
                option.textContent = mag === 0 ? 'Unsteered (0.0)' : `Steering Coefficient: ${mag}`;
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
        this.updateUrl();
    }
    
    async loadFilteredResponses(startIndex = 0) {
        if (startIndex === 0) {
            this.showLoading(true);
            this.setStatus('Applying filters...', 'loading');
            this.responsesContainer.innerHTML = '';
            this.currentFilterIndex = 0;
        }
        
        const includeJailbreak = this.filterJailbreak.checked;
        const includeDefault = this.filterDefault.checked;
        const magnitudeFilter = this.filterMagnitude.value;
        const scoreFilter = this.filterScore.value;
        
        try {
            let displayCount = 0;
            const batchSize = 50; // Load 50 at a time
            const maxPromptsToCheck = 100; // Check 100 prompts per batch
            let promptsChecked = 0;
            
            // Continue from where we left off
            const promptIds = this.modelIndex.prompt_ids;
            
            for (let i = startIndex; i < promptIds.length && displayCount < batchSize; i++) {
                if (promptsChecked >= maxPromptsToCheck) {
                    // Save where we left off for next batch
                    this.currentFilterIndex = i;
                    break;
                }
                promptsChecked++;
                
                const promptId = promptIds[i];
                
                // Get chunk information for this prompt
                const chunkInfo = this.modelIndex.prompt_to_chunk_map[promptId];
                if (!chunkInfo) continue;
                
                const chunkIndex = chunkInfo.chunk_index;
                const promptIndexInChunk = chunkInfo.prompt_index;
                
                // Load chunk data if not cached
                let promptData;
                if (this.chunkCache.has(chunkIndex)) {
                    const chunkData = this.chunkCache.get(chunkIndex);
                    promptData = chunkData[promptIndexInChunk];
                } else {
                    try {
                        const response = await fetch(`data/jailbreak/${this.currentModel}/chunks/chunk_${chunkIndex}.json`);
                        if (!response.ok) continue;
                        const chunkData = await response.json();
                        
                        // Cache the chunk
                        if (this.chunkCache.size <= 20) { // Allow more chunks in filtered view
                            this.chunkCache.set(chunkIndex, chunkData);
                        }
                        
                        promptData = chunkData[promptIndexInChunk];
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
                    if (displayCount >= batchSize) break;
                    
                    const box = this.createResponseBox(promptData, response);
                    this.responsesContainer.appendChild(box);
                    displayCount++;
                }
                
                this.currentFilterIndex = i + 1;
            }
            
            // Add Load More button if there are more to load
            const existingLoadMore = document.getElementById('load-more-btn');
            if (existingLoadMore) {
                existingLoadMore.remove();
            }
            
            if (this.currentFilterIndex < promptIds.length) {
                const loadMoreBtn = document.createElement('button');
                loadMoreBtn.id = 'load-more-btn';
                loadMoreBtn.textContent = 'Load More';
                loadMoreBtn.style.margin = '20px auto';
                loadMoreBtn.style.display = 'block';
                loadMoreBtn.onclick = () => {
                    loadMoreBtn.disabled = true;
                    loadMoreBtn.textContent = 'Loading...';
                    this.loadFilteredResponses(this.currentFilterIndex).then(() => {
                        loadMoreBtn.disabled = false;
                        loadMoreBtn.textContent = 'Load More';
                    });
                };
                this.responsesContainer.parentElement.appendChild(loadMoreBtn);
            }
            
            if (startIndex === 0 && displayCount === 0) {
                this.responsesContainer.innerHTML = '<p>No responses match the selected filters.</p>';
            }
            
            const totalShown = this.responsesContainer.querySelectorAll('.response-box').length;
            this.setStatus(`Showing ${totalShown} filtered responses`, 'success');
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
        
        // Add persona and category info
        const contextInfo = document.createElement('div');
        contextInfo.className = 'response-box-context';
        contextInfo.innerHTML = `
            <div><strong>Persona:</strong> ${promptData.persona}</div>
            <div><strong>Category:</strong> ${promptData.harm_category}</div>
            <div><strong>${response.type === 'jailbreak' ? 'Jailbreak' : 'No Jailbreak'}</strong></div>
        `;
        
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
            <span>Steering Coefficient: ${response.magnitude}</span>
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
        header.appendChild(contextInfo);
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
        // Just use status bar, don't show overlay
        // if (show) {
        //     this.loadingOverlay.classList.add('active');
        // } else {
        //     this.loadingOverlay.classList.remove('active');
        // }
    }

    // URL parameter methods
    getUrlParams() {
        const params = new URLSearchParams(window.location.search);
        return {
            model: params.get('model'),
            eval: params.get('eval') || 'jailbreak',
            view: params.get('view') || 'prompt',
            prompt: parseInt(params.get('prompt')) || 0,
            jailbreak: params.get('jailbreak') !== 'false',
            default: params.get('default') !== 'false', 
            magnitude: params.get('magnitude') || 'all',
            score: params.get('score') || 'all'
        };
    }

    updateUrl() {
        if (this.isUpdatingUrl) return;
        
        const params = new URLSearchParams();
        
        if (this.currentModel) {
            params.set('model', this.currentModel);
        }
        if (this.currentEval !== 'jailbreak') {
            params.set('eval', this.currentEval);
        }
        if (this.viewMode !== 'prompt') {
            params.set('view', this.viewMode);
        }
        if (this.viewMode === 'prompt' && this.currentPromptIndex > 0) {
            params.set('prompt', this.currentPromptIndex.toString());
        }
        if (this.viewMode === 'response') {
            if (!this.filterJailbreak.checked) {
                params.set('jailbreak', 'false');
            }
            if (!this.filterDefault.checked) {
                params.set('default', 'false');
            }
            if (this.filterMagnitude.value !== 'all') {
                params.set('magnitude', this.filterMagnitude.value);
            }
            if (this.filterScore.value !== 'all') {
                params.set('score', this.filterScore.value);
            }
        }

        const newUrl = params.toString() ? 
            `${window.location.pathname}?${params.toString()}` : 
            window.location.pathname;
            
        window.history.replaceState({}, '', newUrl);
    }

    async initFromUrl() {
        this.isUpdatingUrl = true;
        const params = this.getUrlParams();
        
        // Set model
        if (params.model) {
            this.modelSelect.value = params.model;
            this.currentModel = params.model;
        }
        
        // Set eval
        if (params.eval !== 'jailbreak') {
            this.evalSelect.value = params.eval;
            this.currentEval = params.eval;
        }
        
        // Set view mode
        this.viewMode = params.view;
        this.updateViewMode();
        
        // Load model data if model is selected
        if (this.currentModel) {
            await this.loadModelData();
            
            // Set prompt index for prompt view
            if (this.viewMode === 'prompt' && params.prompt !== undefined) {
                this.currentPromptIndex = Math.max(0, Math.min(params.prompt, this.modelIndex.total_prompts - 1));
                await this.loadPrompt(this.currentPromptIndex);
            }
            
            // Set filters for response view
            if (this.viewMode === 'response') {
                this.filterJailbreak.checked = params.jailbreak;
                this.filterDefault.checked = params.default;
                this.filterMagnitude.value = params.magnitude;
                this.filterScore.value = params.score;
                this.applyFilters();
            }
        }
        
        this.isUpdatingUrl = false;
    }

    updateViewMode() {
        // Update button states
        this.viewPromptBtn.classList.toggle('active', this.viewMode === 'prompt');
        this.viewResponseBtn.classList.toggle('active', this.viewMode === 'response');
        
        // Update view visibility
        this.promptView.classList.toggle('active', this.viewMode === 'prompt');
        this.responseTypeView.classList.toggle('active', this.viewMode === 'response');
    }
}

// Initialize the viewer when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new JailbreakEvalViewer();
});