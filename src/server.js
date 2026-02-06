// Native .env loading used via --env-file flag


const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const AdmZip = require('adm-zip');
const { v4: uuidv4 } = require('uuid');
const { applyRenamingRules } = require('./lib/renamer');
const { createCheckoutSession, verifySessionAndCreateToken, isTokenValid } = require('./lib/payment');

const app = express();
const PORT = process.env.PORT || 3000;
const os = require('os');

// Use a temp folder inside this site instead of the global OS temp
const TEMP_DIR = path.join(__dirname, '..', 'temp');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}
console.log('Server Temp Dir:', TEMP_DIR);

// Security & Middleware
app.use(helmet({
    contentSecurityPolicy: false,
}));
app.use(cors());
app.use(express.json());

// Redirect /index.html to / (root)
app.get('/index.html', (req, res) => {
    res.redirect(301, '/');
});

app.use(express.static('public'));

// Storage with cleanup logic
const upload = multer({
    dest: TEMP_DIR,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/zip' ||
            file.mimetype === 'application/x-zip-compressed' ||
            file.originalname.endsWith('.zip')) {
            cb(null, true);
        } else {
            cb(new Error('Only ZIP files are allowed'));
        }
    }
});

// --- Helper: Cleanup File ---
const cleanup = (filePath) => {
    if (filePath && fs.existsSync(filePath)) {
        try { 
            fs.unlinkSync(filePath);
            // Also cleanup metadata file if it exists
            const metaPath = filePath + '.meta';
            if (fs.existsSync(metaPath)) {
                fs.unlinkSync(metaPath);
            }
        } catch (e) { 
            console.error('Cleanup failed:', e); 
        }
    }
};

// --- Routes ---

/**
 * 1. Analyze ZIP
 * Extracts file list for preview.
 */
app.post('/api/analyze', upload.single('file'), (req, res) => {
    console.log('[Analyze] Request received');
    console.log('[Analyze] File uploaded:', req.file ? 'YES' : 'NO');
    
    if (!req.file) {
        console.log('[Analyze] ERROR: No file in request');
        return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('[Analyze] File path:', req.file.path);
    console.log('[Analyze] File size:', req.file.size);
    console.log('[Analyze] TEMP_DIR:', TEMP_DIR);
    console.log('[Analyze] File exists?', fs.existsSync(req.file.path));

    try {
        const zip = new AdmZip(req.file.path);
        const zipEntries = zip.getEntries();

        const files = zipEntries
            // .filter(entry => !entry.isDirectory) // Allow directories for preview
            .map((entry, idx) => ({
                originalName: entry.entryName,
                size: entry.header.size,
                isDirectory: entry.isDirectory,
                index: idx
            }));

        // Enforce Free Tier Limit for Analysis (optional, but good UX to warn early)
        // Growth Pivot: Unlimited for everyone
        const isPaid = true; // req.headers['x-unlock-token'] && isTokenValid(req.headers['x-unlock-token']);
        const limit = Infinity; // isPaid ? Infinity : 20;
        const totalFiles = files.length;

        // Store original filename in a metadata file for later use
        const originalFileName = req.file.originalname;
        const metadataPath = req.file.path + '.meta';
        try {
            fs.writeFileSync(metadataPath, JSON.stringify({ originalFileName }));
        } catch (e) {
            console.warn('[Analyze] Could not save metadata:', e);
        }

        res.json({
            files: files.slice(0, 500), // Cap payload size just in case
            totalFiles,
            limitExceeded: totalFiles > limit && !isPaid,
            tempId: path.basename(req.file.path), // Client sends this back to process
            originalFileName: originalFileName
        });

        // Note: In a real stateless split-server app, we'd upload to S3. 
        // Here we rely on temp dir persistence until the next request or cleanup job.
        // We do NOT delete the file yet, as we need it for 'process'.
        // To prevent disk fill, we should have a cron job or strict timeout.
        // For MVP: Set an expiration timeout to delete this file if not processed in 10 mins.
        setTimeout(() => cleanup(req.file.path), 10 * 60 * 1000); // 10 minutes

        console.log('[Analyze] File saved to:', req.file.path);
        console.log('[Analyze] Returning tempId:', path.basename(req.file.path));

    } catch (e) {
        if (req.file) cleanup(req.file.path);
        res.status(500).json({ error: 'Failed to parse ZIP', details: e.message });
    }
});

/**
 * 1.5. GET Analysis (Redirect Restore)
 */
app.get('/api/files/:tempId', (req, res) => {
    const tempId = req.params.tempId;
    console.log('[Restore] Request for ID:', tempId);

    if (!tempId || tempId.includes('..') || tempId.includes('/')) return res.status(400).json({ error: 'Invalid ID' });

    const filePath = path.join(TEMP_DIR, tempId);
    console.log('[Restore] Looking for file at:', filePath);
    console.log('[Restore] File exists?', fs.existsSync(filePath));

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Session expired or file not found.' });
    }

    try {
        const zip = new AdmZip(filePath);
        const zipEntries = zip.getEntries();
        const files = zipEntries.map((entry, idx) => ({
            originalName: entry.entryName,
            size: entry.header.size,
            isDirectory: entry.isDirectory,
            index: idx
        }));

        // Try to load original filename from metadata
        let originalFileName = 'archive.zip';
        const metadataPath = filePath + '.meta';
        try {
            if (fs.existsSync(metadataPath)) {
                const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
                originalFileName = metadata.originalFileName || originalFileName;
            }
        } catch (e) {
            console.warn('[Restore] Could not load metadata:', e);
        }

        res.json({
            files: files.slice(0, 500),
            totalFiles: files.length,
            tempId: tempId,
            originalFileName: originalFileName,
            limitExceeded: false
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed to read archive' });
    }
});

/**
 * 2. Renaming Preview (Client-side mostly, but if we moved logic to server...)
 * We will keep renaming logic shared or server-side. For MVP, we do processing directly.
 */

/**
 * 3. Process & Download
 * Applies rules and returns new ZIP.
 */
app.post('/api/process', express.json(), async (req, res) => {
    console.log('[Process] Request received');
    console.log('[Process] tempId:', req.body.tempId);
    console.log('[Process] ruleGroups:', req.body.ruleGroups ? req.body.ruleGroups.length + ' groups' : 'none');
    
    const { tempId, rules, ruleGroups, unlockToken, originalFileName } = req.body;

    // Accept either legacy `rules` or new grouped `ruleGroups`
    if (!tempId || (!rules && !ruleGroups)) {
        console.log('[Process] ERROR: Missing parameters');
        return res.status(400).json({ error: 'Missing parameters' });
    }

    const filePath = path.join(TEMP_DIR, path.basename(tempId));
    console.log('[Process] Looking for file at:', filePath);
    console.log('[Process] File exists?', fs.existsSync(filePath));

    if (!fs.existsSync(filePath)) {
        console.log('[Process] ERROR: File not found');
        return res.status(404).json({ error: 'File expired or not found. Please upload again.' });
    }

    try {
        const isPaid = true; // isTokenValid(unlockToken);
        const LIMIT = Infinity; // 20;

        const zip = new AdmZip(filePath);
        const zipEntries = zip.getEntries();
        // const nonDirEntries = zipEntries.filter(e => !e.isDirectory); // Process everything
        const allEntries = zipEntries;

        // Monetization Check (Disabled for Growth)
        // if (!isPaid && nonDirEntries.length > LIMIT) {
        //     return res.status(402).json({ error: 'Free tier limit exceeded. Please upgrade.' });
        // }

        // Create new ZIP
        const newZip = new AdmZip();

        // Normalize rules input into groups
        let groups = Array.isArray(ruleGroups) && ruleGroups.length
            ? ruleGroups
            : [];
        if (!groups.length && Array.isArray(rules) && rules.length) {
            groups = [{ id: 'default', scope: 'global', rules }];
        }

        console.log('[Process] Processing with', groups.length, 'rule groups');
        console.log('[Process] Total entries in ZIP:', allEntries.length);

        // Initialize counters for each group to handle scoped numbering
        const groupCounters = {}; // { groupId: 0 }
        groups.forEach(g => {
            groupCounters[g.id] = 0;
        });

        // Scope check helper function (defined once for all entries)
        const matchScope = (name, scope, scopeValue, isDirectory, exclude = false) => {
            if (!scope) return true;
            
            if (scope === 'global') {
                // Global applies to files only, not directories
                return !isDirectory;
            }

            if (scope === 'folders') {
                // Folders scope applies to directories only
                return isDirectory;
            }

            if (scope === 'extension') {
                // Extension scope applies to files only
                if (isDirectory) return false;
                const ext = path.extname(name);
                const value = scopeValue || '';
                const targetExt = value.startsWith('.') ? value : (value ? '.' + value : '');
                const extensionMatches = targetExt ? ext.toLowerCase() === targetExt.toLowerCase() : true;
                // Apply exclude logic: if exclude is true, invert the match
                return exclude ? !extensionMatches : extensionMatches;
            }

            if (scope === 'folder') {
                // Specific folder path applies to anything within that folder
                const normPath = name.replace(/\\/g, '/');
                const value = (scopeValue || '').replace(/\\/g, '/');
                return value ? normPath.startsWith(value) : true;
            }

            return true;
        };

        // PHASE 1: Build folder rename map
        // Map old folder paths to new folder paths
        const folderRenameMap = new Map(); // { 'OldFolder/' => 'NewFolder/' }
        
        allEntries.filter(e => e.isDirectory).forEach((entry) => {
            const originalName = entry.entryName;
            const normalizedName = originalName.replace(/\\/g, '/');
            let dirPath = normalizedName.endsWith('/') ? normalizedName.slice(0, -1) : normalizedName;
            
            // Check if this is a top-level folder (folders with no parent path)
            const lastSlash = dirPath.lastIndexOf('/');
            if (lastSlash === -1) {
                // This is a top-level folder - add it to the ZIP as-is (don't rename)
                console.log('[Process] Preserving top-level folder:', dirPath);
                newZip.addFile(dirPath + '/', Buffer.alloc(0));
                return;
            }
            
            // Get the parent path and folder name
            let parentPath = dirPath.substring(0, lastSlash + 1);
            let folderName = dirPath.substring(lastSlash + 1);

            // Apply rules to folder name
            let workingFolderName = folderName;
            for (const group of groups) {
                if (!group || !Array.isArray(group.rules) || !group.rules.length) continue;

                if (matchScope(normalizedName, group.scope, group.scopeValue, true, group.exclude)) {
                    if (groupCounters[group.id] === undefined) {
                        groupCounters[group.id] = 0;
                    }
                    const groupIndex = groupCounters[group.id]++;
                    workingFolderName = applyRenamingRules(workingFolderName, groupIndex, group.rules);
                }
            }

            const oldPath = dirPath + '/';
            const newPath = parentPath + workingFolderName + '/';
            folderRenameMap.set(oldPath, newPath);
            
            // Add renamed directory to new ZIP
            newZip.addFile(newPath, Buffer.alloc(0));
        });

        // PHASE 2: Process files and update their paths based on folder renames
        allEntries.filter(e => !e.isDirectory).forEach((entry) => {
            const originalName = entry.entryName;
            let normalizedName = originalName.replace(/\\/g, '/');

            // Update the file path if it's inside a renamed folder
            for (const [oldFolderPath, newFolderPath] of folderRenameMap.entries()) {
                if (normalizedName.startsWith(oldFolderPath)) {
                    normalizedName = normalizedName.replace(oldFolderPath, newFolderPath);
                    break;
                }
            }

            const dir = path.dirname(normalizedName);

            // Start with "name.ext" only for renaming
            const ext = path.extname(normalizedName);
            let workingName = path.basename(normalizedName); // includes extension

            for (const group of groups) {
                if (!group || !Array.isArray(group.rules) || !group.rules.length) continue;

                if (matchScope(normalizedName, group.scope, group.scopeValue, false, group.exclude)) {
                    if (groupCounters[group.id] === undefined) {
                        groupCounters[group.id] = 0;
                    }
                    const groupIndex = groupCounters[group.id]++;

                    // applyRenamingRules expects "name.ext" and returns "name.ext"
                    workingName = applyRenamingRules(workingName, groupIndex, group.rules);

                    // Ensure we keep only file name + ext portion (no path)
                    const parsed = path.parse(workingName);
                    workingName = parsed.name + parsed.ext;
                }
            }

            // Rebuild full path with sanitized directory
            let safeDir = dir.split('/').filter(p => p && p !== '..' && p !== '.').join('/');
            if (safeDir === '.') safeDir = '';

            let finalPath = workingName;
            if (safeDir) {
                finalPath = safeDir + '/' + workingName;
            }

            finalPath = finalPath.replace(/\\/g, '/');

            const content = entry.getData();
            newZip.addFile(finalPath, content);
        });

        // Determine download filename - ALWAYS use original name
        let downloadName = 'archive.zip';
        
        // First priority: use originalFileName from request body
        if (originalFileName && typeof originalFileName === 'string') {
            downloadName = originalFileName;
            console.log('[Process] Using originalFileName from request:', downloadName);
        } else {
            // Fallback: try to load from metadata file
            const metadataPath = filePath + '.meta';
            try {
                if (fs.existsSync(metadataPath)) {
                    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
                    if (metadata.originalFileName) {
                        downloadName = metadata.originalFileName;
                        console.log('[Process] Using originalFileName from metadata:', downloadName);
                    }
                }
            } catch (e) {
                console.warn('[Process] Could not load original filename, using default');
            }
        }
        
        console.log('[Process] Final download filename:', downloadName);

        const buffer = newZip.toBuffer();

        console.log('[Process] Successfully created new ZIP, size:', buffer.length, 'bytes');

        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', `attachment; filename="${downloadName}"`);
        res.set('Content-Length', buffer.length);
        res.send(buffer);

        // Cleanup original
        cleanup(filePath);
        console.log('[Process] Cleaned up temp file');

    } catch (e) {
        console.error('[Process] ERROR:', e);
        console.error('[Process] Stack:', e.stack);
        res.status(500).json({ error: 'Processing failed', details: e.message || String(e) });
    }
});

/**
 * 3.5. Cleanup temp ZIP if user abandons session
 * Frontend sends a small beacon with { tempId } on page unload.
 */
app.post('/api/cleanup', async (req, res) => {
    try {
        const { tempId } = req.body || {};
        if (!tempId) {
            return res.status(400).json({ error: 'Missing tempId' });
        }

        const filePath = path.join(TEMP_DIR, path.basename(tempId));
        cleanup(filePath);

        return res.json({ ok: true });
    } catch (e) {
        console.error('Cleanup failed:', e);
        return res.status(500).json({ error: 'Cleanup failed' });
    }
});

/**
 * 4. Payment
 */
app.post('/api/create-checkout', async (req, res) => {
    try {
        const { successUrl, cancelUrl, priceId } = req.body;
        const session = await createCheckoutSession(successUrl, cancelUrl, priceId);
        res.json(session);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/verify-payment', async (req, res) => {
    const { sessionId } = req.body;
    const token = await verifySessionAndCreateToken(sessionId);
    if (token) {
        res.json({ success: true, token });
    } else {
        res.json({ success: false });
    }
});


app.listen(PORT, () => {
    console.log(`ZipRenamer Pro running on port ${PORT}`);
});
