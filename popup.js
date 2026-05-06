// ============================================================================
// Popup script
// ============================================================================
// Reads stored settings, reflects them on the toggles, and writes back any
// change to chrome.storage.sync. The content script reacts to the storage
// change via chrome.storage.onChanged — there's no need to message tabs
// directly.
// ============================================================================

const DEFAULTS = {
    hideShorts: false,
    hideLive: false,
    hideReplays: false,
    hideRelevant: false,
};

async function init() {
    const settings = await chrome.storage.sync.get(DEFAULTS);
    const inputs = document.querySelectorAll('input[data-setting]');

    inputs.forEach(input => {
        const key = input.dataset.setting;
        input.checked = settings[key];

        input.addEventListener('change', () => {
            chrome.storage.sync.set({ [key]: input.checked });
        });
    });
}

init();
