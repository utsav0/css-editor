const shadow = null;
const inspOverlay = null;
const popup = null;

function init() {
    // Shadow DOM
    const host = document.createElement('div');
    host.id = 'css-inspector-host';
    document.body.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    
    // CSS
    const cssLink = document.createElement('link');
    cssLink.setAttribute('rel', 'stylesheet');
    cssLink.setAttribute('href', browser.runtime.getURL('style.css'));
    shadow.appendChild(cssLink);
    
    // Hover highlighter
    inspOverlay = document.createElement('div');
    inspOverlay.className = 'inspector-overlay';
    shadow.appendChild(inspOverlay);

    // Highlighter tooltip
    const tooltip = document.createElement('span');
    tooltip.className = 'inspector-tooltip';
    inspOverlay.appendChild(tooltip);

    // Styles popup
    stylesBox = document.createElement('div');
    stylesBox.className = 'inspector-popup';
    shadow.appendChild(stylesBox);
}

init()





let activeElement = null;

function getSelector(el) {
    if (!el) return '';
    let str = el.tagName.toLowerCase();
    if (el.id) str += `#${el.id}`;
    if (el.classList.length) str += `.${[...el.classList].join('.')}`;
    return str;
}

function updateOverlay(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.left = `${rect.left}px`;
    
    tooltip.textContent = getSelector(el);
    overlay.style.display = 'block';
}

document.addEventListener('mousemove', (e) => {
    if (e.target === host) return;
    activeElement = e.target;
});

document.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (activeElement) {
        isFrozen = true;
        
        popup.style.top = `${e.clientY + 10}px`;
        popup.style.left = `${e.clientX + 10}px`;
        popup.style.display = 'block';
    }
}, { capture: true });