const path = require('path');

const OS_LIMITS = {
    windows: 260,
    linux: 4096,
    macos: 1024
};

const INVALID_CHARS = {
    windows: /[<>:"|?*\x00-\x1F]/g,
    macos: /[:/\x00]/g,
    linux: /[\x00]/g
};

const RESERVED_NAMES_WINDOWS = new Set([
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

const SYSTEM_FILE_PATTERNS = {
    '__MACOSX': /\/__MACOSX\//,
    '.DS_Store': /\.DS_Store$/,
    'Thumbs.db': /Thumbs\.db$/i,
    'desktop.ini': /desktop\.ini$/i,
    '.git': /\/\.git\//
};

function analyzeArchive(files) {
    const stats = calculateStats(files);
    
    const pathWarnings = [];
    const invalidCharWarnings = [];
    const unicodeWarnings = [];
    
    for (const file of files) {
        if (!file.isDirectory) {
            checkPathLength(file, pathWarnings);
            checkInvalidChars(file, invalidCharWarnings);
            checkUnicode(file, unicodeWarnings);
        }
    }
    
    const duplicateWarnings = detectDuplicates(files);
    const systemFiles = detectSystemFiles(files);
    const conflicts = simulateRenameConflicts(files);
    
    const warnings = {
        renameConflicts: conflicts,
        pathTooLong: pathWarnings,
        duplicateNames: duplicateWarnings,
        invalidChars: invalidCharWarnings,
        unicodeIssues: unicodeWarnings,
        systemFiles
    };
    
    return {
        stats,
        warnings,
        severity: calculateSeverity(warnings),
        timestamp: new Date().toISOString()
    };
}

function calculateStats(files) {
    let totalFiles = 0;
    let totalDirectories = 0;
    let totalSize = 0;
    let maxDepth = 0;
    let largestFile = null;
    
    for (const file of files) {
        if (file.isDirectory) {
            totalDirectories++;
        } else {
            totalFiles++;
            const size = file.size || 0;
            totalSize += size;
            
            if (!largestFile || size > largestFile.size) {
                largestFile = {
                    path: file.originalName,
                    size
                };
            }
        }
        
        const depth = file.originalName.split('/').length - 1;
        if (depth > maxDepth) {
            maxDepth = depth;
        }
    }
    
    return {
        totalFiles,
        totalDirectories,
        totalSize,
        maxDepth,
        largestFile: largestFile || { path: '', size: 0 }
    };
}

function checkPathLength(file, warnings) {
    const fullPath = file.originalName;
    const length = Buffer.byteLength(fullPath, 'utf8');
    
    for (const [os, limit] of Object.entries(OS_LIMITS)) {
        if (length > limit) {
            warnings.push({
                path: fullPath,
                length,
                os,
                limit
            });
        }
    }
}

function checkInvalidChars(file, warnings) {
    const filename = file.originalName;
    
    for (const [os, regex] of Object.entries(INVALID_CHARS)) {
        const matches = filename.match(regex);
        if (matches) {
            warnings.push({
                path: filename,
                invalidChars: [...new Set(matches.map(c => 
                    c.charCodeAt(0) < 32 ? `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}` : c
                ))],
                os
            });
        }
    }
    
    // Windows reserved names
    const basename = path.basename(filename, path.extname(filename));
    if (RESERVED_NAMES_WINDOWS.has(basename.toUpperCase())) {
        warnings.push({
            path: filename,
            invalidChars: ['RESERVED_NAME'],
            os: 'windows'
        });
    }
}

function checkUnicode(file, warnings) {
    const filename = file.originalName;
    
    try {
        // Check NFC vs NFD normalization
        const nfc = filename.normalize('NFC');
        const nfd = filename.normalize('NFD');
        
        if (nfc !== nfd && filename !== nfc) {
            warnings.push({
                path: filename,
                issue: 'nfc_nfd_mismatch',
                details: 'Filename uses NFD normalization, may cause issues on Windows/Linux'
            });
        }
        
        // Check for invalid UTF-8
        Buffer.from(filename, 'utf8').toString('utf8');
    } catch (e) {
        warnings.push({
            path: filename,
            issue: 'invalid_sequence',
            details: 'Invalid UTF-8 encoding detected'
        });
    }
}

function detectDuplicates(files) {
    const dirMap = new Map();
    
    for (const file of files) {
        if (file.isDirectory) continue;
        
        const dir = path.dirname(file.originalName);
        const basename = path.basename(file.originalName);
        
        const key = `${dir}::${basename.toLowerCase()}`; // Case-insensitive check
        if (!dirMap.has(key)) {
            dirMap.set(key, []);
        }
        dirMap.get(key).push(file.originalName);
    }
    
    const duplicates = [];
    for (const [key, paths] of dirMap) {
        if (paths.length > 1) {
            const [dir, filename] = key.split('::');
            duplicates.push({
                directory: dir || '/',
                filename: path.basename(paths[0]),
                count: paths.length,
                paths: paths.slice(0, 10) // Limit to first 10 examples
            });
        }
    }
    
    return duplicates;
}

function detectSystemFiles(files) {
    const systemFiles = [];
    
    for (const file of files) {
        for (const [type, pattern] of Object.entries(SYSTEM_FILE_PATTERNS)) {
            if (pattern.test(file.originalName)) {
                systemFiles.push({
                    path: file.originalName,
                    type
                });
                break;
            }
        }
    }
    
    // Limit to first 20 examples
    return systemFiles.slice(0, 20);
}

function simulateRenameConflicts(files) {
    // For initial analysis without rules, check if files would conflict
    // with basic operations (like removing all numbers would make IMG_001.jpg and IMG_002.jpg conflict)
    
    // This is a simplified version - real conflict detection happens when rules are applied
    // For now, we'll just detect case-sensitivity conflicts
    const dirMap = new Map();
    
    for (const file of files) {
        if (file.isDirectory) continue;
        
        const dir = path.dirname(file.originalName);
        const basename = path.basename(file.originalName);
        
        if (!dirMap.has(dir)) {
            dirMap.set(dir, new Map());
        }
        
        const nameMap = dirMap.get(dir);
        const lowerName = basename.toLowerCase();
        
        if (!nameMap.has(lowerName)) {
            nameMap.set(lowerName, []);
        }
        nameMap.get(lowerName).push(basename);
    }
    
    const conflicts = [];
    
    for (const [dir, nameMap] of dirMap) {
        for (const [lowerName, originals] of nameMap) {
            if (originals.length > 1 && new Set(originals).size > 1) {
                // Case-sensitivity conflict (e.g., File.txt and file.txt)
                conflicts.push({
                    directory: dir,
                    conflictingFiles: originals,
                    resultName: lowerName,
                    count: originals.length,
                    type: 'case_sensitivity'
                });
            }
        }
    }
    
    return conflicts.slice(0, 10); // Limit to first 10 conflicts
}

function calculateSeverity(warnings) {
    const w = warnings;
    
    // Critical: rename conflicts (data loss risk)
    if (w.renameConflicts.length > 0) return 'critical';
    
    // High: many path/char issues
    if (w.pathTooLong.length > 5 || w.invalidChars.length > 5) return 'high';
    
    // Medium: duplicates, unicode issues
    if (w.duplicateNames.length > 0 || w.unicodeIssues.length > 0) return 'medium';
    
    // Low: only system files
    if (w.systemFiles.length > 0) return 'low';
    
    return 'none';
}

module.exports = {
    analyzeArchive
};
