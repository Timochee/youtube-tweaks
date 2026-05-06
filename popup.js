// ============================================================================
// Popup script
// ============================================================================
// Reads stored settings, reflects them on the toggles, and writes back any
// change to chrome.storage.sync. Each content script reacts to its own
// storage keys via chrome.storage.onChanged — no tab messaging needed.
//
// The set of toggles is derived from popup.html's `data-setting` attributes,
// so adding a feature is one HTML row + one new content script — no edit
// here required.
// ============================================================================

async function init() {
    const inputs = document.querySelectorAll('input[data-setting]');
    const defaults = Object.fromEntries(
        [...inputs].map(input => [input.dataset.setting, false])
    );
    const settings = await chrome.storage.sync.get(defaults);

    inputs.forEach(input => {
        const key = input.dataset.setting;
        input.checked = settings[key];

        input.addEventListener('change', () => {
            chrome.storage.sync.set({ [key]: input.checked });
        });
    });
}

init();
