class SusceptibilityEvalViewer {
    constructor() {
        this.currentModel = null;
        this.currentEval = 'susceptibility';
        this.modelIndex = null;
        this.currentQuestionIndex = 0;
        this.currentRoleIndex = 0;
        this.currentDefaultIndex = 0;
        this.currentQuestionData = null;
        this.chunkCache = new Map(); // Cache chunks instead of individual entries
        this.viewMode = 'question'; // 'question' or 'response'
        this.currentFilterIndex = 0; // Track position for loading more filtered results
        this.isUpdatingUrl = false; // Prevent infinite loops when updating URL
        
        // Color and label mappings for scores
        this.COLORS = {
            // Core identity classes
            "assistant": "#e31a1c",            // red
            "nonhuman_role": "#1f9e89",        // teal
            "human_role": "#1f78b4",           // blue
            "weird_role": "#7b2cbf",           // purple
            "ambiguous": "#ffff33",            // yellow
            "other": "#999999",                // grey
            "nonsensical": "#fb9a99",          // grey pink

            // Special case: answers to "Are you role-playing?"
            "no_roleplay_role": "#ff7f00",         // orange (clear denial, claims the role)
            "no_roleplay_assistant": "#fdb462",    // light orange (denial, claims assistant)
            "yes_roleplay_role": "#33a02c",        // green (affirmative, as role)
            "yes_roleplay_assistant": "#b2df8a",   // light green (affirmative, as assistant)
        };

        this.LABEL_MAP = {
            "assistant": "AI Assistant",
            "nonhuman_role": "Nonhuman Role",
            "human_role": "Human Role",
            "weird_role": "Weird Role",
            "ambiguous": "Ambiguous",
            "other": "Other",
            "nonsensical": "Nonsensical",

            "no_roleplay_role": "Denies as Role",
            "no_roleplay_assistant": "Denies as Assistant",
            "yes_roleplay_role": "Affirms as Role",
            "yes_roleplay_assistant": "Affirms as Assistant",
        };
        
        // DOM elements
        this.modelSelect = document.getElementById('model-select');
        this.loadBtn = document.getElementById('load-btn');
        this.statusBar = document.getElementById('status-bar');
        this.loadingOverlay = document.getElementById('loading-overlay');
        
        // View toggle
        this.viewQuestionBtn = document.getElementById('view-question-btn');
        this.questionView = document.getElementById('question-view');
        
        // Question view elements
        this.prevQuestionBtn = document.getElementById('prev-question-btn');
        this.nextQuestionBtn = document.getElementById('next-question-btn');
        this.currentQuestionNum = document.getElementById('current-question-num');
        this.totalQuestions = document.getElementById('total-questions');
        this.questionText = document.getElementById('question-text');
        
        // Role navigation elements
        this.prevRoleBtn = document.getElementById('prev-role-btn');
        this.nextRoleBtn = document.getElementById('next-role-btn');
        this.currentRoleNum = document.getElementById('current-role-num');
        this.totalRoles = document.getElementById('total-roles');
        this.roleSystemPrompt = document.getElementById('role-system-prompt');
        this.roleResponses = document.getElementById('role-responses');
        
        // Default navigation elements
        this.prevDefaultBtn = document.getElementById('prev-default-btn');
        this.nextDefaultBtn = document.getElementById('next-default-btn');
        this.currentDefaultNum = document.getElementById('current-default-num');
        this.totalDefaults = document.getElementById('total-defaults');
        this.defaultSystemPrompt = document.getElementById('default-system-prompt');
        this.defaultResponses = document.getElementById('default-responses');
        
        
        this.initEventListeners();
        this.loadAvailableModels().then(() => {
            this.initFromUrl();
        });
    }
    
    initEventListeners() {
        this.loadBtn.addEventListener('click', () => this.loadModelData());
        this.prevQuestionBtn.addEventListener('click', () => this.navigateQuestion(-1));
        this.nextQuestionBtn.addEventListener('click', () => this.navigateQuestion(1));
        this.prevRoleBtn.addEventListener('click', () => this.navigateRole(-1));
        this.nextRoleBtn.addEventListener('click', () => this.navigateRole(1));
        this.prevDefaultBtn.addEventListener('click', () => this.navigateDefault(-1));
        this.nextDefaultBtn.addEventListener('click', () => this.navigateDefault(1));
        
        // Update URL when model changes
        this.modelSelect.addEventListener('change', () => {
            this.currentModel = this.modelSelect.value;
            this.updateUrl();
        });
        
        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (this.modelIndex) {
                if (e.key === 'ArrowLeft') this.navigateQuestion(-1);
                if (e.key === 'ArrowRight') this.navigateQuestion(1);
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
                    const response = await fetch(`data/susceptibility/${model}/index.json`);
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
            const response = await fetch(`data/susceptibility/${modelName}/index.json`);
            if (!response.ok) {
                throw new Error(`Failed to load index for ${modelName}`);
            }
            
            this.modelIndex = await response.json();
            this.currentModel = modelName;
            this.currentQuestionIndex = 0;
            this.currentRoleIndex = 0;
            this.currentDefaultIndex = 0;
            this.chunkCache.clear();
            
            // Update UI with model info
            this.totalQuestions.textContent = this.modelIndex.total_questions || 5;
            
            // Load first question
            await this.loadQuestion(0);
            
            // Show question view
            this.questionView.classList.add('active');
            
            this.setStatus(`Loaded ${modelName} with ${this.modelIndex.total_questions || 5} questions`, 'success');
            this.updateUrl();
        } catch (error) {
            console.error('Error loading model data:', error);
            this.setStatus(`Error loading ${modelName}: ${error.message}`, 'error');
        } finally {
            this.showLoading(false);
        }
    }
    
    async loadQuestion(questionIndex) {
        if (!this.modelIndex || questionIndex < 0 || questionIndex >= (this.modelIndex.total_questions || 5)) {
            return;
        }
        
        // Load role and default chunks for this question
        const questionId = questionIndex.toString();
        const roleChunks = this.modelIndex.questions?.[questionId]?.role_prompted_chunks || [];
        const defaultChunks = this.modelIndex.questions?.[questionId]?.default_chunks || [];
        
        this.currentQuestionIndex = questionIndex;
        this.currentRoleIndex = 0;
        this.currentDefaultIndex = 0;
        
        // Reset navigation counters
        this.totalRoles.textContent = this.getTotalRoleEntries(roleChunks);
        this.totalDefaults.textContent = this.getTotalDefaultEntries(defaultChunks);
        
        // Load first role and default entries for this question
        await this.loadRoleEntry(0, roleChunks);
        await this.loadDefaultEntry(0, defaultChunks);
        
        this.displayQuestion();
        this.updateUrl();
    }
    
    getTotalRoleEntries(roleChunks) {
        // For now, estimate based on chunks - will be updated when chunks are loaded
        return roleChunks.length * 25; // Rough estimate, will be corrected when data loads
    }
    
    getTotalDefaultEntries(defaultChunks) {
        // For now, estimate based on chunks - will be updated when chunks are loaded  
        return defaultChunks.length * 20; // 20 defaults per chunk typically
    }
    
    async loadRoleEntry(entryIndex, roleChunks) {
        if (roleChunks.length === 0) return;
        
        // Find which chunk contains this entry index
        let currentIndex = 0;
        for (let chunkName of roleChunks) {
            const chunkData = await this.loadChunk(chunkName, 'role_prompted');
            if (!chunkData) continue;
            
            if (entryIndex >= currentIndex && entryIndex < currentIndex + chunkData.length) {
                const entryInChunk = entryIndex - currentIndex;
                this.currentRoleData = chunkData[entryInChunk];
                this.currentRoleIndex = entryIndex;
                this.displayRoleResponses();
                return;
            }
            currentIndex += chunkData.length;
        }
    }
    
    async loadDefaultEntry(entryIndex, defaultChunks) {
        if (defaultChunks.length === 0) return;
        
        // Find which chunk contains this entry index
        let currentIndex = 0;
        for (let chunkName of defaultChunks) {
            const chunkData = await this.loadChunk(chunkName, 'default');
            if (!chunkData) continue;
            
            if (entryIndex >= currentIndex && entryIndex < currentIndex + chunkData.length) {
                const entryInChunk = entryIndex - currentIndex;
                this.currentDefaultData = chunkData[entryInChunk];
                this.currentDefaultIndex = entryIndex;
                this.displayDefaultResponses();
                return;
            }
            currentIndex += chunkData.length;
        }
    }
    
    async loadChunk(chunkName, type) {
        const cacheKey = `${type}_${chunkName}`;
        
        // Check if chunk is already cached
        if (this.chunkCache.has(cacheKey)) {
            return this.chunkCache.get(cacheKey);
        }
        
        try {
            const response = await fetch(`data/susceptibility/${this.currentModel}/chunks/${chunkName}.json`);
            if (!response.ok) {
                throw new Error(`Failed to load chunk ${chunkName}`);
            }
            
            const chunkData = await response.json();
            
            // Cache the chunk (limit cache size)
            if (this.chunkCache.size > 20) {
                const firstKey = this.chunkCache.keys().next().value;
                this.chunkCache.delete(firstKey);
            }
            this.chunkCache.set(cacheKey, chunkData);
            
            return chunkData;
        } catch (error) {
            console.error(`Error loading chunk ${chunkName}:`, error);
            return null;
        }
    }
    
    displayQuestion() {
        if (this.currentRoleData) {
            this.questionText.textContent = this.currentRoleData.question;
        } else if (this.currentDefaultData) {
            this.questionText.textContent = this.currentDefaultData.question;
        }
        
        // Update question navigation
        this.currentQuestionNum.textContent = this.currentQuestionIndex + 1;
        this.prevQuestionBtn.disabled = this.currentQuestionIndex === 0;
        this.nextQuestionBtn.disabled = this.currentQuestionIndex >= (this.modelIndex.total_questions || 5) - 1;
    }
    
    displayRoleResponses() {
        if (!this.currentRoleData) return;
        
        // Update role navigation
        this.currentRoleNum.textContent = this.currentRoleIndex + 1;
        
        // Display system prompt (extracted from data processing)
        this.roleSystemPrompt.textContent = this.currentRoleData.system_prompt || 'Loading...';
        
        // Display response cards
        this.displayResponseCards(this.currentRoleData, 'role');
        
        // Update navigation buttons - implement proper bounds checking later
        this.prevRoleBtn.disabled = this.currentRoleIndex === 0;
    }
    
    displayDefaultResponses() {
        if (!this.currentDefaultData) return;
        
        // Update default navigation
        this.currentDefaultNum.textContent = this.currentDefaultIndex + 1;
        
        // Display system prompt (extracted from data processing)
        this.defaultSystemPrompt.textContent = this.currentDefaultData.system_prompt || 'Default Assistant response with no specific system prompt';
        
        // Display response cards
        this.displayResponseCards(this.currentDefaultData, 'default');
        
        // Update navigation buttons - implement proper bounds checking later
        this.prevDefaultBtn.disabled = this.currentDefaultIndex === 0;
    }
    
    displayResponseCards(data, type) {
        const container = type === 'role' ? this.roleResponses : this.defaultResponses;
        container.innerHTML = '';
        
        if (!data.responses) return;
        
        // Get magnitudes from index (already sorted correctly by model type)
        const magnitudes = this.modelIndex.magnitudes ? 
            [...this.modelIndex.magnitudes] :
            Object.keys(data.responses.steered || {}).map(k => parseFloat(k)).sort((a, b) => a - b);
        
        // Create ordered list with proper model-specific ordering
        const orderedMagnitudes = [];
        
        if (this.currentModel && this.currentModel.includes('llama')) {
            // For llama: descending order (4, 2, 0, -2, -4, -6, -8, -10, -12, -14, -16)
            const sortedMags = [...magnitudes].sort((a, b) => b - a);
            
            // Find where to insert 0
            let insertIndex = sortedMags.findIndex(m => m < 0);
            if (insertIndex === -1) insertIndex = sortedMags.length;
            
            sortedMags.splice(insertIndex, 0, 0);
            orderedMagnitudes.push(...sortedMags);
        } else {
            // For gemma/qwen: ascending order (-800, -400, 0, 400, 800, ...)
            const sortedMags = [...magnitudes].sort((a, b) => a - b);
            
            // Find where to insert 0
            let insertIndex = sortedMags.findIndex(m => m > 0);
            if (insertIndex === -1) insertIndex = sortedMags.length;
            
            sortedMags.splice(insertIndex, 0, 0);
            orderedMagnitudes.push(...sortedMags);
        }
        
        // Display responses in order
        for (const magnitude of orderedMagnitudes) {
            let responseData = null;
            
            if (magnitude === 0) {
                // Unsteered response
                if (data.responses.unsteered) {
                    responseData = data.responses.unsteered;
                }
            } else {
                // Steered response
                const magStr = magnitude.toString();
                const magStrDecimal = magnitude % 1 === 0 ? magnitude + '.0' : magStr;
                
                if (data.responses.steered) {
                    responseData = data.responses.steered[magStr] || data.responses.steered[magStrDecimal];
                }
            }
            
            if (responseData) {
                const displayMag = magnitude === 0 ? '0.0' : magnitude.toString();
                const card = this.createResponseCard(displayMag, responseData);
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
        scoreBadge.className = 'score-badge';
        
        // Handle score with backwards compatibility
        const score = responseData.score;
        if (score && score.trim() !== '' && this.LABEL_MAP[score]) {
            // Use the new color and label mappings
            const label = this.LABEL_MAP[score];
            const color = this.COLORS[score];
            
            scoreBadge.textContent = label;
            scoreBadge.style.backgroundColor = color;
            
            // Set text color based on background brightness
            const lightColors = ['#ffff33', '#fdb462', '#b2df8a', '#fb9a99']; // yellow, light orange, light green, grey pink
            if (lightColors.includes(color)) {
                scoreBadge.style.color = '#333'; // dark text for light backgrounds
            } else {
                scoreBadge.style.color = 'white'; // white text for dark backgrounds
            }
        } else {
            // Backwards compatibility: fall back to UNSCORED
            scoreBadge.textContent = 'UNSCORED';
            scoreBadge.style.backgroundColor = '#999999';
            scoreBadge.style.color = 'white';
        }
        
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
    
    navigateQuestion(direction) {
        const newIndex = this.currentQuestionIndex + direction;
        if (newIndex >= 0 && newIndex < (this.modelIndex.total_questions || 5)) {
            this.loadQuestion(newIndex);
        }
    }
    
    async navigateRole(direction) {
        const questionId = this.currentQuestionIndex.toString();
        const roleChunks = this.modelIndex.questions?.[questionId]?.role_prompted_chunks || [];
        
        const newIndex = this.currentRoleIndex + direction;
        if (newIndex >= 0) { // Upper bound will be checked in loadRoleEntry
            await this.loadRoleEntry(newIndex, roleChunks);
        }
    }
    
    async navigateDefault(direction) {
        const questionId = this.currentQuestionIndex.toString();
        const defaultChunks = this.modelIndex.questions?.[questionId]?.default_chunks || [];
        
        const newIndex = this.currentDefaultIndex + direction;
        if (newIndex >= 0) { // Upper bound will be checked in loadDefaultEntry
            await this.loadDefaultEntry(newIndex, defaultChunks);
        }
    }
    
    
    setStatus(message, type = '') {
        this.statusBar.textContent = message;
        this.statusBar.className = `status-bar ${type}`;
    }
    
    showLoading(show) {
        // Just use status bar for now
    }

    // URL parameter methods
    getUrlParams() {
        const params = new URLSearchParams(window.location.search);
        return {
            model: params.get('model'),
            question: parseInt(params.get('question')) || 0,
            role: parseInt(params.get('role')) || 0,
            default: parseInt(params.get('default')) || 0
        };
    }

    updateUrl() {
        if (this.isUpdatingUrl) return;
        
        const params = new URLSearchParams();
        
        if (this.currentModel) {
            params.set('model', this.currentModel);
        }
        if (this.currentQuestionIndex > 0) {
            params.set('question', this.currentQuestionIndex.toString());
        }
        if (this.currentRoleIndex > 0) {
            params.set('role', this.currentRoleIndex.toString());
        }
        if (this.currentDefaultIndex > 0) {
            params.set('default', this.currentDefaultIndex.toString());
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
            
            // Set question/role/default indices
            this.currentQuestionIndex = Math.max(0, Math.min(params.question, (this.modelIndex.total_questions || 5) - 1));
            await this.loadQuestion(this.currentQuestionIndex);
            
            // Load specific role and default if specified
            if (params.role > 0 || params.default > 0) {
                const questionId = this.currentQuestionIndex.toString();
                const roleChunks = this.modelIndex.questions?.[questionId]?.role_prompted_chunks || [];
                const defaultChunks = this.modelIndex.questions?.[questionId]?.default_chunks || [];
                
                if (params.role > 0) {
                    await this.loadRoleEntry(params.role, roleChunks);
                }
                if (params.default > 0) {
                    await this.loadDefaultEntry(params.default, defaultChunks);
                }
            }
        }
        
        this.isUpdatingUrl = false;
    }

}

// Initialize the viewer when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new SusceptibilityEvalViewer();
});