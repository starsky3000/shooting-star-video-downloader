// StarDownload Options Page Script

const STORAGE_KEY = 'stardownload_settings';

// Default settings
const DEFAULT_SETTINGS = {
  downloadPath: '',
  proxyAddress: '',
  autoUpdate: true
};

// DOM Elements
const optionsForm = document.getElementById('optionsForm');
const downloadPathInput = document.getElementById('downloadPath');
const proxyAddressInput = document.getElementById('proxyAddress');
const autoUpdateCheckbox = document.getElementById('autoUpdate');
const statusMessage = document.getElementById('statusMessage');
const resetBtn = document.getElementById('resetBtn');

// Load settings on page load
document.addEventListener('DOMContentLoaded', loadSettings);

// Handle form submission
optionsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  saveSettings();
});

// Handle reset button
resetBtn.addEventListener('click', resetSettings);

// Load settings from storage
async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEY);
    const settings = result[STORAGE_KEY] || DEFAULT_SETTINGS;

    downloadPathInput.value = settings.downloadPath || '';
    proxyAddressInput.value = settings.proxyAddress || '';
    autoUpdateCheckbox.checked = settings.autoUpdate !== false;
  } catch (err) {
    console.error('Failed to load settings:', err);
    showStatus('读取设置失败', 'error');
  }
}

// Save settings to storage
async function saveSettings() {
  const settings = {
    downloadPath: downloadPathInput.value.trim(),
    proxyAddress: proxyAddressInput.value.trim(),
    autoUpdate: autoUpdateCheckbox.checked
  };

  try {
    await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
    showStatus('设置已保存', 'success');
  } catch (err) {
    console.error('Failed to save settings:', err);
    showStatus('保存设置失败', 'error');
  }
}

// Reset to default settings
async function resetSettings() {
  downloadPathInput.value = DEFAULT_SETTINGS.downloadPath;
  proxyAddressInput.value = DEFAULT_SETTINGS.proxyAddress;
  autoUpdateCheckbox.checked = DEFAULT_SETTINGS.autoUpdate;
  await saveSettings();
  showStatus('已重置为默认设置', 'success');
}

// Show status message
function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;

  setTimeout(() => {
    statusMessage.className = 'status-message';
    statusMessage.style.display = 'none';
  }, 3000);
}