// ============================================================
// 1. STATE
// ============================================================

let shadow, inspOverlay, overlayTargetName, popup, host, hoveredEle;
let isFrozen = false;
let globalRuleId = 0;
const changeLog = [];

// ============================================================
// 2. DOM SETUP
// ============================================================

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

// ============================================================
// 3. OVERLAY
// ============================================================

function refreshOverlay(element) {
    if (!element) return;
    hoveredEle = element;

    const rect = element.getBoundingClientRect();
    Object.assign(inspOverlay.style, {
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        display: 'block',
    });

    const id = element.id ? `#${element.id}` : '';
    const cls = element.className
        ? `.${String(element.className).split(' ').filter(Boolean).join('.')}`
        : '';
    overlayTargetName.textContent = element.tagName.toLowerCase() + id + cls;

    overlayTargetName.classList.remove('overflowing');
    const labelRect = overlayTargetName.getBoundingClientRect();
    const isOutside =
        labelRect.left < 0 ||
        labelRect.top < 0 ||
        labelRect.right > window.innerWidth ||
        labelRect.bottom > window.innerHeight;
    overlayTargetName.classList.toggle('overflowing', isOutside);
}

// ============================================================
// 4. CSS HARVESTER
// ============================================================

function getSheetSource(sheet) {
    if (sheet.href) {
        try {
            return new URL(sheet.href).pathname.split('/').pop() || sheet.href;
        } catch {
            return sheet.href;
        }
    }
    if (sheet.ownerNode?.tagName === 'STYLE') return 'inline';
    return 'unknown';
}

function parseRawCssText(cssText) {
    const decls = [];
    let propId = 0;

    for (const segment of cssText.split(';')) {
        const trimmed = segment.trim();
        if (!trimmed) continue;

        const colonIdx = trimmed.indexOf(':');
        if (colonIdx === -1) continue;

        const prop = trimmed.substring(0, colonIdx).trim();
        const val = trimmed.substring(colonIdx + 1).trim();
        if (prop && val) {
            decls.push({ id: propId++, prop, val });
        }
    }

    return decls;
}

function buildRuleEntry(selector, cssText, source) {
    return {
        id: globalRuleId++,
        isEdited: false,
        selector,
        styles: parseRawCssText(cssText),
        source,
    };
}

async function initCSSHarvester() {
    const cssStore = [];

    for (const sheet of Array.from(document.styleSheets)) {
        const source = getSheetSource(sheet);

        try {
            const rules = sheet.cssRules || sheet.rules;
            if (!rules) continue;

            for (const rule of Array.from(rules)) {
                if (rule.type === CSSRule.STYLE_RULE) {
                    cssStore.push(buildRuleEntry(rule.selectorText, rule.style.cssText, source));
                }
            }
        } catch {
            // CORS-blocked sheet — fetch as text
            if (!sheet.href) continue;
            try {
                const text = await (await fetch(sheet.href)).text();
                const regex = /([^{]+)\{([^}]+)\}/g;
                let match;
                while ((match = regex.exec(text)) !== null) {
                    const sel = match[1].trim();
                    if (!sel.startsWith('@') && !sel.startsWith('/')) {
                        cssStore.push(buildRuleEntry(sel, match[2], source));
                    }
                }
            } catch {
                console.warn('Skipped stylesheet:', sheet.href);
            }
        }
    }

    window.CSS_DB = cssStore;
}

initCSSHarvester();

// ============================================================
// 5. HTML RENDERER
// ============================================================

function renderDeclaration(styleObj) {
    return `
        <div class="css-rule__declaration">
            <span class="css-rule__property" contenteditable="plaintext-only"
                  data-type="property" data-decl-id="${styleObj.id}">${styleObj.prop}</span><span
                  class="css-rule__colon css-rule__delimiter">: </span><span
                  class="css-rule__value" contenteditable="plaintext-only"
                  data-type="value" data-decl-id="${styleObj.id}">${styleObj.val}</span><span
                  class="css-rule__semicolon css-rule__delimiter">;</span>
        </div>`;
}

function renderRule(rule, source) {
    const declsHTML = rule.styles.map(renderDeclaration).join('');
    return `
        <div class="css-rule" data-rule-id="${rule.id}">
            <div class="css-rule__selector">
                <span contenteditable="plaintext-only" data-type="selector">${rule.selector}</span>
                <span class="css-rule__bracket css-rule__delimiter">{</span>
            </div>
            <div class="css-rule__body">${declsHTML}</div>
            <div class="css-rule__add-prop"
                 data-selector="${rule.selector}"
                 data-source="${source}">+ add property</div>
            <div class="css-rule__bracket css-rule__delimiter">}</div>
        </div>`;
}

function getFinalCSS(element) {
    if (!window.CSS_DB) return `<div class="css-group__content">Loading...</div>`;

    const matched = window.CSS_DB.filter(rule => {
        try { return element.matches(rule.selector); } catch { return false; }
    });

    if (matched.length === 0) {
        return `<div class="css-group__content">No CSS rules found for this element.</div>`;
    }

    // Group by source
    const grouped = {};
    for (const rule of matched) {
        (grouped[rule.source] ??= []).push(rule);
    }

    let html = '';
    for (const [source, rules] of Object.entries(grouped)) {
        html += `
            <div class="css-group">
                <div class="css-group__header">${source}</div>
                <div class="css-group__content">
                    ${rules.map(r => renderRule(r, source)).join('')}
                </div>
            </div>`;
    }

    return html;
}

// ============================================================
// 6. STYLE APPLICATION (Override Engine)
// ============================================================

function getOrCreateOverrideStyle() {
    let el = document.getElementById('css-editor-overrides');
    if (!el) {
        el = document.createElement('style');
        el.id = 'css-editor-overrides';
        document.head.appendChild(el);
    }
    return el;
}

function findCompanion(change, targetType) {
    return changeLog.find(
        c => c.ruleId === change.ruleId
            && c.declId == change.declId
            && c.type === targetType
    );
}

function buildDeclCSS(change, originalRule) {
    const declObj = originalRule.styles.find(s => s.id === parseInt(change.declId));
    if (!declObj) return '';

    switch (change.type) {
        case 'property': {
            const companionVal = findCompanion(change, 'value');
            const val = companionVal ? companionVal.newValue : declObj.val;
            return change.newValue + ':' + val + ';';
        }
        case 'value': {
            // If property is also changed, the property case already handles both
            if (findCompanion(change, 'property')) return '';
            return declObj.prop + ':' + change.newValue + ';';
        }
        default:
            return '';
    }
}

function updateStyles() {
    const style = getOrCreateOverrideStyle();

    if (changeLog.length === 0) {
        style.textContent = '';
        return;
    }

    let css = '';

    for (const change of changeLog) {
        const rule = window.CSS_DB?.find(r => r.id === change.ruleId);
        if (!rule) continue;

        switch (change.type) {
            case 'selector': {
                const decls = rule.styles.map(d => d.prop + ':' + d.val + ';').join('');
                css += change.newValue + '{' + decls + '}';
                break;
            }
            case 'property':
            case 'value': {
                const declCSS = buildDeclCSS(change, rule);
                if (declCSS) {
                    css += change.ruleSelector + '{' + declCSS + '}';
                }
                break;
            }
            case 'new decl': {
                if (change.newProp && change.newVal) {
                    css += change.ruleSelector + '{' + change.newProp + ':' + change.newVal + ';}';
                }
                break;
            }
        }
    }

    style.textContent = css;

    if (isFrozen && hoveredEle) {
        refreshOverlay(hoveredEle);
    }
}

// ============================================================
// 7. CHANGE RECORDING
// ============================================================

function findChangeEntry(ruleId, declId, type) {
    return changeLog.findIndex(
        c => c.ruleId === ruleId && c.declId == declId && c.type === type
    );
}

function recordNewDecl(target, ruleId, ruleSelector, ruleSource) {
    const declId = target.dataset.declId;
    const row = target.closest('.css-rule__declaration');
    if (!row) return;

    const propText = row.querySelector('.css-rule__property')?.textContent.trim();
    const valText = row.querySelector('.css-rule__value')?.textContent.trim();

    // Both halves must be present for a valid declaration
    if (!propText || !valText) return;

    const idx = findChangeEntry(ruleId, declId, 'new decl');
    if (idx !== -1) {
        changeLog[idx].newProp = propText;
        changeLog[idx].newVal = valText;
        changeLog[idx].ruleSelector = ruleSelector;
    } else {
        changeLog.push({
            ruleId, declId,
            type: 'new decl',
            newProp: propText,
            newVal: valText,
            ruleSelector, ruleSource,
        });
    }
    updateStyles();
}

function getOriginalValue(ruleObj, type, declId) {
    switch (type) {
        case 'selector': return ruleObj.selector;
        case 'property': return ruleObj.styles.find(s => s.id == declId)?.prop;
        case 'value': return ruleObj.styles.find(s => s.id == declId)?.val;
        default: return undefined;
    }
}

function recordChange(target) {
    if (!target?.isContentEditable) return;

    const ruleContainer = target.closest('.css-rule');
    if (!ruleContainer) return;

    const ruleId = parseInt(ruleContainer.dataset.ruleId);
    const newValue = target.textContent;
    const type = target.dataset.type;

    const ruleObj = window.CSS_DB?.find(r => r.id === ruleId);
    if (!ruleObj) return;

    const ruleSelector = ruleObj.selector;
    const ruleSource = ruleObj.source;

    // New declarations have their own path
    if (type === 'new decl') {
        recordNewDecl(target, ruleId, ruleSelector, ruleSource);
        return;
    }

    const declId = type !== 'selector' ? target.dataset.declId : -1;
    const oldValue = getOriginalValue(ruleObj, type, declId);
    if (oldValue === undefined) return;

    const idx = findChangeEntry(ruleId, declId, type);

    // No existing entry and value unchanged → nothing to do
    if (idx === -1 && oldValue == newValue) return;

    if (idx !== -1) {
        if (oldValue == newValue) {
            // Reverted to original → remove entirely
            changeLog.splice(idx, 1);
        } else {
            changeLog[idx].newValue = newValue;
            changeLog[idx].ruleSelector = ruleSelector;
        }
    } else {
        changeLog.push({
            ruleId, declId, type,
            newValue, oldValue,
            ruleSelector, ruleSource,
        });
    }

    updateStyles();
}

// ============================================================
// 8. EVENT LISTENERS — Document Level
// ============================================================

document.addEventListener('mousemove', (e) => {
    if (isFrozen || e.target === host) return;
    refreshOverlay(e.target);
});

document.addEventListener('scroll', () => {
    if (hoveredEle && inspOverlay.style.display === 'block') {
        refreshOverlay(hoveredEle);
    }
});

document.addEventListener('click', (e) => {
    if (e.target === host) return;
    if (e.composedPath().includes(popup)) return;

    if (isFrozen) {
        isFrozen = false;
        popup.style.display = 'none';
        inspOverlay.style.display = 'none';
        e.preventDefault();
        return;
    }

    if (!e.target) return;

    e.preventDefault();
    e.stopPropagation();
    isFrozen = true;

    popup.innerHTML = getFinalCSS(e.target);
    popup.style.display = 'block';

    positionPopup(e.clientX, e.clientY);
}, { capture: true });

// ============================================================
// 9. POPUP POSITIONING
// ============================================================

function positionPopup(cursorX, cursorY) {
    const rect = popup.getBoundingClientRect();
    const offset = 15;

    let top = cursorY + offset;
    let left = cursorX + offset;

    if (left + rect.width > window.innerWidth) {
        left = cursorX - rect.width - offset;
        if (left < 0) left = offset;
    }

    if (top + rect.height > window.innerHeight) {
        top = cursorY - rect.height - offset;
        if (top < 0) top = offset;
    }

    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
}

// ============================================================
// 10. EVENT LISTENERS — Popup Level
// ============================================================

// --- Keyboard navigation ---
popup.addEventListener('keydown', (e) => {
    const target = e.target;
    if (!target?.isContentEditable) return;

    const isProp = target.classList.contains('css-rule__property');
    const isValue = target.classList.contains('css-rule__value');
    const isSelector = target.parentElement?.classList.contains('css-rule__selector');

    if (isSelector && e.key === 'Enter') {
        e.preventDefault();
        target.blur();
        return;
    }

    if (isProp && (e.key === ':' || e.key === 'Enter')) {
        e.preventDefault();
        const valueSpan = target.parentElement?.querySelector('.css-rule__value');
        if (valueSpan) {
            valueSpan.focus();
            document.execCommand('selectAll', false, null);
        }
        return;
    }

    if (isValue && (e.key === ';' || e.key === 'Enter')) {
        e.preventDefault();
        const nextRow = target.closest('.css-rule__declaration')?.nextElementSibling;

        if (nextRow?.classList.contains('css-rule__declaration')) {
            const nextProp = nextRow.querySelector('.css-rule__property');
            if (nextProp) {
                nextProp.focus();
                document.execCommand('selectAll', false, null);
            }
        } else {
            const addBtn = target.closest('.css-rule')?.querySelector('.css-rule__add-prop');
            if (addBtn) {
                addBtn.click();
            } else {
                target.blur();
            }
        }
    }
});

// --- Add new property row ---
popup.addEventListener('click', (e) => {
    if (!e.target.classList.contains('css-rule__add-prop')) return;

    const btn = e.target;
    const ruleBody = btn.previousElementSibling;
    if (!ruleBody) return;

    // If last row is already empty, just focus it
    const lastRow = ruleBody.lastElementChild;
    if (lastRow?.classList.contains('css-rule__declaration')) {
        const p = lastRow.querySelector('.css-rule__property')?.textContent.trim();
        const v = lastRow.querySelector('.css-rule__value')?.textContent.trim();
        if (!p && !v) {
            lastRow.querySelector('.css-rule__property')?.focus();
            return;
        }
    }

    // Determine next declId
    let declId = 0;
    const prevIdSpan = lastRow?.querySelector('[data-decl-id]');
    if (prevIdSpan?.dataset.declId) {
        declId = parseInt(prevIdSpan.dataset.declId, 10);
    }
    declId++;

    const newRow = document.createElement('div');
    newRow.className = 'css-rule__declaration';
    newRow.innerHTML = `<span class="css-rule__property" contenteditable="plaintext-only" data-type="new decl" data-decl-id="${declId}"></span><span class="css-rule__delimiter">: </span><span class="css-rule__value" contenteditable="plaintext-only" data-type="new decl" data-decl-id="${declId}"></span><span class="css-rule__delimiter">;</span>`;

    ruleBody.appendChild(newRow);
    newRow.querySelector('.css-rule__property')?.focus();
});

// --- Remove empty rows on focusout ---
popup.addEventListener('focusout', (e) => {
    if (!e.target?.isContentEditable) return;
    const row = e.target.closest('.css-rule__declaration');
    if (!row) return;

    setTimeout(() => {
        if (row.contains(shadow.activeElement)) return;
        const p = row.querySelector('.css-rule__property')?.textContent.trim();
        const v = row.querySelector('.css-rule__value')?.textContent.trim();
        if (!p || !v) {
            row.remove();
        }
    }, 10);
});

// --- Record changes on focusout (immediate) ---
popup.addEventListener('focusout', (e) => {
    recordChange(e.target);
});

// --- Record changes on input (debounced for live preview) ---
let inputDebounceTimer = null;

popup.addEventListener('input', (e) => {
    const el = e.target;
    clearTimeout(inputDebounceTimer);
    inputDebounceTimer = setTimeout(() => recordChange(el), 300);
});
