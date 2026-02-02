const path = require('path');

/**
 * Renames a file based on a set of rules.
 * @param {string} originalName - The original filename.
 * @param {number} index - The index of the file in the list.
 * @param {Array} rules - Array of cleaning/renaming rules.
 * @returns {string} - The new filename.
 */
function applyRenamingRules(originalName, index, rules) {
    let ext = path.extname(originalName);
    let name = path.basename(originalName, ext);
    let newName = name;

    // Apply rules in order
    for (const rule of rules) {
        switch (rule.type) {
            case 'replace':
                if (rule.find) {
                    // Use global replace if specified, otherwise single
                    const regex = new RegExp(escapeRegExp(rule.find), 'g');
                    newName = newName.replace(regex, rule.replace || '');
                }
                break;
            case 'regex':
                if (rule.pattern) {
                    try {
                        const regex = new RegExp(rule.pattern, rule.flags || 'g');
                        newName = newName.replace(regex, rule.replace || '');
                    } catch (e) {
                        // Ignore invalid regex
                        console.warn('Invalid regex in rule:', rule);
                    }
                }
                break;
            case 'trim':
                newName = newName.trim();
                break;
            case 'normalize_space':
                newName = newName.replace(/\s+/g, ' ');
                break;
            case 'lowercase':
                newName = newName.toLowerCase();
                break;
            case 'uppercase':
                newName = newName.toUpperCase();
                break;
            case 'prefix':
                if (rule.text) newName = rule.text + newName;
                break;
            case 'suffix':
                if (rule.text) newName = newName + rule.text;
                break;
            case 'remove_special':
                newName = newName.replace(/[^a-zA-Z0-9\s-_]/g, '');
                break;
            case 'kebab_case':
                newName = newName.replace(/([a-z])([A-Z])/g, '$1-$2')
                    .replace(/[\s_]+/g, '-')
                    .toLowerCase();
                break;
            case 'numbering':
                // Appends a number at end (or start if configured)
                const num = String(index + (rule.start || 1)).padStart(rule.padding || 1, '0');
                if (rule.position === 'start') {
                    newName = num + (rule.separator || '-') + newName;
                } else {
                    newName = newName + (rule.separator || '-') + num;
                }
                break;
        }
    }

    // Ensure extension is kept or modified if needed (feature creep protected: keep ext for now)
    return newName + ext;
}

// Utility to escape regex characters in user input
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

module.exports = { applyRenamingRules };
