let shadow, inspOverlay, popup, host, hoveredEle;
let isFrozen = false; // Frozen = When user clicked an element & popup opened
let globalRuleId = 0;
const changeLog = []; // [{type: "", source: "", selector: "", oldCode: "", newCode: ""}, ...]

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
    const cssStore = [];

    function parseRawCssText(cssText) {
        const obj = [];
        let propId = 0;
        cssText.split(';').forEach(decl => {
            if (!decl.trim()) return;
            const firstColon = decl.indexOf(':');
            if (firstColon > -1) {
                const prop = decl.substring(0, firstColon).trim();
                const val = decl.substring(firstColon + 1).trim();
                if (prop && val) {
                    obj.push({
                        id: propId++,
                        prop: prop,
                        val: val
                    });
                }
            }
        });
        return obj;
    }

    const sheets = Array.from(document.styleSheets);

    for (const sheet of sheets) {
        const source = getSheetSource(sheet);
        try {
            // METHOD A: Direct DOM Access
            const rules = sheet.cssRules || sheet.rules;
            if (rules) {
                Array.from(rules).forEach(rule => {
                    if (rule.type === 1) { // 1 = CSSStyleRule
                        cssStore.push({
                            id: globalRuleId++,
                            isEdited: false,
                            selector: rule.selectorText,
                            styles: parseRawCssText(rule.style.cssText),
                            source: source,
                        });
                    }
                });
            }
        } catch (e) {
            // METHOD B: CORS Fallback
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
                                id: globalRuleId++,
                                isEdited: false,
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
                    <div class="css-rule" data-rule-id="${rule.id}">
                        <div class="css-rule__selector"><span contenteditable="plaintext-only" data-type="selector">${rule.selector}</span> <span class="css-rule__bracket css-rule__delimiter">{</span></div>
                        <div class="css-rule__body">
            `;

            rule.styles.forEach(styleObj => {
                html += `
                    <div class="css-rule__declaration">
                        <span class="css-rule__property" contenteditable="plaintext-only" data-type="property" data-decl-id="${styleObj.id}">${styleObj.prop}</span><span class="css-rule__colon css-rule__delimiter">: </span><span class="css-rule__value" contenteditable="plaintext-only" data-type="value" data-decl-id="${styleObj.id}">${styleObj.val}</span><span class="css-rule__semicolon css-rule__delimiter">;</span>
                    </div>
                `;
            });
            html += `
        </div>
        <div class="css-rule__add-prop"
             data-selector="${rule.selector}" 
             data-source="${source}">+ add property</div>
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

popup.addEventListener('keydown', (e) => {
    const target = e.target;
    const isProp = target.classList.contains('css-rule__property');
    const isValue = target.classList.contains('css-rule__value');
    const isSelector = target.parentElement.classList.contains('css-rule__selector');

    if (isSelector && e.key === 'Enter') {
        target.blur();
    }

    if (isProp && (e.key === ':' || e.key === 'Enter')) {
        e.preventDefault();
        const valueSpan = target.parentElement.querySelector('.css-rule__value');
        if (valueSpan) {
            valueSpan.focus();
            document.execCommand('selectAll', false, null);
        }
    }

    if (isValue && (e.key === ';' || e.key === 'Enter')) {
        e.preventDefault();
        const currentDeclaration = target.closest('.css-rule__declaration');
        const nextRow = currentDeclaration.nextElementSibling;

        if (nextRow && nextRow.classList.contains('css-rule__declaration')) {
            const nextProp = nextRow.querySelector('.css-rule__property');
            if (nextProp) {
                nextProp.focus();
                document.execCommand('selectAll', false, null);
            }
        } else {
            const ruleContainer = target.closest('.css-rule');
            const addBtn = ruleContainer ? ruleContainer.querySelector('.css-rule__add-prop') : null;
            if (addBtn) {
                addBtn.click();
            } else {
                target.blur();
            }
        }
    }
});

popup.addEventListener('click', (e) => {
    if (e.target.classList.contains('css-rule__add-prop')) {
        const btn = e.target;
        const ruleBody = btn.previousElementSibling;

        const lastRow = ruleBody.lastElementChild;
        if (lastRow && lastRow.classList.contains('css-rule__declaration')) {
            const p = lastRow.querySelector('.css-rule__property').textContent.trim();
            const v = lastRow.querySelector('.css-rule__value').textContent.trim();
            if (!p && !v) {
                lastRow.querySelector('.css-rule__property').focus();
                return;
            }
        }


        let declId = 0;
        if (lastRow) {
            const prevSpan = lastRow.querySelector('[data-decl-id]');
            if (prevSpan && prevSpan.dataset.declId) {
                declId = parseInt(prevSpan.dataset.declId, 10);
            }
        }

        declId++;

        const newRow = document.createElement('div');
        newRow.className = 'css-rule__declaration';
        newRow.innerHTML = `
            <span class="css-rule__property" contenteditable="plaintext-only" data-type="new decl" data-decl-id="${declId}"></span><span class="css-rule__delimiter">: </span><span class="css-rule__value" contenteditable="plaintext-only" data-type="new decl" data-decl-id="${declId}"></span><span class="css-rule__delimiter">;</span>
        `;
        ruleBody.appendChild(newRow);
        newRow.querySelector('.css-rule__property').focus();
    }
});

// Removing empty properties on focusout
popup.addEventListener('focusout', (e) => {
    const target = e.target;
    if (!target.isContentEditable) return;
    const row = e.target.closest('.css-rule__declaration');
    if (!row) return;

    setTimeout(() => {
        if (!row.contains(shadow.activeElement)) {
            const p = row.querySelector('.css-rule__property').textContent.trim();
            const v = row.querySelector('.css-rule__value').textContent.trim();
            if (!p || !v) {
                row.remove();
            }
        }
    }, 10);
})

function updateStyles() {

    let style = document.getElementById('css-editor-overrides');
    if (!style) {
        style = document.createElement('style');
        style.id = 'css-editor-overrides';
        document.head.appendChild(style);
    }

    if (!changeLog || changeLog.length === 0) {
        style.textContent = '';
        return;
    }


    let changedCssText = ""
    for (const change of changeLog) {
        const originalRuleObj = window.CSS_DB.find(r => r.id === change.ruleId);
        if (!originalRuleObj) continue;
        switch (change.type) {
            case "selector":
                console.log("adding selector css");

                changedCssText += change.newValue + "{";

                for (const decl of originalRuleObj.styles) {
                    changedCssText += decl.prop + ":" + decl.val + ";";
                }
                console.log(changedCssText);

                break;

            case "property": {
                changedCssText += change.ruleSelector + "{";
                const propDeclObj = originalRuleObj.styles.find(
                    obj => obj.id === parseInt(change.declId)
                );
                if (propDeclObj) {
                    // Check if the value was also edited for this same decl
                    const companionVal = changeLog.find(
                        c => c.ruleId === change.ruleId && c.declId == change.declId && c.type === "value"
                    );
                    const val = companionVal ? companionVal.newValue : propDeclObj.val;
                    changedCssText += change.newValue + ":" + val + ";";
                }
                break;
            }

            case "value": {
                // If there's also a property change for this decl, skip — the property case already handles the full pair
                const companionProp = changeLog.find(
                    c => c.ruleId === change.ruleId && c.declId == change.declId && c.type === "property"
                );
                if (companionProp) break;

                changedCssText += change.ruleSelector + "{";
                const valueDeclObj = originalRuleObj.styles.find(
                    obj => obj.id === parseInt(change.declId)
                );
                if (valueDeclObj) {
                    changedCssText += valueDeclObj.prop + ":" + change.newValue + ";";
                }
                break;
            }
            case "new decl":

                changedCssText += change.ruleSelector + "{";
                if (change.newProp && change.newVal) {
                    changedCssText += change.newProp + ":" + change.newVal + ";";
                }
                break;
        }

        changedCssText += "}";
    }

    style.textContent = changedCssText;
}

popup.addEventListener('focusout', (e) => {
    const target = e.target;
    if (!target.isContentEditable) return;

    const ruleContainer = target.closest('.css-rule');
    if (!ruleContainer) return;

    const ruleId = parseInt(ruleContainer.dataset.ruleId);
    const newValue = target.textContent;
    const type = target.dataset.type;

    const ruleObj = window.CSS_DB.find(r => r.id === ruleId);
    if (!ruleObj) return;

    const ruleSelector = ruleObj.selector;
    const ruleSource = ruleObj.source;
    let declId = -1;
    let oldValue;

    switch (type) {
        case "selector":
            oldValue = ruleObj.selector;
            break;
        case "property":
            declId = target.dataset.declId;
            oldValue = ruleObj.styles.find(item => item.id == declId).prop;
            break;
        case "value":
            declId = target.dataset.declId;
            oldValue = ruleObj.styles.find(item => item.id == declId).val;
            break;
        case "new decl": {
            declId = target.dataset.declId;
            const row = target.closest('.css-rule__declaration');
            if (!row) return;
            const propText = row.querySelector('.css-rule__property').textContent.trim();
            const valText = row.querySelector('.css-rule__value').textContent.trim();

            if (!propText || !valText) return;

            const existing = changeLog.find(
                c => c.ruleId === ruleId && c.declId === declId && c.type === "new decl"
            );
            if (existing) {
                existing.newProp = propText;
                existing.newVal = valText;
                existing.ruleSelector = ruleSelector;
            } else {
                changeLog.push({
                    ruleId: ruleId,
                    newProp: propText,
                    newVal: valText,
                    type: "new decl",
                    ruleSelector: ruleSelector,
                    ruleSource: ruleSource,
                    declId: declId,
                });
            }
            updateStyles();
            return;
        }
    }
    if (oldValue == newValue && !changeLog.find(c => c.ruleId === ruleId && c.declId == declId && c.type === type)) return;

    const existingIdx = changeLog.findIndex(
        c => c.ruleId === ruleId && c.declId == declId && c.type === type
    );

    if (existingIdx !== -1) {
        if (oldValue == newValue) {
            // Edited back to original — remove the entry entirely
            changeLog.splice(existingIdx, 1);
        } else {
            changeLog[existingIdx].newValue = newValue;
            changeLog[existingIdx].ruleSelector = ruleSelector;
        }
    } else {
        if (oldValue == newValue) return;
        changeLog.push({
            ruleId: ruleId,
            newValue: newValue,
            type: type,
            ruleSelector: ruleSelector,
            ruleSource: ruleSource,
            declId: declId,
            oldValue: oldValue
        });
    }
    updateStyles();
});
