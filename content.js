// ==========================================
// 1. UTILITIES (Hex Converters & Specificity)
// ==========================================
const utils = {
    // Convert rgb(85, 85, 85) -> #555555
    rgbToHex: (text) => {
        return text.replace(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/g, (match, r, g, b) => {
            return "#" + [r, g, b].map(x => {
                const hex = parseInt(x).toString(16);
                return hex.length === 1 ? '0' + hex : hex;
            }).join('');
        });
    },
    // Calculate specificity (ID=100, Class=10, Tag=1)
    getSpecificity: (selector) => {
        let score = 0;
        const s = selector.replace(/:not\(([^)]*)\)/g, " $1 ");
        score += (s.match(/#/g) || []).length * 100;
        score += (s.match(/\./g) || []).length * 10;
        score += (s.match(/(^|\s)[a-z0-9]+/gi) || []).length;
        return score;
    },
    // Escape HTML to prevent tags in source names from breaking innerHTML
    escapeHTML: (str) => {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
};

// ==========================================
// 2. THE HARVESTER (The Engine)
// ==========================================
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
        return 'inline <style>';
    }
    return 'unknown';
}

async function initCSSHarvester() {
    console.log("🚜 Building Clean CSS Database...");
    const cssStore = [];

    // Helper: Parse the raw string "color: red; border: 10px"
    function parseRawCssText(cssText) {
        const obj = {};
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
            // METHOD A: DOM Access (Preferred)
            const rules = sheet.cssRules || sheet.rules;
            if (rules) {
                Array.from(rules).forEach(rule => {
                    // We only want standard style rules
                    if (rule.type === 1) { // 1 = CSSStyleRule
                        cssStore.push({
                            selector: rule.selectorText,
                            styles: parseRawCssText(rule.style.cssText),
                            source: source,
                            specificity: utils.getSpecificity(rule.selectorText)
                        });
                    }
                });
            }
        } catch (e) {
            // METHOD B: CORS Fallback (Fetch raw text)
            if (sheet.href) {
                try {
                    const res = await fetch(sheet.href);
                    const text = await res.text();
                    // Regex to find "selector { content }"
                    const regex = /([^{]+)\{([^}]+)\}/g;
                    let match;
                    while ((match = regex.exec(text)) !== null) {
                        const sel = match[1].trim();
                        if (!sel.startsWith('@') && !sel.startsWith('/')) {
                            cssStore.push({
                                selector: sel,
                                styles: parseRawCssText(match[2]),
                                source: source,
                                specificity: utils.getSpecificity(sel)
                            });
                        }
                    }
                } catch (err) { console.log("Skipped:", sheet.href); }
            }
        }
    }

    window.CSS_DB = cssStore;
    console.log(`✅ Database Ready: ${cssStore.length} rules.`);
}

// ==========================================
// 3. INJECTED <style> OVERRIDE ENGINE
// ==========================================
const overrides = {}; // { "selector": { "prop": "value" } }
let overrideStyleEl = null;

function getOverrideStyleEl() {
    if (!overrideStyleEl) {
        overrideStyleEl = document.createElement('style');
        overrideStyleEl.id = 'css-editor-overrides';
        document.head.appendChild(overrideStyleEl);
    }
    return overrideStyleEl;
}

function rebuildOverrideStyles() {
    const el = getOverrideStyleEl();
    let css = '';
    for (const [selector, props] of Object.entries(overrides)) {
        const declarations = Object.entries(props)
            .filter(([p, v]) => p.trim() && v.trim())
            .map(([p, v]) => `  ${p}: ${v} !important;`)
            .join('\n');
        if (declarations) {
            css += `${selector} {\n${declarations}\n}\n`;
        }
    }
    el.textContent = css;
}

function setOverride(selector, prop, value) {
    if (!overrides[selector]) overrides[selector] = {};
    if (value.trim()) {
        overrides[selector][prop] = value;
    } else {
        delete overrides[selector][prop];
    }
    rebuildOverrideStyles();
}

function removeOverride(selector, prop) {
    if (overrides[selector]) {
        delete overrides[selector][prop];
        if (Object.keys(overrides[selector]).length === 0) {
            delete overrides[selector];
        }
    }
    rebuildOverrideStyles();
}

function renameOverrideProp(selector, oldProp, newProp) {
    if (overrides[selector] && overrides[selector][oldProp] !== undefined) {
        const val = overrides[selector][oldProp];
        delete overrides[selector][oldProp];
        if (newProp.trim()) {
            overrides[selector][newProp] = val;
        }
    }
    rebuildOverrideStyles();
}

// ==========================================
// 4. THE GENERATOR (DevTools-like Output)
// ==========================================
function getFinalCSS(element) {
    if (!window.CSS_DB) return "<div>Loading...</div>";

    // 1. Find all matching rules (direct match, no inherited)
    const matched = window.CSS_DB.filter(rule => {
        try { return element.matches(rule.selector); } catch { return false; }
    });

    // 2. Sort by Specificity (Low -> High), so later = higher priority
    matched.sort((a, b) => a.specificity - b.specificity);

    // 3. Figure out which properties are overridden
    //    Walk low->high specificity, track which props end up "winning"
    const winningProp = {}; // prop -> index of the rule that wins
    matched.forEach((rule, ruleIndex) => {
        for (const prop of Object.keys(rule.styles)) {
            winningProp[prop] = ruleIndex; // last one wins
        }
    });

    // Also check inline style="" (highest priority)
    const inlineStyles = {};
    if (element.style && element.style.cssText.trim()) {
        element.style.cssText.split(';').forEach(decl => {
            if (!decl.trim()) return;
            const i = decl.indexOf(':');
            if (i > -1) {
                const prop = decl.substring(0, i).trim();
                const val = decl.substring(i + 1).trim();
                if (prop && val) {
                    inlineStyles[prop] = val;
                    winningProp[prop] = -1; // -1 = inline wins
                }
            }
        });
    }

    // 4. Render each rule as a separate block (high specificity first, like DevTools)
    let html = '';

    // Inline style block first (if any)
    if (Object.keys(inlineStyles).length > 0) {
        html += renderRuleBlock('element.style', inlineStyles, null, winningProp, -1);
    }

    // Stylesheet rules: high specificity first (DevTools order)
    for (let i = matched.length - 1; i >= 0; i--) {
        const rule = matched[i];
        html += renderRuleBlock(rule.selector, rule.styles, rule.source, winningProp, i);
    }

    if (!html) {
        html = '<div style="padding:12px;color:#888;font-style:italic;">No matching rules</div>';
    }

    return `<div style="font-family: Consolas, monospace; font-size: 12px; color: #d4d4d4; background: #1e1e1e; border-radius: 6px; border: 1px solid #3c3c3c; box-shadow: 0 8px 32px rgba(0,0,0,0.6); max-height: 420px; overflow-y: auto; padding: 0;">${html}</div>`;
}

function renderRuleBlock(selector, styles, source, winningProp, ruleIndex) {
    const entries = Object.entries(styles);
    if (entries.length === 0) return '';

    const isEditable = selector !== 'element.style';

    let propsHTML = '';
    entries.forEach(([prop, val]) => {
        const cleanVal = utils.rgbToHex(val);
        const isOverridden = winningProp[prop] !== ruleIndex;

        if (isOverridden) {
            // Struck through – this prop is overridden by a higher specificity rule
            propsHTML += `<div style="line-height:1.6;padding-left:16px;text-decoration:line-through;opacity:0.5;">`;
            propsHTML += `<span style="color:#9cdcfe">${utils.escapeHTML(prop)}</span>`;
            propsHTML += `<span style="color:#d4d4d4">: </span>`;
            propsHTML += `<span style="color:#ce9178">${utils.escapeHTML(cleanVal)}</span>`;
            propsHTML += `<span style="color:#d4d4d4">;</span></div>`;
        } else if (isEditable) {
            // Editable row – contenteditable name & value
            propsHTML += `<div style="line-height:1.7;padding-left:16px;display:flex;align-items:baseline;" data-selector="${utils.escapeHTML(selector)}" data-prop="${utils.escapeHTML(prop)}">`;
            propsHTML += `<span contenteditable="true" spellcheck="false" style="color:#9cdcfe;outline:none;min-width:8px;" data-role="name" data-original="${utils.escapeHTML(prop)}">${utils.escapeHTML(prop)}</span>`;
            propsHTML += `<span style="color:#d4d4d4;flex-shrink:0">: </span>`;
            propsHTML += `<span contenteditable="true" spellcheck="false" style="color:#ce9178;outline:none;min-width:8px;flex:1;word-break:break-all;" data-role="value" data-original="${utils.escapeHTML(cleanVal)}">${utils.escapeHTML(cleanVal)}</span>`;
            propsHTML += `<span style="color:#d4d4d4;flex-shrink:0">;</span>`;
            propsHTML += `<span data-role="delete" style="color:#555;margin-left:6px;cursor:pointer;font-size:13px;line-height:1;opacity:0;transition:opacity .15s;flex-shrink:0" onmouseenter="this.style.opacity='1';this.style.color='#f44336'" onmouseleave="this.style.opacity='0';this.style.color='#555'" title="Remove">×</span>`;
            propsHTML += `</div>`;
        } else {
            // Non-editable (inline styles block)
            propsHTML += `<div style="line-height:1.6;padding-left:16px;">`;
            propsHTML += `<span style="color:#9cdcfe">${utils.escapeHTML(prop)}</span>`;
            propsHTML += `<span style="color:#d4d4d4">: </span>`;
            propsHTML += `<span style="color:#ce9178">${utils.escapeHTML(cleanVal)}</span>`;
            propsHTML += `<span style="color:#d4d4d4">;</span></div>`;
        }
    });

    // Render any NEW overrides for this selector (properties user added that weren't in original)
    if (isEditable && overrides[selector]) {
        for (const [prop, val] of Object.entries(overrides[selector])) {
            if (!styles.hasOwnProperty(prop)) {
                propsHTML += `<div style="line-height:1.7;padding-left:16px;display:flex;align-items:baseline;" data-selector="${utils.escapeHTML(selector)}" data-prop="${utils.escapeHTML(prop)}">`;
                propsHTML += `<span contenteditable="true" spellcheck="false" style="color:#73c991;outline:none;min-width:8px;" data-role="name" data-original="${utils.escapeHTML(prop)}">${utils.escapeHTML(prop)}</span>`;
                propsHTML += `<span style="color:#d4d4d4;flex-shrink:0">: </span>`;
                propsHTML += `<span contenteditable="true" spellcheck="false" style="color:#73c991;outline:none;min-width:8px;flex:1;word-break:break-all;" data-role="value" data-original="${utils.escapeHTML(val)}">${utils.escapeHTML(val)}</span>`;
                propsHTML += `<span style="color:#d4d4d4;flex-shrink:0">;</span>`;
                propsHTML += `<span data-role="delete" style="color:#555;margin-left:6px;cursor:pointer;font-size:13px;line-height:1;opacity:0;transition:opacity .15s;flex-shrink:0" onmouseenter="this.style.opacity='1';this.style.color='#f44336'" onmouseleave="this.style.opacity='0';this.style.color='#555'" title="Remove">×</span>`;
                propsHTML += `</div>`;
            }
        }
    }

    const safeSelector = utils.escapeHTML(selector);
    const sourceLabel = source
        ? `<div style="font-size:11px;color:#888;font-style:italic;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${utils.escapeHTML(source)}</div>`
        : '';

    // "+ add property" button for editable blocks
    const addBtn = isEditable
        ? `<div data-role="add" data-selector="${safeSelector}" style="padding:2px 16px;color:#555;font-size:11px;cursor:pointer;user-select:none;transition:color .15s" onmouseenter="this.style.color='#9cdcfe'" onmouseleave="this.style.color='#555'">+ add property</div>`
        : '';

    return `
        <div style="padding:6px 12px;border-bottom:1px solid #2d2d2d;" data-block-selector="${safeSelector}">
            ${sourceLabel}
            <div style="color:#d7ba7d">${safeSelector} <span style="color:#d4d4d4">{</span></div>
            <div data-role="props-container" data-selector="${safeSelector}">
                ${propsHTML}
            </div>
            ${addBtn}
            <div style="color:#d4d4d4">}</div>
        </div>
    `;
}

// ==========================================
// 5. THE UI (Hover & Click)
// ==========================================
let shadow, inspOverlay, popup, host, activeElement;


function initUI() {
    if (document.getElementById('css-inspector-host')) return;

    host = document.createElement('div');
    host.id = 'css-inspector-host';
    document.body.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
        .overlay {
            position: fixed;
            background: rgba(76, 175, 79, 0.25);
            border: 2px solid #4CAF50;
            pointer-events: none;
            z-index: 999999;
            display: none;
            box-sizing: border-box;
        }
        .popup {
            position: fixed;
            z-index: 1000000;
            display: none;
        }
    `;
    shadow.appendChild(style);

    inspOverlay = document.createElement('div');
    inspOverlay.className = 'overlay';
    popup = document.createElement('div');
    popup.className = 'popup';

    shadow.appendChild(inspOverlay);
    shadow.appendChild(popup);

    // -------------------------------------------------------
    // Delegated event listeners inside shadow DOM popup
    // -------------------------------------------------------

    // CLICK: "add property" and "delete" buttons
    popup.addEventListener('click', (e) => {
        e.stopPropagation(); // don't let clicks inside popup dismiss it

        const target = e.target;

        // --- Delete button ---
        if (target.dataset.role === 'delete') {
            const row = target.parentElement;
            if (!row) return;
            const selector = row.dataset.selector;
            const nameSpan = row.querySelector('[data-role="name"]');
            if (nameSpan) {
                removeOverride(selector, nameSpan.textContent.trim());
            }
            row.remove();
            return;
        }

        // --- Add property button ---
        if (target.dataset.role === 'add') {
            const selector = target.dataset.selector;
            // Find the props container right before this button
            const block = target.closest('[data-block-selector]');
            const propsContainer = block ? block.querySelector('[data-role="props-container"]') : null;
            if (!propsContainer) return;

            const newRow = document.createElement('div');
            newRow.style.cssText = 'line-height:1.7;padding-left:16px;display:flex;align-items:baseline;';
            newRow.dataset.selector = selector;
            newRow.dataset.prop = '';

            newRow.innerHTML = `
                <span contenteditable="true" spellcheck="false" style="color:#73c991;outline:none;min-width:8px;" data-role="name" data-original=""></span><span style="color:#d4d4d4;flex-shrink:0">: </span><span contenteditable="true" spellcheck="false" style="color:#73c991;outline:none;min-width:8px;flex:1;word-break:break-all;" data-role="value" data-original=""></span><span style="color:#d4d4d4;flex-shrink:0">;</span><span data-role="delete" style="color:#555;margin-left:6px;cursor:pointer;font-size:13px;line-height:1;opacity:0;transition:opacity .15s;flex-shrink:0" onmouseenter="this.style.opacity='1';this.style.color='#f44336'" onmouseleave="this.style.opacity='0';this.style.color='#555'" title="Remove">×</span>
            `;
            propsContainer.appendChild(newRow);
            newRow.querySelector('[data-role="name"]').focus();
            return;
        }
    });

    // INPUT: live editing of property names & values
    popup.addEventListener('input', (e) => {
        const target = e.target;
        const row = target.closest('[data-selector]');
        if (!row || !row.dataset.selector) return;

        const selector = row.dataset.selector;
        const nameSpan = row.querySelector('[data-role="name"]');
        const valueSpan = row.querySelector('[data-role="value"]');
        if (!nameSpan || !valueSpan) return;

        const currentProp = nameSpan.textContent.trim();
        const currentVal = valueSpan.textContent.trim();

        if (target.dataset.role === 'value') {
            // Value changed — apply override
            if (currentProp) {
                setOverride(selector, currentProp, currentVal);
            }
        } else if (target.dataset.role === 'name') {
            // Prop name changed — rename
            const oldProp = row.dataset.prop || nameSpan.dataset.original || '';
            if (oldProp !== currentProp) {
                renameOverrideProp(selector, oldProp, currentProp);
                row.dataset.prop = currentProp;
                if (currentProp && currentVal) {
                    setOverride(selector, currentProp, currentVal);
                }
            }
        }
    });

    // FOCUS: highlight the editable span
    popup.addEventListener('focusin', (e) => {
        if (e.target.contentEditable === 'true') {
            e.target.style.background = 'rgba(255,255,255,0.06)';
            e.target.style.borderRadius = '2px';
            e.target.style.boxShadow = '0 0 0 1px rgba(100,149,237,0.5)';
        }
    });
    popup.addEventListener('focusout', (e) => {
        if (e.target.contentEditable === 'true') {
            e.target.style.background = '';
            e.target.style.boxShadow = '';
        }
    });

    // KEYDOWN: Tab between name/value, Enter to confirm
    popup.addEventListener('keydown', (e) => {
        const target = e.target;
        const row = target.closest('[data-selector]');
        if (!row) return;

        if (e.key === 'Tab') {
            e.preventDefault();
            if (target.dataset.role === 'name') {
                const val = row.querySelector('[data-role="value"]');
                if (val) val.focus();
            } else if (target.dataset.role === 'value') {
                // Move to next row's name, or trigger add
                const nextRow = row.nextElementSibling;
                if (nextRow && nextRow.querySelector('[data-role="name"]')) {
                    nextRow.querySelector('[data-role="name"]').focus();
                } else {
                    const block = row.closest('[data-block-selector]');
                    const addBtn = block ? block.querySelector('[data-role="add"]') : null;
                    if (addBtn) addBtn.click();
                }
            }
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            if (target.dataset.role === 'name') {
                const val = row.querySelector('[data-role="value"]');
                if (val) val.focus();
            } else {
                target.blur();
            }
        }
    });
}

// --- Run Init ---
// Defer harvester until all resources (stylesheets) are loaded
if (document.readyState === 'complete') {
    initCSSHarvester();
    initUI();
} else {
    window.addEventListener('load', () => {
        initCSSHarvester();
        initUI();
    });
}

function setOverlayPosition(element) {
    activeElement = element.target;
    const rect = activeElement.getBoundingClientRect();
    inspOverlay.style.width = `${rect.width}px`;
    inspOverlay.style.height = `${rect.height}px`;
    inspOverlay.style.top = `${rect.top}px`;
    inspOverlay.style.left = `${rect.left}px`;
    inspOverlay.style.display = 'block';
}
// --- Event Listeners ---
document.addEventListener('mousemove', (e) => {
    if (isFrozen || e.target === host) return;
    setOverlayPosition(e);
});

document.addEventListener('scroll', () => {
    setOverlayPosition({ target: activeElement });
});

document.addEventListener('click', (e) => {
    if (e.target === host) return;

    // If click is inside our shadow DOM popup, ignore
    const path = e.composedPath();
    if (path.includes(popup)) return;

    if (isFrozen) {
        // Unfreeze
        isFrozen = false;
        popup.style.display = 'none';
        inspOverlay.style.display = 'none';
        e.preventDefault();
    } else {
        // Freeze
        if (activeElement) {
            e.preventDefault();
            e.stopPropagation();
            isFrozen = true;

            // 1. Generate content and render it (so we can measure it)
            popup.innerHTML = getFinalCSS(activeElement);
            popup.style.display = 'block';

            // 2. Measure the popup and the viewport
            const popupRect = popup.getBoundingClientRect();
            const offset = 15; // Distance from the cursor

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

            // 5. Apply the final safe coordinates
            popup.style.top = `${top}px`;
            popup.style.left = `${left}px`;
        }
    }
}, { capture: true });