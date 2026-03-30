function loadTheme(theme) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = theme + '-colors.css';
    document.head.appendChild(link);

    document.querySelector('#switch-theme').src = `../img/icons/${theme}-switch.svg`;
}

function toggleTheme() {
    chrome.storage.local.get('theme', (data) => {
        const currentTheme = data.theme || 'light';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';

        // Remove existing theme stylesheet
        const existingLink = document.querySelector('link[rel=stylesheet][href*="-colors.css"]');
        if (existingLink) {
            existingLink.remove();
        }

        // Load new theme stylesheet
        loadTheme(newTheme);

        // Save the new theme in local storage
        chrome.storage.local.set({ 'theme': newTheme });
    });
}

document.querySelector('#switch-theme').addEventListener('click', toggleTheme);

// Load the saved theme on page load
window.onload = () => {
    chrome.storage.local.get('theme', (data) => {
        const savedTheme = data.theme || 'light';
        loadTheme(savedTheme);
    });
};