class JailbreakEvalViewer {
    constructor() {
        this.currentModel = null;
        this.currentEval = 'jailbreak';
        this.modelIndex = null;
        this.currentPromptIndex = 0;
        this.currentPromptData = null;
        this.chunkCache = new Map(); // Cache chunks instead of individual prompts
        this.currentFilterIndex = 0; // Track position for loading more filtered results
        this.isUpdatingUrl = false; // Prevent infinite loops when updating URL
        
        // DOM elements
        this.modelSelect = document.getElementById('model-select');
        this.loadBtn = document.getElementById('load-btn');
        this.statusBar = document.getElementById('status-bar');
        this.loadingOverlay = document.getElementById('loading-overlay');
        
        // View elements
        this.promptView = document.getElementById('prompt-view');
        
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
        
        
        this.initEventListeners();
        this.loadAvailableModels().then(() => {
            this.initFromUrl();
        });
    }
    
    initEventListeners() {
        this.loadBtn.addEventListener('click', () => this.loadModelData());
        this.prevPromptBtn.addEventListener('click', () => this.navigatePrompt(-1));
        this.nextPromptBtn.addEventListener('click', () => this.navigatePrompt(1));
        
        // Update URL when model changes
        this.modelSelect.addEventListener('change', () => {
            this.currentModel = this.modelSelect.value;
            this.updateUrl();
        });
        
        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (this.modelIndex) {
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
            
            
            // Load first prompt
            await this.loadPrompt(0);
            
            // Show prompt view
            this.promptView.classList.add('active');
            
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
            prompt: parseInt(params.get('prompt')) || 0
        };
    }

    updateUrl() {
        if (this.isUpdatingUrl) return;
        
        const params = new URLSearchParams();
        
        if (this.currentModel) {
            params.set('model', this.currentModel);
        }
        if (this.currentPromptIndex > 0) {
            params.set('prompt', this.currentPromptIndex.toString());
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
        
        // Load model data if model is selected
        if (this.currentModel) {
            await this.loadModelData();
            
            // Set prompt index
            if (params.prompt !== undefined) {
                this.currentPromptIndex = Math.max(0, Math.min(params.prompt, this.modelIndex.total_prompts - 1));
                await this.loadPrompt(this.currentPromptIndex);
            }
        }
        
        this.isUpdatingUrl = false;
    }

}

// Initialize the viewer when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new JailbreakEvalViewer();
});