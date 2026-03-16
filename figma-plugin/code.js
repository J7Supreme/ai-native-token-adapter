// ds skill v2 Variable Importer — code.js
// Runs inside Figma's plugin sandbox. Uses figma.variables API (free on all plans).

figma.showUI(__html__, { width: 480, height: 560, title: 'ds skill v2' });

figma.ui.onmessage = async (msg) => {
    if (msg.type === 'cancel') {
        figma.closePlugin();
        return;
    }

    if (msg.type === 'import') {
        try {
            const data = JSON.parse(msg.json);
            const report = await importVariables(data);
            const warningCount = report.unsupported.length;
            const summary = warningCount
                ? `✅ Variables synced with ${warningCount} unsupported token issue${warningCount === 1 ? '' : 's'}.`
                : '✅ Variables synced successfully.';
            figma.notify(summary, { timeout: 5000 });
            figma.ui.postMessage({ type: 'import-result', report });
        } catch (err) {
            figma.ui.postMessage({ type: 'error', message: err.message });
        }
    }

    if (msg.type === 'generate-sheet') {
        try {
            await generateTokenSheet();
            figma.notify('🎨 Token sheet generated', { timeout: 4000 });
            figma.ui.postMessage({ type: 'sheet-done' });
            figma.closePlugin();
        } catch (err) {
            figma.ui.postMessage({ type: 'error', message: 'Sheet: ' + err.message });
        }
    }
};

// ─── Color helpers ─────────────────────────────────────────────────────────

function hexToFigmaColor(hex) {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!r) return null;
    return { r: parseInt(r[1], 16) / 255, g: parseInt(r[2], 16) / 255, b: parseInt(r[3], 16) / 255, a: 1 };
}

function rgbaToFigmaColor(str) {
    const m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
    if (!m) return null;
    return {
        r: parseFloat(m[1]) / 255,
        g: parseFloat(m[2]) / 255,
        b: parseFloat(m[3]) / 255,
        a: m[4] !== undefined ? parseFloat(m[4]) : 1
    };
}

function parseFigmaColor(value) {
    if (!value || typeof value !== 'string') return null;
    if (value.startsWith('#')) return hexToFigmaColor(value);
    if (/^rgba?\(/i.test(value)) return rgbaToFigmaColor(value);
    return null;
}

function isMissingValue(value) {
    return value === '[MISSING]';
}

// Maps W3C / Tokens Studio $type → Figma variable resolvedType
const TYPE_MAP = {
    color: 'COLOR',
    string: 'STRING',
    number: 'FLOAT',
    float: 'FLOAT',
    dimension: 'FLOAT',
    boolean: 'BOOLEAN',
    gradient: 'GRADIENT', // Special marker — handled as Paint Styles
    // Tokens Studio aliases
    fontFamilies: 'STRING',
    fontWeights: 'STRING',
    fontSizes: 'FLOAT',
    lineHeights: 'FLOAT',
    letterSpacing: 'FLOAT',
    spacing: 'FLOAT',
    sizing: 'FLOAT',
    borderRadius: 'FLOAT',
    borderWidth: 'FLOAT',
    opacity: 'FLOAT',
};

const COLLECTION_ORDER = ['primitive', 'semantic', 'pattern', 'component'];

/**
 * Recursively flatten a token object into { path, type, value, description }.
 */
function flattenTokens(obj, prefix) {
    const out = [];
    for (const [key, val] of Object.entries(obj)) {
        if (key.startsWith('$')) continue;
        const path = prefix ? `${prefix}.${key}` : key;
        if (val && val.$type && TYPE_MAP[val.$type]) {
            out.push({ path, type: val.$type, value: val.$value, description: val.$description || '' });
        } else if (val && typeof val === 'object' && !Array.isArray(val)) {
            out.push(...flattenTokens(val, path));
        }
    }
    return out;
}

// ─── Collection / Mode / Variable upsert helpers ────────────────────────────

/**
 * Find an existing collection by name, or create a new one.
 * Returns { col, isNew }.
 */
function getOrCreateCollection(name) {
    const existing = figma.variables.getLocalVariableCollections()
        .find(c => c.name === name);
    if (existing) return { col: existing, isNew: false };
    return { col: figma.variables.createVariableCollection(name), isNew: true };
}

/**
 * Find a mode by name inside a collection, or add it.
 * For brand-new collections, the first mode is the default — rename it instead of adding.
 */
function ensureMode(col, modeName, isNewCol, isFirstMode) {
    // Always check first: mode might already exist with the right name
    const existing = col.modes.find(m => m.name === modeName);
    if (existing) return existing.modeId;

    // New collection: rename the default mode instead of adding
    if (isNewCol && isFirstMode) {
        col.renameMode(col.defaultModeId, modeName);
        return col.defaultModeId;
    }

    return col.addMode(modeName);
}

/**
 * Build a name → Variable map for all variables in a collection.
 * Used to look up existing variables for in-place updates.
 */
function buildVarNameMap(col) {
    const map = {};
    for (const varId of col.variableIds) {
        const v = figma.variables.getVariableById(varId);
        if (v) map[v.name] = v;
    }
    return map;
}

/**
 * Find an existing variable by display name in a collection, or create one.
 * Mutates existingVarMap to register newly created variables for later lookups.
 */
function getOrCreateVariable(displayName, col, figmaType, existingVarMap) {
    if (existingVarMap[displayName]) {
        const existing = existingVarMap[displayName];
        if (existing.resolvedType === figmaType) return existing;
        if (typeof existing.remove === 'function') {
            existing.remove();
            delete existingVarMap[displayName];
        } else {
            throw new Error(`Existing variable "${displayName}" has incompatible type ${existing.resolvedType}`);
        }
    }
    const v = figma.variables.createVariable(displayName, col, figmaType);
    existingVarMap[displayName] = v;
    return v;
}

/**
 * Build a name → PaintStyle map for all local paint styles.
 */
function buildStyleNameMap() {
    const map = {};
    for (const style of figma.getLocalPaintStyles()) {
        map[style.name] = style;
    }
    return map;
}

/**
 * Find an existing paint style by name, or create one.
 */
function getOrCreatePaintStyle(name, existingStyleMap) {
    if (existingStyleMap[name]) return existingStyleMap[name];
    const style = figma.createPaintStyle();
    style.name = name;
    existingStyleMap[name] = style;
    return style;
}

function titleCaseCollectionName(name) {
    if (!name) return name;
    return name.charAt(0).toUpperCase() + name.slice(1);
}

function normalizeModeName(name) {
    if (!name) return name;
    return name.charAt(0).toUpperCase() + name.slice(1);
}

function getPrimitiveSetKey(data) {
    if (data.Primitive) return 'Primitive';
    if (data.primitive) return 'primitive';
    return null;
}

function analyzePayload(data) {
    const primitiveKey = getPrimitiveSetKey(data);
    const collectionMap = {};
    const topLevelKeys = Object.keys(data).filter(k => !k.startsWith('$'));
    const splitSetKeys = topLevelKeys.filter(k => k.includes('/'));

    if (splitSetKeys.length) {
        for (const key of splitSetKeys) {
            const [collectionName, rawModeName] = key.split('/');
            if (!collectionName || !rawModeName) continue;
            const normalizedCollectionKey = collectionName.toLowerCase();
            if (!collectionMap[normalizedCollectionKey]) {
                collectionMap[normalizedCollectionKey] = {
                    key: normalizedCollectionKey,
                    figmaName: titleCaseCollectionName(collectionName),
                    modes: {}
                };
            }
            collectionMap[normalizedCollectionKey].modes[normalizeModeName(rawModeName)] = data[key];
        }
    } else if (data.Light || data.Dark) {
        for (const modeName of ['Light', 'Dark']) {
            const modeRoot = data[modeName];
            if (!modeRoot || typeof modeRoot !== 'object') continue;
            for (const [collectionName, subtree] of Object.entries(modeRoot)) {
                if (collectionName.startsWith('$')) continue;
                const normalizedCollectionKey = collectionName.toLowerCase();
                if (!collectionMap[normalizedCollectionKey]) {
                    collectionMap[normalizedCollectionKey] = {
                        key: normalizedCollectionKey,
                        figmaName: titleCaseCollectionName(collectionName),
                        modes: {}
                    };
                }
                collectionMap[normalizedCollectionKey].modes[modeName] = subtree;
            }
        }
    }

    const collections = Object.values(collectionMap).sort((a, b) => {
        const aIndex = COLLECTION_ORDER.indexOf(a.key);
        const bIndex = COLLECTION_ORDER.indexOf(b.key);
        if (aIndex === -1 && bIndex === -1) return a.key.localeCompare(b.key);
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
    });

    return { primitiveKey, collections };
}

function sortModeNames(modeNames) {
    const preferredOrder = ['Light', 'Dark'];
    return [...modeNames].sort((a, b) => {
        const aIndex = preferredOrder.indexOf(a);
        const bIndex = preferredOrder.indexOf(b);
        if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
    });
}

function safelySetValueForMode(variable, modeId, value, path, addUnsupported) {
    try {
        variable.setValueForMode(modeId, value);
        return true;
    } catch (err) {
        addUnsupported(path, `setValueForMode failed: ${err.message}`);
        return false;
    }
}

// ─── Main import ───────────────────────────────────────────────────────────

async function importVariables(data) {
    const report = {
        unsupported: []
    };

    function addUnsupported(path, reason) {
        report.unsupported.push({ path, reason });
    }

    const payload = analyzePayload(data);
    if (!payload.primitiveKey) {
        throw new Error('Missing primitive token set');
    }

    // ── 1. PRIMITIVE collection (find or create, update in place) ────────────

    const { col: primCol, isNew: primIsNew } = getOrCreateCollection('Primitive');
    const primLightModeId = ensureMode(primCol, 'Light', primIsNew, true);
    const primDarkModeId = ensureMode(primCol, 'Dark', primIsNew, false);

    const primTokens = flattenTokens(data[payload.primitiveKey] || {}, '');

    // Existing variables in this collection (name → Variable)
    const primExistingVars = buildVarNameMap(primCol);

    // Path → Variable map used for alias resolution across collections.
    const aliasVarMap = {};

    function registerPrimitiveAliases(tokenPath, variable) {
        aliasVarMap[tokenPath] = variable;
        aliasVarMap[tokenPath.replace(/^primitive\./, '')] = variable;
    }

    function registerCollectionAliases(collectionKey, modeName, tokenPath, variable) {
        aliasVarMap[`${collectionKey}.${tokenPath}`] = variable;
        aliasVarMap[`${collectionKey}/${modeName.toLowerCase()}.${tokenPath}`] = variable;
        aliasVarMap[`${collectionKey}/${modeName}.${tokenPath}`] = variable;
    }

    for (const token of primTokens) {
        if (isMissingValue(token.value)) continue;
        const displayName = token.path.replace(/^primitive\./, '').replace(/\./g, '/');
        const figmaType = TYPE_MAP[token.type] || 'STRING';
        if (!TYPE_MAP[token.type]) {
            addUnsupported(token.path, `Unsupported primitive token type "${token.type}"`);
            continue;
        }

        const variable = getOrCreateVariable(displayName, primCol, figmaType, primExistingVars);
        if (token.description) variable.description = token.description;

        // Hide primitives: not visible in publish panel or inspector
        variable.hiddenFromPublishing = true;
        variable.scopes = [];

        const val = resolvePrimitiveValue(token.type, token.value);
        if (val !== null) {
            safelySetValueForMode(variable, primLightModeId, val, token.path, addUnsupported);
            safelySetValueForMode(variable, primDarkModeId, val, token.path, addUnsupported);
        } else {
            addUnsupported(token.path, `Unsupported primitive value for type "${token.type}"`);
        }

        registerPrimitiveAliases(token.path, variable);
    }
    const existingStyleMap = buildStyleNameMap();

    function resolveAlias(rawValue) {
        if (typeof rawValue === 'string' && rawValue.startsWith('{') && rawValue.endsWith('}')) {
            const refPath = rawValue.slice(1, -1);
            const refVar = aliasVarMap[refPath] || aliasVarMap[refPath.replace(/^primitive\./, '')];
            if (refVar) return { type: 'VARIABLE_ALIAS', id: refVar.id };
            return null;
        }
        return null;
    }

    function resolveTokenValue(path, tokenType, rawValue) {
        if (isMissingValue(rawValue)) return null;
        const alias = resolveAlias(rawValue);
        if (alias) return alias;
        const resolved = resolvePrimitiveValue(tokenType, rawValue);
        if (resolved === null && isAliasLike(rawValue)) {
            addUnsupported(path, `Unresolved alias ${rawValue}`);
        }
        return resolved;
    }

    function upsertGradientStyle(path, name, tokenValue, description) {
        if (!tokenValue || !Array.isArray(tokenValue.stops)) {
            addUnsupported(path, 'Gradient token is missing stops');
            return;
        }
        const style = getOrCreatePaintStyle(name, existingStyleMap);
        if (description) style.description = description;

        const stops = tokenValue.stops.map(s => {
            const hexOrAlias = s.color;
            let rgb = { r: 0, g: 0, b: 0, a: 1 };
            let colorBinding = null;

            if (typeof hexOrAlias === 'string' && hexOrAlias.startsWith('{')) {
                const refPath = hexOrAlias.slice(1, -1);
                const refVar = aliasVarMap[refPath] || aliasVarMap[refPath.replace(/^primitive\./, '')];
                if (refVar) {
                    const val = refVar.valuesByMode[Object.keys(refVar.valuesByMode)[0]];
                    if (val) rgb = { r: val.r, g: val.g, b: val.b, a: val.a !== undefined ? val.a : 1 };
                    colorBinding = { type: 'VARIABLE_ALIAS', id: refVar.id };
                } else {
                    addUnsupported(path, `Unresolved gradient alias ${hexOrAlias}`);
                }
            } else {
                const parsed = parseFigmaColor(hexOrAlias);
                if (parsed) rgb = parsed;
                else addUnsupported(path, `Unsupported gradient stop color ${hexOrAlias}`);
            }
            const stop = { position: s.position, color: rgb };
            if (colorBinding) {
                stop.boundVariables = { color: colorBinding };
            }
            return stop;
        });

        const gradientPaint = {
            type: 'GRADIENT_LINEAR',
            gradientTransform: [
                [0, 1, 0],
                [-1, 0, 1]
            ],
            gradientStops: stops
        };

        try {
            style.paints = [gradientPaint];
        } catch (err) {
            // Fallback for runtimes that reject variable-bound gradient stops.
            const fallbackPaint = {
                type: 'GRADIENT_LINEAR',
                gradientTransform: gradientPaint.gradientTransform,
                gradientStops: stops.map(({ position, color }) => ({ position, color }))
            };
            style.paints = [fallbackPaint];
            addUnsupported(path, `Gradient stop variable binding not applied: ${err.message}`);
        }
    }

    for (const collection of payload.collections) {
        const modeNames = sortModeNames(Object.keys(collection.modes));
        if (!modeNames.length) continue;

        const { col, isNew } = getOrCreateCollection(collection.figmaName);
        const modeIds = {};
        for (let index = 0; index < modeNames.length; index += 1) {
            modeIds[modeNames[index]] = ensureMode(col, modeNames[index], isNew, index === 0);
        }
        const existingVars = buildVarNameMap(col);

        const tokensByMode = {};
        const tokenPaths = [];
        const seenPaths = new Set();
        for (const modeName of modeNames) {
            const tokens = flattenTokens(collection.modes[modeName] || {}, '');
            const byPath = {};
            for (const token of tokens) {
                byPath[token.path] = token;
                if (!seenPaths.has(token.path)) {
                    seenPaths.add(token.path);
                    tokenPaths.push(token.path);
                }
            }
            tokensByMode[modeName] = byPath;
        }

        for (const tokenPath of tokenPaths) {
            const seedToken = modeNames.map(modeName => tokensByMode[modeName][tokenPath]).find(Boolean);
            if (!seedToken || isMissingValue(seedToken.value)) continue;

            const displayName = tokenPath.replace(/\./g, '/');
            if (seedToken.type === 'gradient') {
                try {
                    for (const modeName of modeNames) {
                        const modeToken = tokensByMode[modeName][tokenPath];
                        if (!modeToken || isMissingValue(modeToken.value)) continue;
                        upsertGradientStyle(
                            `${collection.key}.${tokenPath}`,
                            `${collection.figmaName}/${modeName}/${displayName}`,
                            modeToken.value,
                            modeToken.description
                        );
                    }
                } catch (e) {
                    addUnsupported(`${collection.key}.${tokenPath}`, `Gradient import failed: ${e.message}`);
                }
                continue;
            }

            const figmaType = TYPE_MAP[seedToken.type] || 'STRING';
            if (!TYPE_MAP[seedToken.type]) {
                addUnsupported(`${collection.key}.${tokenPath}`, `Unsupported token type "${seedToken.type}"`);
                continue;
            }

            const variable = getOrCreateVariable(displayName, col, figmaType, existingVars);
            if (seedToken.description) variable.description = seedToken.description;

            for (const modeName of modeNames) {
                const modeToken = tokensByMode[modeName][tokenPath];
                if (!modeToken || isMissingValue(modeToken.value)) continue;
                if ((TYPE_MAP[modeToken.type] || 'STRING') !== figmaType) {
                    addUnsupported(`${collection.key}.${tokenPath}`, `Mode type mismatch in ${modeName}`);
                    continue;
                }
                const resolvedValue = resolveTokenValue(`${collection.key}.${tokenPath}`, modeToken.type, modeToken.value);
                if (resolvedValue !== null) {
                    safelySetValueForMode(
                        variable,
                        modeIds[modeName],
                        resolvedValue,
                        `${collection.key}/${modeName.toLowerCase()}.${tokenPath}`,
                        addUnsupported
                    );
                }
                registerCollectionAliases(collection.key, modeName, tokenPath, variable);
            }
        }
    }

    return report;
}

// ─── Primitive value resolver ────────────────────────────────────────────────

function isAliasLike(rawValue) {
    return typeof rawValue === 'string' && rawValue.startsWith('{') && rawValue.endsWith('}');
}

function resolvePrimitiveValue(tokenType, rawValue) {
    const figmaType = TYPE_MAP[tokenType] || 'STRING';
    if (figmaType === 'COLOR') return parseFigmaColor(rawValue);
    if (figmaType === 'FLOAT') {
        const n = parseFloat(rawValue);
        return isNaN(n) ? null : n;
    }
    if (figmaType === 'BOOLEAN') {
        if (typeof rawValue === 'boolean') return rawValue;
        return rawValue === 'true' || rawValue === true;
    }
    // STRING — return as-is
    return rawValue !== undefined ? String(rawValue) : null;
}

// ─── Token Sheet Generator ───────────────────────────────────────────────────

const SHEET_CARD_W = 172;
const SHEET_CARD_H = 132;
const SHEET_SWATCH_H = 72;
const SHEET_GAP = 12;
const SHEET_PADDING = 56;
const SHEET_WIDTH = 1280;
const SHEET_INNER_W = SHEET_WIDTH - SHEET_PADDING * 2;
const SHEET_COLS = Math.floor((SHEET_INNER_W + SHEET_GAP) / (SHEET_CARD_W + SHEET_GAP));
const C_PRIMARY = { r: 0.067, g: 0.114, b: 0.29 };

async function generateTokenSheet() {
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });

    const collections  = figma.variables.getLocalVariableCollections();
    const paintStyles  = figma.getLocalPaintStyles();
    const textStyles   = figma.getLocalTextStyles();
    const effectStyles = figma.getLocalEffectStyles();

    // Pre-load every font referenced by text styles
    if (textStyles.length) {
        const fontSet = new Map();
        for (const s of textStyles) fontSet.set(JSON.stringify(s.fontName), s.fontName);
        await Promise.all([...fontSet.values()].map(f => figma.loadFontAsync(f)));
    }

    const sheet = figma.createFrame();
    sheet.name = 'Design Token Reference';
    sheet.layoutMode = 'VERTICAL';
    sheet.primaryAxisSizingMode = 'AUTO';
    sheet.counterAxisSizingMode = 'FIXED';
    sheet.resize(SHEET_WIDTH, 100);
    sheet.paddingTop = sheet.paddingBottom = SHEET_PADDING;
    sheet.paddingLeft = sheet.paddingRight = SHEET_PADDING;
    sheet.itemSpacing = 64;
    sheet.fills = [{ type: 'SOLID', color: { r: 0.976, g: 0.98, b: 0.984 } }];

    let hasContent = false;

    // ── Variables ────────────────────────────────────────────────────────────
    for (const col of collections) {
        const allVars = col.variableIds.map(id => figma.variables.getVariableById(id)).filter(Boolean);
        const colorVars  = allVars.filter(v => v.resolvedType === 'COLOR');
        const floatVars  = allVars.filter(v => v.resolvedType === 'FLOAT');
        const stringVars = allVars.filter(v => v.resolvedType === 'STRING');
        if (!colorVars.length && !floatVars.length && !stringVars.length) continue;

        const lightModeId = (col.modes.find(m => m.name === 'Light') || col.modes[0]).modeId;
        const colFrame = sheetVFrame(col.name, SHEET_INNER_W, 32);
        colFrame.appendChild(sheetText(col.name, 'Semi Bold', 20, C_PRIMARY));

        if (colorVars.length)  colFrame.appendChild(buildColorSection(colorVars, lightModeId));
        if (floatVars.length)  colFrame.appendChild(buildTokenListSection('Dimensions & Numbers', floatVars, lightModeId, 'FLOAT'));
        if (stringVars.length) colFrame.appendChild(buildTokenListSection('Strings', stringVars, lightModeId, 'STRING'));

        sheet.appendChild(colFrame);
        hasContent = true;
    }

    // ── Styles ───────────────────────────────────────────────────────────────
    if (paintStyles.length) {
        sheet.appendChild(buildPaintStylesSection(paintStyles));
        hasContent = true;
    }
    if (textStyles.length) {
        sheet.appendChild(buildTextStylesSection(textStyles));
        hasContent = true;
    }
    if (effectStyles.length) {
        sheet.appendChild(buildEffectStylesSection(effectStyles));
        hasContent = true;
    }

    if (!hasContent) {
        sheet.remove();
        throw new Error('No variables or styles found — run Import Variables first');
    }

    let maxX = 0;
    for (const node of figma.currentPage.children) {
        if (node !== sheet) maxX = Math.max(maxX, node.x + node.width);
    }
    sheet.x = maxX > 0 ? maxX + 120 : 0;
    sheet.y = 0;

    figma.currentPage.appendChild(sheet);
    figma.viewport.scrollAndZoomIntoView([sheet]);
}

// ── Color section (card grid) ─────────────────────────────────────────────────

function buildColorSection(colorVars, lightModeId) {
    const section = sheetVFrame('Colors', SHEET_INNER_W, 20);
    section.appendChild(sheetText('Colors', 'Semi Bold', 14, C_PRIMARY, 0.5));

    for (const [groupName, vars] of Object.entries(groupByPrefix(colorVars))) {
        const groupFrame = sheetVFrame(groupName, SHEET_INNER_W, SHEET_GAP);
        groupFrame.appendChild(sheetText(groupName.toUpperCase(), 'Regular', 11, C_PRIMARY, 0.35));

        let row = null;
        vars.forEach((v, i) => {
            if (i % SHEET_COLS === 0) {
                row = sheetHFrame('row-' + Math.floor(i / SHEET_COLS), SHEET_GAP);
                groupFrame.appendChild(row);
            }
            row.appendChild(buildColorCard(v, lightModeId));
        });
        section.appendChild(groupFrame);
    }
    return section;
}

function buildColorCard(variable, lightModeId) {
    const card = figma.createFrame();
    card.name = variable.name.split('/').pop();
    card.layoutMode = 'VERTICAL';
    card.primaryAxisSizingMode = 'FIXED';
    card.counterAxisSizingMode = 'FIXED';
    card.resize(SHEET_CARD_W, SHEET_CARD_H);
    card.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    card.cornerRadius = 10;
    card.strokes = [{ type: 'SOLID', color: C_PRIMARY, opacity: 0.08 }];
    card.strokeWeight = 1;
    card.clipsContent = true;
    card.itemSpacing = 0;

    // Swatch — fill bound to variable
    const swatch = figma.createFrame();
    swatch.name = 'swatch';
    swatch.resize(SHEET_CARD_W, SHEET_SWATCH_H);
    const resolved = resolveColorValue(variable, lightModeId);
    swatch.fills = resolved
        ? [{ type: 'SOLID',
             color: { r: resolved.r, g: resolved.g, b: resolved.b },
             opacity: typeof resolved.a === 'number' ? resolved.a : 1,
             boundVariables: { color: { type: 'VARIABLE_ALIAS', id: variable.id } } }]
        : [{ type: 'SOLID', color: { r: 0.94, g: 0.94, b: 0.94 } }];
    card.appendChild(swatch);

    // Meta
    const meta = sheetVFrame('meta', SHEET_CARD_W, 3);
    meta.fills = [];
    meta.paddingTop = meta.paddingBottom = 7;
    meta.paddingLeft = meta.paddingRight = 10;

    const rawVal = variable.valuesByMode[lightModeId]
        || variable.valuesByMode[Object.keys(variable.valuesByMode)[0]];
    let valStr;
    if (rawVal && rawVal.type === 'VARIABLE_ALIAS') {
        const refVar = figma.variables.getVariableById(rawVal.id);
        valStr = refVar ? '\u21B3 ' + refVar.name : '(alias)';
    } else {
        valStr = resolved ? colorToString(resolved) : '\u2014';
    }

    meta.appendChild(sheetText(variable.name.split('/').pop(), 'Semi Bold', 11, C_PRIMARY));
    meta.appendChild(sheetText(variable.name, 'Regular', 9, C_PRIMARY, 0.35));
    meta.appendChild(sheetText(valStr, 'Regular', 10, C_PRIMARY, 0.5));
    card.appendChild(meta);
    return card;
}

// ── Token list section (FLOAT / STRING) ───────────────────────────────────────

function buildTokenListSection(title, vars, lightModeId, resolvedType) {
    const section = sheetVFrame(title, SHEET_INNER_W, 12);
    section.appendChild(sheetText(title, 'Semi Bold', 14, C_PRIMARY, 0.5));

    for (const [groupName, groupVars] of Object.entries(groupByPrefix(vars))) {
        const groupFrame = sheetVFrame(groupName, SHEET_INNER_W, 4);
        groupFrame.appendChild(sheetText(groupName.toUpperCase(), 'Regular', 11, C_PRIMARY, 0.35));

        for (const v of groupVars) {
            groupFrame.appendChild(buildTokenRow(v, lightModeId, resolvedType));
        }
        section.appendChild(groupFrame);
    }
    return section;
}

function buildTokenRow(variable, lightModeId, resolvedType) {
    const isString = resolvedType === 'STRING';

    // Resolve value first so we can inspect it for size detection
    const rawVal = variable.valuesByMode[lightModeId]
        || variable.valuesByMode[Object.keys(variable.valuesByMode)[0]];
    let valStr = '\u2014';
    let leafVal = rawVal;
    if (rawVal && typeof rawVal === 'object' && rawVal.type === 'VARIABLE_ALIAS') {
        const refVar = figma.variables.getVariableById(rawVal.id);
        const resolvedLeaf = refVar ? resolveValue(refVar, lightModeId) : null;
        leafVal = resolvedLeaf;
        valStr = refVar
            ? '\u21B3 ' + refVar.name + (resolvedLeaf !== null && resolvedLeaf !== undefined
                ? '  (' + formatTokenValue(resolvedLeaf, resolvedType) + ')' : '')
            : '(alias)';
    } else if (rawVal !== null && rawVal !== undefined) {
        valStr = formatTokenValue(rawVal, resolvedType);
        leafVal = rawVal;
    }

    // Detect numeric value to show scale bar (FLOAT always; STRING only with size units)
    let sizeValue = null;
    if (!isString) {
        const n = typeof leafVal === 'number' ? leafVal : parseFloat(leafVal);
        if (!isNaN(n) && n >= 0) sizeValue = n;
    } else {
        sizeValue = parseSizeValue(typeof leafVal === 'string' ? leafVal : '');
    }
    const isSizeString = sizeValue !== null;

    const row = figma.createFrame();
    row.name = variable.name.split('/').pop();
    row.layoutMode = 'HORIZONTAL';
    row.paddingTop = row.paddingBottom = 10;
    row.paddingLeft = row.paddingRight = 14;
    row.itemSpacing = 12;
    row.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    row.cornerRadius = 8;
    row.strokes = [{ type: 'SOLID', color: C_PRIMARY, opacity: 0.08 }];
    row.strokeWeight = 1;

    if (isString && !isSizeString) {
        // Pure string (e.g. font family) — hug content
        row.primaryAxisSizingMode = 'AUTO';
        row.counterAxisSizingMode = 'AUTO';
    } else {
        // Fixed width, height hugs (FLOAT and size-like STRING)
        row.resize(SHEET_INNER_W, 44);
        row.primaryAxisSizingMode = 'FIXED';
        row.counterAxisSizingMode = 'AUTO';
        row.primaryAxisAlignItems = 'SPACE_BETWEEN';
    }
    row.counterAxisAlignItems = 'CENTER';

    // Left: name + path [+ scale bar for size tokens]
    const left = sheetVFrame('left', 'auto', 2);
    left.fills = [];
    if (!isString || isSizeString) left.layoutGrow = 1;
    left.appendChild(sheetText(variable.name.split('/').pop(), 'Semi Bold', 12, C_PRIMARY));
    left.appendChild(sheetText(variable.name, 'Regular', 9, C_PRIMARY, 0.35));

    if (isSizeString) {
        const TRACK_W = 240;
        const barTrack = figma.createFrame();
        barTrack.name = 'bar-track';
        barTrack.layoutMode = 'HORIZONTAL';
        barTrack.primaryAxisSizingMode = 'FIXED';
        barTrack.counterAxisSizingMode = 'FIXED';
        barTrack.resize(TRACK_W, 4);
        barTrack.cornerRadius = 2;
        barTrack.fills = [{ type: 'SOLID', color: { r: 0.067, g: 0.114, b: 0.29 }, opacity: 0.06 }];
        barTrack.clipsContent = true;
        barTrack.paddingTop = barTrack.paddingBottom = 0;
        barTrack.paddingLeft = barTrack.paddingRight = 0;

        const fillW = Math.min(Math.max(Math.round(sizeValue), 2), TRACK_W);
        const barFill = figma.createFrame();
        barFill.name = 'fill';
        barFill.resize(fillW, 4);
        barFill.fills = [{ type: 'SOLID', color: { r: 0, g: 0.498, b: 1 } }];
        barTrack.appendChild(barFill);
        left.appendChild(barTrack);
    }

    const valText = sheetText(valStr, 'Regular', 11, C_PRIMARY, 0.6);
    valText.textAlignHorizontal = 'RIGHT';

    row.appendChild(left);
    row.appendChild(valText);
    return row;
}

function formatTokenValue(val, resolvedType) {
    if (resolvedType === 'FLOAT') {
        const n = typeof val === 'number' ? val : parseFloat(val);
        return isNaN(n) ? String(val) : (Number.isInteger(n) ? n + 'px' : n.toFixed(2) + 'px');
    }
    return String(val);
}

/**
 * Parse a CSS size string to a pixel number.
 * Returns null for non-size strings (e.g. font family, font weight).
 */
function parseSizeValue(val) {
    if (typeof val !== 'string') return null;
    const pxMatch = val.match(/^([\d.]+)px$/i);
    if (pxMatch) return parseFloat(pxMatch[1]);
    const remMatch = val.match(/^([\d.]+)rem$/i);
    if (remMatch) return parseFloat(remMatch[1]) * 16;
    const emMatch = val.match(/^([\d.]+)em$/i);
    if (emMatch) return parseFloat(emMatch[1]) * 16;
    return null;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function groupByPrefix(vars) {
    const groups = {};
    for (const v of vars) {
        const key = v.name.split('/')[0];
        if (!groups[key]) groups[key] = [];
        groups[key].push(v);
    }
    return groups;
}

function sheetVFrame(name, width, itemSpacing) {
    const f = figma.createFrame();
    f.name = name;
    f.layoutMode = 'VERTICAL';
    f.primaryAxisSizingMode = 'AUTO';
    f.fills = [];
    f.itemSpacing = itemSpacing || 0;
    if (width === 'auto') {
        f.counterAxisSizingMode = 'AUTO';
    } else {
        f.counterAxisSizingMode = 'FIXED';
        f.resize(width, 100);
    }
    return f;
}

function sheetHFrame(name, itemSpacing) {
    const f = figma.createFrame();
    f.name = name;
    f.layoutMode = 'HORIZONTAL';
    f.primaryAxisSizingMode = 'AUTO';
    f.counterAxisSizingMode = 'AUTO';
    f.fills = [];
    f.itemSpacing = itemSpacing || 0;
    return f;
}

function sheetText(characters, style, fontSize, color, opacity) {
    const t = figma.createText();
    t.fontName = { family: 'Inter', style: style };
    t.fontSize = fontSize;
    t.characters = characters || '';
    t.fills = [{ type: 'SOLID', color: color, opacity: opacity !== undefined ? opacity : 1 }];
    t.textAutoResize = 'WIDTH_AND_HEIGHT';
    return t;
}

/**
 * Resolve any VARIABLE_ALIAS chain to the leaf value.
 * Works for COLOR, FLOAT, STRING — returns raw value.
 */
function resolveValue(variable, preferredModeId, depth) {
    if (!depth) depth = 0;
    if (depth > 6) return null;
    const val = variable.valuesByMode[preferredModeId]
        || variable.valuesByMode[Object.keys(variable.valuesByMode)[0]];
    if (val === null || val === undefined) return null;
    if (val && typeof val === 'object' && val.type === 'VARIABLE_ALIAS') {
        const refVar = figma.variables.getVariableById(val.id);
        if (!refVar) return null;
        const refCol = figma.variables.getLocalVariableCollections()
            .find(c => c.variableIds.includes(refVar.id));
        const refModeId = refCol
            ? ((refCol.modes.find(m => m.name === 'Light') || refCol.modes[0]).modeId)
            : preferredModeId;
        return resolveValue(refVar, refModeId, depth + 1);
    }
    return val;
}

function resolveColorValue(variable, preferredModeId) {
    const val = resolveValue(variable, preferredModeId);
    return val && typeof val.r === 'number' ? val : null;
}

function colorToString(c) {
    const r = Math.round(c.r * 255);
    const g = Math.round(c.g * 255);
    const b = Math.round(c.b * 255);
    const a = typeof c.a === 'number' ? c.a : 1;
    if (a < 1) {
        return 'rgba(' + r + ',' + g + ',' + b + ',' + Math.round(a * 100) / 100 + ')';
    }
    return ('#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')).toUpperCase();
}

// ─── Style Sections ──────────────────────────────────────────────────────────

// ── Paint Styles ─────────────────────────────────────────────────────────────

function buildPaintStylesSection(paintStyles) {
    const section = sheetVFrame('Paint Styles', SHEET_INNER_W, 32);
    section.appendChild(sheetText('Paint Styles', 'Semi Bold', 20, C_PRIMARY));

    for (const [groupName, styles] of Object.entries(groupByPrefix(paintStyles))) {
        const groupFrame = sheetVFrame(groupName, SHEET_INNER_W, SHEET_GAP);
        groupFrame.appendChild(sheetText(groupName.toUpperCase(), 'Regular', 11, C_PRIMARY, 0.35));

        let row = null;
        styles.forEach((style, i) => {
            if (i % SHEET_COLS === 0) {
                row = sheetHFrame('row-' + Math.floor(i / SHEET_COLS), SHEET_GAP);
                groupFrame.appendChild(row);
            }
            row.appendChild(buildPaintStyleCard(style));
        });
        section.appendChild(groupFrame);
    }
    return section;
}

function buildPaintStyleCard(style) {
    const card = figma.createFrame();
    card.name = style.name.split('/').pop();
    card.layoutMode = 'VERTICAL';
    card.primaryAxisSizingMode = 'FIXED';
    card.counterAxisSizingMode = 'FIXED';
    card.resize(SHEET_CARD_W, SHEET_CARD_H);
    card.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    card.cornerRadius = 10;
    card.strokes = [{ type: 'SOLID', color: C_PRIMARY, opacity: 0.08 }];
    card.strokeWeight = 1;
    card.clipsContent = true;
    card.itemSpacing = 0;

    const swatch = figma.createFrame();
    swatch.name = 'swatch';
    swatch.resize(SHEET_CARD_W, SHEET_SWATCH_H);
    swatch.fills = style.paints.length ? style.paints : [{ type: 'SOLID', color: { r: 0.94, g: 0.94, b: 0.94 } }];
    card.appendChild(swatch);

    const meta = sheetVFrame('meta', SHEET_CARD_W, 3);
    meta.fills = [];
    meta.paddingTop = meta.paddingBottom = 7;
    meta.paddingLeft = meta.paddingRight = 10;

    const firstPaint = style.paints[0];
    let valStr = '—';
    if (firstPaint) {
        if (firstPaint.type === 'SOLID') {
            const a = firstPaint.opacity !== undefined ? firstPaint.opacity : 1;
            valStr = colorToString({ r: firstPaint.color.r, g: firstPaint.color.g, b: firstPaint.color.b, a: a });
        } else {
            const typeLabel = { GRADIENT_LINEAR: 'Linear', GRADIENT_RADIAL: 'Radial',
                GRADIENT_ANGULAR: 'Angular', GRADIENT_DIAMOND: 'Diamond' }[firstPaint.type] || 'Gradient';
            valStr = typeLabel + ' · ' + (firstPaint.gradientStops ? firstPaint.gradientStops.length : 0) + ' stops';
        }
    }

    meta.appendChild(sheetText(style.name.split('/').pop(), 'Semi Bold', 11, C_PRIMARY));
    meta.appendChild(sheetText(style.name, 'Regular', 9, C_PRIMARY, 0.35));
    meta.appendChild(sheetText(valStr, 'Regular', 10, C_PRIMARY, 0.5));
    card.appendChild(meta);
    return card;
}

// ── Text Styles ───────────────────────────────────────────────────────────────

function buildTextStylesSection(textStyles) {
    const section = sheetVFrame('Text Styles', SHEET_INNER_W, 32);
    section.appendChild(sheetText('Text Styles', 'Semi Bold', 20, C_PRIMARY));

    for (const [groupName, styles] of Object.entries(groupByPrefix(textStyles))) {
        const groupFrame = sheetVFrame(groupName, SHEET_INNER_W, 4);
        groupFrame.appendChild(sheetText(groupName.toUpperCase(), 'Regular', 11, C_PRIMARY, 0.35));
        for (const s of styles) groupFrame.appendChild(buildTextStyleRow(s));
        section.appendChild(groupFrame);
    }
    return section;
}

function buildTextStyleRow(style) {
    const row = figma.createFrame();
    row.name = style.name.split('/').pop();
    row.layoutMode = 'HORIZONTAL';
    row.resize(SHEET_INNER_W, 44);
    row.primaryAxisSizingMode = 'FIXED';
    row.counterAxisSizingMode = 'AUTO';
    row.paddingTop = row.paddingBottom = 14;
    row.paddingLeft = row.paddingRight = 16;
    row.itemSpacing = 20;
    row.primaryAxisAlignItems = 'SPACE_BETWEEN';
    row.counterAxisAlignItems = 'CENTER';
    row.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    row.cornerRadius = 8;
    row.strokes = [{ type: 'SOLID', color: C_PRIMARY, opacity: 0.08 }];
    row.strokeWeight = 1;

    // Sample "Ag" rendered in the actual text style
    const sample = figma.createText();
    sample.characters = 'Ag';
    try {
        sample.textStyleId = style.id;
    } catch (_) {
        sample.fontName = style.fontName;
        sample.fontSize = style.fontSize;
    }
    sample.fills = [{ type: 'SOLID', color: C_PRIMARY }];
    sample.textAutoResize = 'WIDTH_AND_HEIGHT';

    // Right: name + path + specs
    const info = sheetVFrame('info', 'auto', 3);
    info.fills = [];
    info.layoutGrow = 1;
    info.appendChild(sheetText(style.name.split('/').pop(), 'Semi Bold', 12, C_PRIMARY));
    info.appendChild(sheetText(style.name, 'Regular', 9, C_PRIMARY, 0.35));
    const specs = style.fontName.family + ' · ' + style.fontSize + 'px · ' + style.fontName.style;
    info.appendChild(sheetText(specs, 'Regular', 10, C_PRIMARY, 0.5));

    row.appendChild(sample);
    row.appendChild(info);
    return row;
}

// ── Effect Styles ─────────────────────────────────────────────────────────────

function buildEffectStylesSection(effectStyles) {
    const section = sheetVFrame('Effect Styles', SHEET_INNER_W, 32);
    section.appendChild(sheetText('Effect Styles', 'Semi Bold', 20, C_PRIMARY));

    for (const [groupName, styles] of Object.entries(groupByPrefix(effectStyles))) {
        const groupFrame = sheetVFrame(groupName, SHEET_INNER_W, 4);
        groupFrame.appendChild(sheetText(groupName.toUpperCase(), 'Regular', 11, C_PRIMARY, 0.35));
        for (const s of styles) groupFrame.appendChild(buildEffectStyleRow(s));
        section.appendChild(groupFrame);
    }
    return section;
}

function buildEffectStyleRow(style) {
    const row = figma.createFrame();
    row.name = style.name.split('/').pop();
    row.layoutMode = 'HORIZONTAL';
    row.resize(SHEET_INNER_W, 44);
    row.primaryAxisSizingMode = 'FIXED';
    row.counterAxisSizingMode = 'AUTO';
    row.paddingTop = row.paddingBottom = 14;
    row.paddingLeft = row.paddingRight = 16;
    row.itemSpacing = 20;
    row.counterAxisAlignItems = 'CENTER';
    // Light bg so shadows are visible
    row.fills = [{ type: 'SOLID', color: { r: 0.976, g: 0.98, b: 0.984 } }];
    row.cornerRadius = 8;
    row.strokes = [{ type: 'SOLID', color: C_PRIMARY, opacity: 0.08 }];
    row.strokeWeight = 1;

    // Preview box with effects applied
    const preview = figma.createFrame();
    preview.resize(48, 48);
    preview.cornerRadius = 10;
    preview.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    try { preview.effects = style.effects; } catch (_) {}

    // Info
    const info = sheetVFrame('info', 'auto', 3);
    info.fills = [];
    info.layoutGrow = 1;
    info.appendChild(sheetText(style.name.split('/').pop(), 'Semi Bold', 12, C_PRIMARY));
    info.appendChild(sheetText(style.name, 'Regular', 9, C_PRIMARY, 0.35));
    const desc = style.effects.map(describeEffect).join(' + ') || '—';
    info.appendChild(sheetText(desc, 'Regular', 10, C_PRIMARY, 0.5));

    row.appendChild(preview);
    row.appendChild(info);
    return row;
}

function describeEffect(effect) {
    if (!effect.visible) return '(hidden)';
    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
        const label = effect.type === 'DROP_SHADOW' ? 'Drop Shadow' : 'Inner Shadow';
        const c = effect.color;
        const alpha = c ? Math.round((c.a || 1) * 100) + '%' : '';
        return label + ' · ' + effect.offsetX + ',' + effect.offsetY + ' blur ' + effect.radius + (alpha ? ' · ' + alpha : '');
    }
    if (effect.type === 'LAYER_BLUR')      return 'Blur · ' + effect.radius + 'px';
    if (effect.type === 'BACKGROUND_BLUR') return 'Backdrop Blur · ' + effect.radius + 'px';
    return effect.type;
}
