# ZIP Archive Analysis System - Technical Specification

## 1. JSON Schema for Analysis Output

```typescript
interface AnalysisResult {
  stats: {
    totalFiles: number;
    totalDirectories: number;
    totalSize: number;
    maxDepth: number;
    largestFile: {
      path: string;
      size: number;
    };
  };
  
  warnings: {
    renameConflicts: ConflictWarning[];
    pathTooLong: PathWarning[];
    duplicateNames: DuplicateWarning[];
    invalidChars: InvalidCharWarning[];
    unicodeIssues: UnicodeWarning[];
    systemFiles: SystemFileWarning[];
  };
  
  severity: 'critical' | 'high' | 'medium' | 'low' | 'none';
  timestamp: string;
}

interface ConflictWarning {
  directory: string;
  conflictingFiles: string[];  // Original names
  resultName: string;           // What they'd all become
  count: number;
}

interface PathWarning {
  path: string;
  length: number;
  os: 'windows' | 'linux' | 'macos';
  limit: number;
}

interface DuplicateWarning {
  directory: string;
  filename: string;
  count: number;
  paths: string[];
}

interface InvalidCharWarning {
  path: string;
  invalidChars: string[];
  os: 'windows' | 'macos' | 'linux';
}

interface UnicodeWarning {
  path: string;
  issue: 'nfc_nfd_mismatch' | 'invalid_sequence' | 'bidi_issue';
  details: string;
}

interface SystemFileWarning {
  path: string;
  type: '__MACOSX' | '.DS_Store' | 'Thumbs.db' | 'desktop.ini' | 'other';
}
```

## 2. Algorithm Outline

```javascript
function analyzeZipArchive(zip, files) {
  // Phase 1: Basic Statistics (O(n))
  const stats = calculateStats(files);
  
  // Phase 2: Path & Character Validation (O(n))
  const pathWarnings = [];
  const invalidCharWarnings = [];
  const unicodeWarnings = [];
  
  for (const file of files) {
    checkPathLength(file, pathWarnings);
    checkInvalidChars(file, invalidCharWarnings);
    checkUnicode(file, unicodeWarnings);
  }
  
  // Phase 3: Duplicate Detection (O(n log n))
  const duplicateWarnings = detectDuplicates(files);
  
  // Phase 4: System File Detection (O(n))
  const systemFiles = detectSystemFiles(files);
  
  // Phase 5: Conflict Simulation (O(n * rules))
  // Simulate applying empty/default rules to detect potential conflicts
  const conflicts = simulateRenameConflicts(files, []);
  
  return {
    stats,
    warnings: {
      renameConflicts: conflicts,
      pathTooLong: pathWarnings,
      duplicateNames: duplicateWarnings,
      invalidChars: invalidCharWarnings,
      unicodeIssues: unicodeWarnings,
      systemFiles
    },
    severity: calculateSeverity(warnings),
    timestamp: new Date().toISOString()
  };
}
```

## 3. Path Length Calculation

```javascript
const OS_LIMITS = {
  windows: 260,   // MAX_PATH
  linux: 4096,    // PATH_MAX
  macos: 1024     // PATH_MAX (HFS+/APFS)
};

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
```

## 4. Invalid Character Detection

```javascript
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

function checkInvalidChars(file, warnings) {
  const filename = file.originalName;
  
  for (const [os, regex] of Object.entries(INVALID_CHARS)) {
    const matches = filename.match(regex);
    if (matches) {
      warnings.push({
        path: filename,
        invalidChars: [...new Set(matches)],
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
```

## 5. Conflict Detection Logic

```javascript
function simulateRenameConflicts(files, ruleGroups = []) {
  // Group files by directory
  const dirMap = new Map();
  
  for (const file of files) {
    if (file.isDirectory) continue;
    
    const dir = path.dirname(file.originalName);
    if (!dirMap.has(dir)) {
      dirMap.set(dir, []);
    }
    
    // Simulate rename (or use original if no rules)
    const renamed = applySimulatedRename(file, ruleGroups);
    
    dirMap.get(dir).push({
      original: file.originalName,
      renamed: renamed,
      file: file
    });
  }
  
  // Detect conflicts
  const conflicts = [];
  
  for (const [dir, entries] of dirMap) {
    const nameMap = new Map();
    
    for (const entry of entries) {
      const name = entry.renamed;
      if (!nameMap.has(name)) {
        nameMap.set(name, []);
      }
      nameMap.get(name).push(entry.original);
    }
    
    // Find conflicts (where multiple originals map to same result)
    for (const [resultName, originals] of nameMap) {
      if (originals.length > 1) {
        conflicts.push({
          directory: dir,
          conflictingFiles: originals,
          resultName,
          count: originals.length
        });
      }
    }
  }
  
  return conflicts;
}
```

## 6. Duplicate Detection

```javascript
function detectDuplicates(files) {
  const dirMap = new Map();
  
  for (const file of files) {
    if (file.isDirectory) continue;
    
    const dir = path.dirname(file.originalName);
    const basename = path.basename(file.originalName);
    
    const key = `${dir}/${basename}`;
    if (!dirMap.has(key)) {
      dirMap.set(key, []);
    }
    dirMap.get(key).push(file.originalName);
  }
  
  const duplicates = [];
  for (const [key, paths] of dirMap) {
    if (paths.length > 1) {
      const [dir, filename] = key.split('/').slice(-2);
      duplicates.push({
        directory: dir || '/',
        filename,
        count: paths.length,
        paths
      });
    }
  }
  
  return duplicates;
}
```

## 7. Unicode Normalization Check

```javascript
function checkUnicode(file, warnings) {
  const filename = file.originalName;
  
  // Check NFC vs NFD (macOS issue)
  const nfc = filename.normalize('NFC');
  const nfd = filename.normalize('NFD');
  
  if (nfc !== nfd && filename !== nfc) {
    warnings.push({
      path: filename,
      issue: 'nfc_nfd_mismatch',
      details: `Filename uses NFD normalization, may cause issues on Windows/Linux`
    });
  }
  
  // Check for invalid UTF-8 sequences
  try {
    Buffer.from(filename, 'utf8').toString('utf8');
  } catch (e) {
    warnings.push({
      path: filename,
      issue: 'invalid_sequence',
      details: 'Invalid UTF-8 encoding detected'
    });
  }
}
```

## 8. System File Detection

```javascript
const SYSTEM_FILE_PATTERNS = {
  '__MACOSX': /\/__MACOSX\//,
  '.DS_Store': /\.DS_Store$/,
  'Thumbs.db': /Thumbs\.db$/i,
  'desktop.ini': /desktop\.ini$/i,
  '.git': /\/\.git\//
};

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
  
  return systemFiles;
}
```

## 9. Severity Calculation

```javascript
function calculateSeverity(warnings) {
  const w = warnings;
  
  // Critical: rename conflicts (data loss risk)
  if (w.renameConflicts.length > 0) return 'critical';
  
  // High: path too long, invalid chars
  if (w.pathTooLong.length > 5 || w.invalidChars.length > 5) return 'high';
  
  // Medium: duplicates, unicode issues
  if (w.duplicateNames.length > 0 || w.unicodeIssues.length > 0) return 'medium';
  
  // Low: only system files
  if (w.systemFiles.length > 0) return 'low';
  
  return 'none';
}
```

## 10. Pipeline Integration Point

### Current Flow:
```
POST /api/analyze
  ↓
Extract ZIP file list with AdmZip
  ↓
Build files array with {originalName, isDirectory}
  ↓
Store in memory with tempId
  ↓
Return {files, tempId, totalFiles, limitExceeded, originalFileName}
```

### New Flow:
```
POST /api/analyze
  ↓
Extract ZIP file list with AdmZip
  ↓
Build files array
  ↓
**RUN ANALYSIS HERE** ← NEW STEP
  ↓
Store files + analysis in memory
  ↓
Return {files, tempId, totalFiles, limitExceeded, originalFileName, **analysis**}
```

### Code Location:
`src/server.js` → `/api/analyze` endpoint, after line where `files` array is built.

## 11. Performance Considerations

**Complexity Analysis:**
- Stats calculation: O(n)
- Path/char validation: O(n)
- Duplicate detection: O(n log n) - sorting by directory
- Conflict simulation: O(n * r) where r = number of rules
- **Total: O(n log n)** - scales well even for 10,000+ files

**Memory:**
- Stores warnings in arrays (minimal overhead)
- No file content loaded (only metadata)
- Analysis result ~1-5KB for typical archives

**Optimization:**
- Early exit if no rules (skip conflict simulation)
- Lazy loading of warning details (store only counts + first 10 examples)
- Cache analysis result with tempId (don't recalculate on page refresh)

## 12. Minimal Code Changes Required

### Backend (server.js):
1. Add `analyzeArchive()` function (~150 lines)
2. Modify `/api/analyze` endpoint to call analysis and include in response (~5 lines)
3. Store analysis with tempId in memory (~2 lines)
4. Return analysis in `/api/files/:tempId` endpoint (~1 line)

### Frontend (app.js):
1. Add `analysis` property to state (~1 line)
2. Store analysis from upload response (~1 line)
3. Add `showAnalysis` boolean for panel visibility (~1 line)

### Frontend (config.html or index.html):
1. Add "Archive Summary" panel component (~100 lines HTML)
2. Display stats and warnings with expand/collapse (~50 lines)

**Total estimated changes: ~300 lines of new code, ~10 lines modified**

## 13. Example Output

```json
{
  "stats": {
    "totalFiles": 247,
    "totalDirectories": 18,
    "totalSize": 15728640,
    "maxDepth": 4,
    "largestFile": {
      "path": "photos/IMG_5432.jpg",
      "size": 8388608
    }
  },
  "warnings": {
    "renameConflicts": [
      {
        "directory": "photos",
        "conflictingFiles": ["IMG_001.jpg", "IMG_002.jpg"],
        "resultName": "photo.jpg",
        "count": 2
      }
    ],
    "pathTooLong": [
      {
        "path": "very/long/path/that/exceeds/windows/limit.txt",
        "length": 275,
        "os": "windows",
        "limit": 260
      }
    ],
    "duplicateNames": [],
    "invalidChars": [
      {
        "path": "file:with:colons.txt",
        "invalidChars": [":"],
        "os": "windows"
      }
    ],
    "unicodeIssues": [],
    "systemFiles": [
      {
        "path": "__MACOSX/._file.txt",
        "type": "__MACOSX"
      },
      {
        "path": ".DS_Store",
        "type": ".DS_Store"
      }
    ]
  },
  "severity": "high",
  "timestamp": "2026-02-05T10:30:00.000Z"
}
```
