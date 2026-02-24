let shadow, inspOverlay, popup, host, hoveredEle;
let isFrozen = false; // Frozen = When user clicked an element & popup opened


// Create UI Elements
function initUI() {
    if (document.getElementById('css-inspector-host')) return;

    host = document.createElement('div');
    host.id = 'css-inspector-host';
    document.body.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    // link.href = chrome.runtime.getURL('styles.css');
    link.href = 'styles.css';

    inspOverlay = document.createElement('div');
    inspOverlay.className = 'insp-overlay';
    overlayTargetName = document.createElement('div');
    overlayTargetName.className = 'overlay__target-name';
    popup = document.createElement('div');
    popup.className = 'insp-popup';


    shadow.appendChild(link);
    shadow.appendChild(inspOverlay);
    inspOverlay.appendChild(overlayTargetName);
    shadow.appendChild(popup);
}
initUI();

function showOverlayOver(element) {
    hoveredEle = element.target;
    const hoveredElePosition = hoveredEle.getBoundingClientRect();
    inspOverlay.style.width = `${hoveredElePosition.width}px`;
    inspOverlay.style.height = `${hoveredElePosition.height}px`;
    inspOverlay.style.top = `${hoveredElePosition.top}px`;
    inspOverlay.style.left = `${hoveredElePosition.left}px`;
    inspOverlay.style.display = 'block';

    overlayTargetName.textContent = hoveredEle.tagName.toLowerCase() + (hoveredEle.id ? `#${hoveredEle.id}` : '') + (hoveredEle.className ? `.${hoveredEle.className.split(' ').join('.')}` : '');
    overlayTargetName.classList.remove('overflowing');

    // Check if target content name overflows viewport
    const rect = overlayTargetName.getBoundingClientRect();
    const isOutsideViewport =
        rect.left < 0 ||
        rect.top < 0 ||
        rect.right > window.innerWidth ||
        rect.bottom > window.innerHeight;
    overlayTargetName.classList.toggle('overflowing', isOutsideViewport);
}

// Parse and handle CSS
function getSheetSource(sheet) {
    if (sheet.href) {
        try {
            const url = new URL(sheet.href);
            return url.pathname.split('/').pop() || sheet.href;
        } catch {
            return sheet.href;
        }
    }
    if (sheet.ownerNode && sheet.ownerNode.tagName === 'STYLE') {
        return 'inline';
    }
    return 'unknown';
}

async function initCSSHarvester() {
    const cssStore = []; // [{selector, styles: {prop: val}, source}, ...]

    function parseRawCssText(cssText) {
        const obj = {}; // {prop: val, ...}
        cssText.split(';').forEach(decl => {
            if (!decl.trim()) return;
            const firstColon = decl.indexOf(':');
            if (firstColon > -1) {
                const prop = decl.substring(0, firstColon).trim();
                const val = decl.substring(firstColon + 1).trim();
                if (prop && val) obj[prop] = val;
            }
        });
        return obj;
    }

    const sheets = Array.from(document.styleSheets);

    for (const sheet of sheets) {

        const source = getSheetSource(sheet);
        try {
            // Try Direct DOM Access
            const rules = sheet.cssRules || sheet.rules;
            if (rules) {
                Array.from(rules).forEach(rule => {
                    if (rule.type === 1) { // 1 = CSSStyleRule
                        cssStore.push({
                            selector: rule.selectorText,
                            styles: parseRawCssText(rule.style.cssText),
                            source: source,
                        });
                    }
                });
            }
        } catch (e) {
            // CORS Fallback (Fetch raw text)
            if (sheet.href) {
                try {
                    const res = await fetch(sheet.href);
                    const text = await res.text();
                    const regex = /([^{]+)\{([^}]+)\}/g;
                    let match;
                    while ((match = regex.exec(text)) !== null) {
                        const sel = match[1].trim();
                        if (!sel.startsWith('@') && !sel.startsWith('/')) {
                            cssStore.push({
                                selector: sel,
                                styles: parseRawCssText(match[2]),
                                source: source,
                            });
                        }
                    }
                } catch (err) { console.log("Skipped:", sheet.href); }
            }
        }
    }

    window.CSS_DB = cssStore;
}
initCSSHarvester();

function getFinalCSS(element) {
    if (!window.CSS_DB) return "<div class='css-group__content'>Loading...</div>";

    const matchedCSS = window.CSS_DB.filter(rule => {
        try { return element.matches(rule.selector); } catch { return false; }
    });

    if (matchedCSS.length === 0) {
        return "<div class='css-group__content'>No CSS rules found for this element.</div>";
    }

    // 2. Group rules by their source
    const groupedCSS = {};
    matchedCSS.forEach(rule => {
        if (!groupedCSS[rule.source]) {
            groupedCSS[rule.source] = [];
        }
        groupedCSS[rule.source].push(rule);
    });

    let html = '';
    for (const source in groupedCSS) {
        html += `
            <div class="css-group">
                <div class="css-group__header">${source}</div>
                <div class="css-group__content">
        `;

        groupedCSS[source].forEach(rule => {
            html += `
                    <div class="css-rule">
                        <div class="css-rule__selector"><span contenteditable>${rule.selector}</span> <span class="css-rule__bracket css-rule__delimiter">{</span></div>
                        <div class="css-rule__body">
            `;

            for (const [property, value] of Object.entries(rule.styles)) {
                html += `
                            <div class="css-rule__declaration" contenteditable>
                                <span class="css-rule__property">${property}</span><span class="css-rule__colon css-rule__delimiter">: </span><span class="css-rule__value">${value}</span><span class="css-rule__semicolon css-rule__delimiter">;</span>
                            </div>
                `;
            }

            html += `
                        </div>
                        <div class="css-rule__bracket css-rule__delimiter">}</div>
                    </div>
            `;
        });

        html += `
                </div>
            </div>
        `;
    }

    return html;
}

document.addEventListener('mousemove', (element) => {
    if (isFrozen || element.target === host) return;
    showOverlayOver(element);
});

// Update overlay position with the scroll
document.addEventListener('scroll', () => {
    if (inspOverlay.style.display === 'block') {
        showOverlayOver({ target: hoveredEle });
    }
});

document.addEventListener('click', (e) => {

    const targetEle = e.target;
    if (targetEle === host) return;

    const path = e.composedPath();
    if (path.includes(popup)) return;

    if (isFrozen) {
        isFrozen = false;
        popup.style.display = 'none';
        inspOverlay.style.display = 'none';
        e.preventDefault();
    } else {
        if (targetEle) {
            e.preventDefault();
            e.stopPropagation();
            isFrozen = true;

            popup.innerHTML = getFinalCSS(targetEle);
            popup.style.display = 'block';

            // Avoid overflowing
            const popupRect = popup.getBoundingClientRect();
            const offset = 15;

            let top = e.clientY + offset;
            let left = e.clientX + offset;

            // 3. Check Right Boundary
            if (left + popupRect.width > window.innerWidth) {
                // Flip to the left side of the cursor
                left = e.clientX - popupRect.width - offset;

                // Fallback: If it's so wide it now bleeds off the left edge, pin it to the left screen edge
                if (left < 0) left = offset;
            }

            // 4. Check Bottom Boundary
            if (top + popupRect.height > window.innerHeight) {
                // Flip to above the cursor
                top = e.clientY - popupRect.height - offset;

                // Fallback: If it's so tall it now bleeds off the top edge, pin it to the top screen edge
                if (top < 0) top = offset;
            }

            popup.style.top = `${top}px`;
            popup.style.left = `${left}px`;
        }
    }
}, { capture: true });