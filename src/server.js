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

// Security & Middleware
app.use(helmet({
    contentSecurityPolicy: false,
}));
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Storage with cleanup logic
const upload = multer({
    dest: os.tmpdir(),
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
        try { fs.unlinkSync(filePath); } catch (e) { console.error('Cleanup failed:', e); }
    }
};

// --- Routes ---

/**
 * 1. Analyze ZIP
 * Extracts file list for preview.
 */
app.post('/api/analyze', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
        const zip = new AdmZip(req.file.path);
        const zipEntries = zip.getEntries();

        const files = zipEntries
            .filter(entry => !entry.isDirectory)
            .map((entry, idx) => ({
                originalName: entry.entryName,
                size: entry.header.size,
                index: idx
            }));

        // Enforce Free Tier Limit for Analysis (optional, but good UX to warn early)
        // Growth Pivot: Unlimited for everyone
        const isPaid = true; // req.headers['x-unlock-token'] && isTokenValid(req.headers['x-unlock-token']);
        const limit = Infinity; // isPaid ? Infinity : 20;
        const totalFiles = files.length;

        res.json({
            files: files.slice(0, 500), // Cap payload size just in case
            totalFiles,
            limitExceeded: totalFiles > limit && !isPaid,
            tempId: path.basename(req.file.path) // Client sends this back to process
        });

        // Note: In a real stateless split-server app, we'd upload to S3. 
        // Here we rely on temp dir persistence until the next request or cleanup job.
        // We do NOT delete the file yet, as we need it for 'process'.
        // To prevent disk fill, we should have a cron job or strict timeout.
        // For MVP: Set an expiration timeout to delete this file if not processed in 10 mins.
        setTimeout(() => cleanup(req.file.path), 10 * 60 * 1000);

    } catch (e) {
        cleanup(req.file.path);
        res.status(500).json({ error: 'Failed to parse ZIP', details: e.message });
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
    const { tempId, rules, unlockToken } = req.body;

    if (!tempId || !rules) return res.status(400).json({ error: 'Missing parameters' });

    const filePath = path.join(os.tmpdir(), path.basename(tempId));

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File expired or not found. Please upload again.' });
    }

    try {
        const isPaid = true; // isTokenValid(unlockToken);
        const LIMIT = Infinity; // 20;

        const zip = new AdmZip(filePath);
        const zipEntries = zip.getEntries();
        const nonDirEntries = zipEntries.filter(e => !e.isDirectory);

        // Monetization Check (Disabled for Growth)
        // if (!isPaid && nonDirEntries.length > LIMIT) {
        //     return res.status(402).json({ error: 'Free tier limit exceeded. Please upgrade.' });
        // }

        // Create new ZIP
        const newZip = new AdmZip();

        nonDirEntries.forEach((entry, idx) => {
            // Basic sanitation for safety
            const originalName = entry.entryName;
            const dir = path.dirname(originalName);

            // Apply Renaming (Renames the basename only)
            // We pass just the file part to renamer if we want to match preview logic exactly
            const ext = path.extname(originalName);
            const baseName = path.basename(originalName, ext);

            // Our renamer needs the full originalName to extract parts? 
            // Actually renamer.js extracts basename itself.
            let newBytes = applyRenamingRules(originalName, idx, rules);

            // renamer.js returns "basename+ext". It strips the path.
            // So we join it back with the original dir.
            // Sanitize dir to ensure no ".." traversal
            let safeDir = dir.split(path.sep).filter(p => p !== '..' && p !== '.').join('/');
            if (safeDir === '.') safeDir = ''; // Root

            let finalPath = newBytes;
            if (safeDir) {
                finalPath = safeDir + '/' + newBytes;
            }

            // Copy buffer
            const content = entry.getData();
            newZip.addFile(finalPath, content);
        });

        const downloadName = `renamed_${Date.now()}.zip`;
        const buffer = newZip.toBuffer();

        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', `attachment; filename=${downloadName}`);
        res.set('Content-Length', buffer.length);
        res.send(buffer);

        // Cleanup original
        cleanup(filePath);

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Processing failed' });
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
