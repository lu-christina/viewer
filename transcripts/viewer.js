const BASE_PATH = '../../dynamics/results';

let currentModel = null;
let currentSubdir = null;
let currentFile = null;
let manifest = null;

const statusEl = document.getElementById('status');
const modelSelect = document.getElementById('model-select');
const subdirSelect = document.getElementById('subdir-select');
const fileSelect = document.getElementById('file-select');
const transcriptContainer = document.getElementById('transcript-container');

// Initialize
async function init() {
    setStatus('Loading manifest...');
    try {
        const response = await fetch('manifest.json');
        manifest = await response.json();
        populateModelSelect();
        setupEventListeners();
        setStatus('Ready');
    } catch (error) {
        console.error('Error loading manifest:', error);
        setStatus('Error loading manifest. Run generate_manifest.py first.');
    }
}

function setStatus(message) {
    statusEl.textContent = message;
}

function populateModelSelect() {
    modelSelect.innerHTML = '<option value="">Select a model</option>';
    if (!manifest) return;

    Object.keys(manifest).sort().forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        modelSelect.appendChild(option);
    });
}

function populateSubdirSelect(model) {
    subdirSelect.innerHTML = '<option value="">Select a subdirectory</option>';
    if (!model || !manifest || !manifest[model]) {
        return;
    }

    Object.keys(manifest[model]).sort().forEach(subdir => {
        const option = document.createElement('option');
        option.value = subdir;
        option.textContent = subdir;
        subdirSelect.appendChild(option);
    });
}

function populateFileSelect(model, subdir) {
    fileSelect.innerHTML = '<option value="">Select a transcript</option>';
    if (!model || !subdir || !manifest || !manifest[model] || !manifest[model][subdir]) {
        return;
    }

    const files = manifest[model][subdir];
    files.forEach(file => {
        const option = document.createElement('option');
        option.value = file;
        option.textContent = file;
        fileSelect.appendChild(option);
    });
}

async function loadTranscript(model, subdir, file) {
    setStatus('Loading transcript...');
    transcriptContainer.innerHTML = '<div class="no-data">Loading...</div>';

    try {
        const response = await fetch(`${BASE_PATH}/${model}/${subdir}/${file}`);
        if (!response.ok) {
            throw new Error('Failed to load transcript');
        }

        const data = await response.json();
        displayTranscript(data);
        setStatus('Ready');
    } catch (error) {
        console.error('Error loading transcript:', error);
        transcriptContainer.innerHTML = '<div class="no-data">Error loading transcript</div>';
        setStatus('Error loading transcript');
    }
}

function displayTranscript(data) {
    const transcriptList = document.createElement('div');
    transcriptList.className = 'transcript-list';

    if (!data.conversation || data.conversation.length === 0) {
        transcriptList.innerHTML = '<div class="no-data">No messages in transcript</div>';
        transcriptContainer.innerHTML = '';
        transcriptContainer.appendChild(transcriptList);
        return;
    }

    data.conversation.forEach((message, index) => {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${message.role}`;

        const roleDiv = document.createElement('div');
        roleDiv.className = 'message-role';
        roleDiv.textContent = message.role.charAt(0).toUpperCase() + message.role.slice(1);

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        // Render markdown
        contentDiv.innerHTML = marked.parse(message.content);

        messageDiv.appendChild(roleDiv);
        messageDiv.appendChild(contentDiv);
        transcriptList.appendChild(messageDiv);
    });

    transcriptContainer.innerHTML = '';
    transcriptContainer.appendChild(transcriptList);
}

function setupEventListeners() {
    modelSelect.addEventListener('change', (e) => {
        currentModel = e.target.value;
        currentSubdir = null;
        currentFile = null;

        subdirSelect.value = '';
        fileSelect.innerHTML = '<option value="">Select subdirectory first</option>';
        transcriptContainer.innerHTML = '<div class="no-data">Select a subdirectory and transcript</div>';

        if (currentModel) {
            populateSubdirSelect(currentModel);
        }
    });

    subdirSelect.addEventListener('change', (e) => {
        currentSubdir = e.target.value;
        currentFile = null;

        fileSelect.value = '';
        transcriptContainer.innerHTML = '<div class="no-data">Select a transcript</div>';

        if (currentModel && currentSubdir) {
            populateFileSelect(currentModel, currentSubdir);
        }
    });

    fileSelect.addEventListener('change', (e) => {
        currentFile = e.target.value;

        if (currentModel && currentSubdir && currentFile) {
            loadTranscript(currentModel, currentSubdir, currentFile);
        }
    });
}

// Start the app
init();
