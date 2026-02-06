document.addEventListener('alpine:init', () => {
    Alpine.data('app', () => ({
        step: 1, // 1: Upload, 2: Config/Preview, 3: Download
        files: [],
        totalFiles: 0,
        tempId: null,
        originalFileName: null,
        isDragging: false,
        isProcessing: false,
        limitExceeded: false,
        isPaid: false,
        isPaid: false,
        ruleGroups: [],
        availableExtensions: [],
        availableFolders: [],
        pendingTemplate: null,
        showScrollTop: false,
        darkMode: false,
        analysis: null,
        showAnalysis: true,

        // i18n
        lang: 'en',
        currentTranslations: {},

        init() {
            // Initialize dark mode from localStorage or system preference
            const storedDarkMode = localStorage.getItem('dark_mode');
            if (storedDarkMode !== null) {
                this.darkMode = storedDarkMode === 'true';
            } else {
                // Use system preference
                this.darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
            }
            this.applyDarkMode();

            // Listen for scroll events for "scroll to top" button
            window.addEventListener('scroll', () => {
                this.showScrollTop = window.pageYOffset > 300;
            });

            const urlParams = new URLSearchParams(window.location.search);

            // Handle Language from URL, localStorage, or default
            const langParam = urlParams.get('lang');
            const storedLang = localStorage.getItem('preferred_language');
            const allowedLangs = ['en', 'fr', 'es'];
            
            // Priority: URL param > localStorage > default
            let startLang = 'en';
            if (langParam && allowedLangs.includes(langParam)) {
                startLang = langParam;
            } else if (storedLang && allowedLangs.includes(storedLang)) {
                startLang = storedLang;
            }

            this.setLang(startLang);

            // Check for payment session_id in URL
            const sessionId = urlParams.get('session_id');
            if (sessionId) {
                this.verifyPayment(sessionId);
            }

            // Page Logic: Check for 'id' (Config Mode)
            const idParam = urlParams.get('id');
            if (idParam) {
                this.tempId = idParam;
                this.loadFiles(idParam);
            }

            // Ensure temp ZIP is cleaned up only when truly leaving the site
            // (not when navigating between pages like index.html -> config.html)
            window.addEventListener('beforeunload', (e) => {
                // Only cleanup if we have a tempId AND we're on the config page
                // This prevents cleanup when navigating FROM index TO config
                const isConfigPage = window.location.pathname.includes('config.html');
                
                if (this.tempId && isConfigPage && navigator.sendBeacon) {
                    try {
                        const blob = new Blob(
                            [JSON.stringify({ tempId: this.tempId })],
                            { type: 'application/json' }
                        );
                        navigator.sendBeacon('/api/cleanup', blob);
                    } catch (e) {
                        // Best-effort only; ignore failures
                    }
                }
            });

            // Watchers for Previews
            this.$watch('ruleGroups', () => this.updatePreviews());
            // Need deep watch for rules inside groups?
            // Alpine.js $watch(..., {deep: true}) not directly available in x-data simple syntax without magic?
            // Actually Alpine $watch is shallow by default. We might need to manually trigger or use a plugin.
            // Simplified: call updatePreviews() on add/remove. For inputs, use @input="updatePreviews()"?
            // Or just use x-effect.

            this.$effect(() => {
                // Dependency recording
                // Access deep properties to trigger effect?
                const dependency = JSON.stringify(this.ruleGroups);
                if (this.files.length > 0) {
                    this.updatePreviews();
                }
            });
        },

        async setLang(l) {
            this.lang = l;
            // Store language preference in localStorage
            localStorage.setItem('preferred_language', l);
            
            try {
                const res = await fetch(`/locales/${l}.json`);
                if (res.ok) {
                    this.currentTranslations = await res.json();
                } else {
                    console.error('Failed to load translations');
                }
            } catch (e) {
                console.error('Error loading translations:', e);
            }
        },

        t(key) {
            return this.currentTranslations[key] || key;
        },

        toggleDarkMode() {
            this.darkMode = !this.darkMode;
            localStorage.setItem('dark_mode', this.darkMode);
            this.applyDarkMode();
        },

        applyDarkMode() {
            if (this.darkMode) {
                document.documentElement.classList.add('dark');
            } else {
                document.documentElement.classList.remove('dark');
            }
        },

        scrollToTop() {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        },

        getRuleDescription(ruleType) {
            const descMap = {
                'replace': 'rule_replace_desc',
                'prefix': 'rule_prefix_desc',
                'suffix': 'rule_suffix_desc',
                'numbering': 'rule_numbering_desc',
                'lowercase': 'rule_lowercase_desc',
                'remove_special': 'rule_remove_special_desc',
                'pattern': 'rule_pattern_desc'
            };
            return this.t(descMap[ruleType] || '');
        },

        getSeverityColor(severity) {
            const colors = {
                'critical': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
                'high': 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
                'medium': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
                'low': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
                'none': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
            };
            return colors[severity] || colors.none;
        },

        getSeverityIcon(severity) {
            const icons = {
                'critical': '⛔',
                'high': '⚠️',
                'medium': '⚡',
                'low': 'ℹ️',
                'none': '✓'
            };
            return icons[severity] || icons.none;
        },

        formatFileSize(bytes) {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
        },

        async loadFiles(tempId) {
            try {
                this.isProcessing = true;
                const response = await fetch(`/api/files/${tempId}`);
                if (!response.ok) throw new Error('Session not found');

                const data = await response.json();
                this.files = data.files;
                this.limitExceeded = data.limitExceeded;
                this.originalFileName = data.originalFileName || null;
                this.analysis = data.analysis || null;
                this.step = 2; // Move to Config Step

                // Recompute available scopes based on restored file list
                this.computeAvailableScopes();

                // Check for pending template after a short delay to ensure everything is ready
                setTimeout(() => {
                    const pendingTemplate = localStorage.getItem('pending_template');
                    if (pendingTemplate) {
                        console.log('Loading template:', pendingTemplate);
                        // Apply the template
                        this.loadTemplate(pendingTemplate);
                        // Clear the pending template
                        localStorage.removeItem('pending_template');
                    } else {
                        // Initialize default group if needed
                        if (this.ruleGroups.length === 0) {
                            this.addGroup();
                        } else {
                            // If groups already exist (e.g. navigating back), refresh previews
                            this.updatePreviews();
                        }
                    }
                }, 100);
            } catch (e) {
                alert('Session expired or invalid. Please upload again.');
                window.location.href = '/';
            } finally {
                this.isProcessing = false;
            }
        },

        async verifyPayment(sessionId) {
            try {
                const res = await fetch('/api/verify-payment', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId })
                });
                const data = await res.json();
                if (data.success) {
                    localStorage.setItem('zip_unlock_token', data.token);
                    this.isPaid = true;
                    // Remove query param to clean URL
                    window.history.replaceState({}, document.title, "/");
                    alert("Thank you! Premium features unlocked for this session.");
                }
            } catch (e) {
                console.error("Payment verification failed", e);
            }
        },

        get unlockToken() {
            return localStorage.getItem('zip_unlock_token');
        },

        async handleDrop(e) {
            this.isDragging = false;
            const file = e.dataTransfer.files[0];
            if (file) this.uploadFile(file);
        },

        async handleFileSelect(e) {
            const file = e.target.files[0];
            if (file) this.uploadFile(file);
            // Reset file input to allow selecting same file again
            e.target.value = '';
        },

        selectTemplate(templateName) {
            // Store template name in localStorage
            localStorage.setItem('pending_template', templateName);
            // Trigger file input
            document.getElementById('fileInput').click();
        },

        async uploadFile(file) {
            if (!file.name.endsWith('.zip')) {
                alert('Please upload a valid ZIP file.');
                return;
            }

            this.isProcessing = true;
            const formData = new FormData();
            formData.append('file', file);

            try {
                const headers = {};
                if (this.unlockToken) headers['x-unlock-token'] = this.unlockToken;

                const res = await fetch('/api/analyze', {
                    method: 'POST',
                    headers,
                    body: formData
                });

                if (!res.ok) throw new Error('Upload failed');

                const data = await res.json();
                this.files = data.files;
                this.totalFiles = data.totalFiles;
                this.tempId = data.tempId;
                this.originalFileName = data.originalFileName || null;
                this.limitExceeded = data.limitExceeded;
                this.analysis = data.analysis || null;

                // --- Extract Available Scopes ---
                this.computeAvailableScopes();

                if (this.limitExceeded) {
                    // Growth Mode: Ignore limit
                    this.showUpgradeModal = false;
                }

                // Redirect to Config Page
                window.location.href = `/config.html?id=${this.tempId}`;
            } catch (e) {
                alert('Error analyzing ZIP: ' + e.message);
            } finally {
                this.isProcessing = false;
            }
        },

        // Compute available extensions and folders based on current file list
        computeAvailableScopes() {
            if (!Array.isArray(this.files)) {
                this.availableExtensions = [];
                this.availableFolders = [];
                return;
            }

            this.availableExtensions = [...new Set(this.files.map(f => {
                if (!f || !f.originalName || f.isDirectory) return '';
                const ext = f.originalName.split('.').pop();
                return ext === f.originalName ? '' : '.' + ext;
            }).filter(e => e))].sort();

            this.availableFolders = [...new Set(this.files.map(f => {
                if (!f || !f.originalName) return '';
                const norm = f.originalName.replace(/\\/g, '/');
                const parts = norm.split('/');
                // Only keep top-level folder segment for now
                return parts.length > 1 ? parts[0] + '/' : '';
            }).filter(f => f))].sort();
        },

        addGroup() {
            this.ruleGroups.push({
                id: Date.now(),
                scope: 'global',
                scopeValue: '',
                exclude: false,
                rules: []
            });
        },

        loadTemplate(templateName) {
            // Clear existing rules
            this.ruleGroups = [];
            
            const templates = {
                seo: [
                    {
                        id: Date.now(),
                        scope: 'global',
                        scopeValue: '',
                        exclude: false,
                        rules: [
                            { type: 'lowercase', id: Date.now() + 1 },
                            { type: 'replace', find: ' ', replace: '-', id: Date.now() + 2 },
                            { type: 'remove_special', id: Date.now() + 3 }
                        ]
                    }
                ],
                photo: [
                    {
                        id: Date.now(),
                        scope: 'global',
                        scopeValue: '',
                        exclude: false,
                        rules: [
                            { type: 'prefix', text: '2024_', id: Date.now() + 1 },
                            { type: 'numbering', start: 1, padding: 3, separator: '_', position: 'end', id: Date.now() + 2 }
                        ]
                    }
                ],
                cms: [
                    {
                        id: Date.now(),
                        scope: 'global',
                        scopeValue: '',
                        exclude: false,
                        rules: [
                            { type: 'lowercase', id: Date.now() + 1 },
                            { type: 'replace', find: ' ', replace: '-', id: Date.now() + 2 },
                            { type: 'remove_special', id: Date.now() + 3 }
                        ]
                    }
                ],
                code: [
                    {
                        id: Date.now(),
                        scope: 'global',
                        scopeValue: '',
                        exclude: false,
                        rules: [
                            { type: 'prefix', text: 'asset_', id: Date.now() + 1 },
                            { type: 'lowercase', id: Date.now() + 2 },
                            { type: 'replace', find: ' ', replace: '_', id: Date.now() + 3 }
                        ]
                    }
                ],
                print: [
                    {
                        id: Date.now(),
                        scope: 'global',
                        scopeValue: '',
                        exclude: false,
                        rules: [
                            { type: 'pattern', pattern: '{parent}_{index}_{name}', id: Date.now() + 1 }
                        ]
                    }
                ]
            };
            
            this.ruleGroups = templates[templateName] || [];
            
            // Trigger preview update after a short delay to ensure Alpine has updated the DOM
            setTimeout(() => {
                this.updatePreviews();
            }, 100);
        },

        removeGroup(index) {
            this.ruleGroups.splice(index, 1);
        },

        addRuleToGroup(groupId, type) {
            const group = this.ruleGroups.find(g => g.id === groupId);
            if (!group) return;

            const defaults = {
                replace: { type: 'replace', find: '', replace: '' },
                prefix: { type: 'prefix', text: 'new_' },
                suffix: { type: 'suffix', text: '_v1' },
                numbering: { type: 'numbering', start: 1, padding: 3, separator: '-', position: 'end' },
                pattern: { type: 'pattern', pattern: '{name}_{index}' },
                lowercase: { type: 'lowercase' },
                uppercase: { type: 'uppercase' },
                remove_special: { type: 'remove_special' }
            };
            group.rules.push({ ...defaults[type], id: Date.now() });
        },

        removeRuleFromGroup(groupId, ruleIndex) {
            const group = this.ruleGroups.find(g => g.id === groupId);
            if (group) {
                group.rules.splice(ruleIndex, 1);
            }
        },

        // New preview logic handled in the view render loop usually, 
        // but since we need accumulated state (counters) across the file list, 
        // we can't just have a simple function `previewName(file)` that is stateless.
        // We need to pre-calculate previews or hold a stateful context?
        // AlpineJS text binding calls the function many times. 
        // BETTER APPROACH: Compute all previews once when rules change, or 
        // rely on `files` array having a `preview` property that we update.
        // For MVP refactor, let's try to update `files` with `previewName` whenever rules change.
        // OR: Just keep `previewName` but realize it's inefficient if we scan everything.
        // Wait, for scoped numbering, we MUST know the index of the file within the scope.
        // So `previewName(file, index)` cannot rely solely on `index` (which is global).
        // It needs `scopedIndex`.
        // So we need a helper that runs the entire simulation.

        updatePreviews() {
            // Reset counters
            const groupCounters = {};
            this.ruleGroups.forEach(g => groupCounters[g.id] = 0);

            // Simulation
            this.files.forEach(file => {
                // Hide top-level folders from preview (they're not renamed anyway)
                const normalized = file.originalName.replace(/\\/g, '/');
                const withoutTrailingSlash = normalized.replace(/\/+$/, '');
                const isTopLevelFolder = file.isDirectory && !withoutTrailingSlash.includes('/');
                
                if (isTopLevelFolder) {
                    file.preview = file.originalName;
                    file.hideFromPreview = true;
                    return;
                }
                
                file.hideFromPreview = false;
                let currentName = file.originalName;
                const ext = file.originalName.split('.').pop();
                const fullExt = '.' + ext; // simple approx

                for (const group of this.ruleGroups) {
                    // specific simple scope check for frontend
                    let match = false;
                    
                    // SKIP top-level folders (no parent path) - same as backend logic
                    if (file.isDirectory) {
                        const normalized = file.originalName.replace(/\\/g, '/');
                        const withoutTrailingSlash = normalized.replace(/\/+$/, '');
                        const hasParent = withoutTrailingSlash.includes('/');
                        
                        if (!hasParent) {
                            // This is a top-level folder, skip renaming
                            file.preview = currentName;
                            continue;
                        }
                    }
                    
                    if (group.scope === 'global') {
                        // Global applies to files only, not directories
                        match = !file.isDirectory;
                    }
                    else if (group.scope === 'folders') {
                        // Folders scope applies to directories only
                        match = file.isDirectory;
                    }
                    else if (group.scope === 'extension' && group.scopeValue) {
                        let target = group.scopeValue.startsWith('.') ? group.scopeValue : '.' + group.scopeValue;
                        let extensionMatches = !file.isDirectory && fullExt.toLowerCase() === target.toLowerCase();
                        // Apply exclude logic: if exclude is true, invert the match
                        match = group.exclude ? !extensionMatches : extensionMatches;
                    }
                    else if (group.scope === 'folder' && group.scopeValue) {
                        let norm = file.originalName.replace(/\\/g, '/');
                        let folder = group.scopeValue.replace(/\\/g, '/');
                        if (norm.startsWith(folder)) match = true;
                    }

                    if (match) {
                        const idx = groupCounters[group.id]++;
                        currentName = this.applyRules(currentName, idx, group.rules, file.isDirectory);
                    }
                }
                file.preview = currentName;
            });
        },

        // Helper to apply rules (renamed from previewName logic)
        applyRules(name, index, rules, isDirectory = false) {
            // Normalize separators
            let workingName = name.replace(/\\/g, '/');

            // For directories, strip trailing slash so we can operate on the folder name
            let trailingSlash = '';
            if (isDirectory && workingName.endsWith('/')) {
                trailingSlash = '/';
                workingName = workingName.replace(/\/+$/, '');
            }

            // Parse path/basename/ext from the normalized name
            const lastSlash = workingName.lastIndexOf('/');
            let pathPart = '';
            let filePart = workingName;
            if (lastSlash !== -1) {
                pathPart = workingName.substring(0, lastSlash + 1);
                filePart = workingName.substring(lastSlash + 1);
            }
            
            // For directories, treat the entire folder name as the baseName (no extension)
            let baseName = filePart;
            let ext = '';
            if (!isDirectory) {
                const lastDot = filePart.lastIndexOf('.');
                if (lastDot !== -1 && lastDot > 0) {
                    baseName = filePart.substring(0, lastDot);
                    ext = filePart.substring(lastDot);
                }
            }

            for (const rule of rules) {
                switch (rule.type) {
                    case 'replace':
                        if (rule.find) baseName = baseName.replace(new RegExp(this.escapeRegExp(rule.find), 'g'), rule.replace || '');
                        break;
                    case 'prefix': if (rule.text) baseName = rule.text + baseName; break;
                    case 'suffix': if (rule.text) baseName = baseName + rule.text; break;
                    case 'lowercase': baseName = baseName.toLowerCase(); break;
                    case 'uppercase': baseName = baseName.toUpperCase(); break;
                    case 'numbering':
                        const num = String(index + (parseInt(rule.start) || 1)).padStart(rule.padding || 1, '0');
                        if (rule.position === 'start') baseName = num + (rule.separator || '-') + baseName;
                        else baseName = baseName + (rule.separator || '-') + num;
                        break;
                    case 'remove_special':
                        baseName = baseName.replace(/[^a-zA-Z0-9\s-_]/g, '');
                        break;
                    case 'pattern':
                        if (rule.pattern) {
                            const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
                            const pathParts = pathPart.split('/').filter(p => p);
                            const parentFolder = pathParts.length > 0 ? pathParts[pathParts.length - 1] : '';
                            const depth = pathParts.length;
                            const extWithoutDot = ext.replace(/^\./, '');
                            
                            const result = rule.pattern
                                .replace(/\{name\}/g, baseName)
                                .replace(/\{index\}/g, String(index + 1).padStart(3, '0'))
                                .replace(/\{ext\}/g, extWithoutDot)
                                .replace(/\{parent\}/g, parentFolder)
                                .replace(/\{date\}/g, currentDate)
                                .replace(/\{depth\}/g, String(depth));
                            
                            // Replace the entire basename with the pattern result
                            baseName = result;
                            
                            // If pattern includes {ext}, user is handling extension themselves
                            // So we clear the ext to avoid double extension
                            if (rule.pattern.includes('{ext}')) {
                                ext = '';
                            }
                        }
                        break;
                }
            }
            // Re-append trailing slash for directories
            return (pathPart + baseName + ext + trailingSlash).replace(/\\/g, '/');
        },

        previewName(originalName, index) {
            // Robust parsing of simple paths for preview
            const lastSlash = Math.max(originalName.lastIndexOf('/'), originalName.lastIndexOf('\\'));
            let pathPart = '';
            let filePart = originalName;

            if (lastSlash !== -1) {
                pathPart = originalName.substring(0, lastSlash + 1);
                filePart = originalName.substring(lastSlash + 1);
            }

            const lastDot = filePart.lastIndexOf('.');
            let baseName = filePart;
            let ext = '';

            if (lastDot !== -1 && lastDot > 0) { // Ensure dot is not start of filename (hidden file)
                baseName = filePart.substring(0, lastDot);
                ext = filePart.substring(lastDot);
            }

            for (const rule of this.rules) {
                // --- Scope Checks (Sync with Backend) ---
                if (rule.scope === 'extension' && rule.scopeValue) {
                    let targetExt = rule.scopeValue.startsWith('.') ? rule.scopeValue : '.' + rule.scopeValue;
                    if (ext.toLowerCase() !== targetExt.toLowerCase()) continue;
                }
                if (rule.scope === 'folder' && rule.scopeValue) {
                    const normPath = originalName.replace(/\\/g, '/');
                    const normFolder = rule.scopeValue.replace(/\\/g, '/');
                    if (!normPath.startsWith(normFolder)) continue;
                }

                switch (rule.type) {
                    case 'replace':
                        if (rule.find) baseName = baseName.replace(new RegExp(this.escapeRegExp(rule.find), 'g'), rule.replace || '');
                        break;
                    case 'prefix': if (rule.text) baseName = rule.text + baseName; break;
                    case 'suffix': if (rule.text) baseName = baseName + rule.text; break;
                    case 'lowercase': baseName = baseName.toLowerCase(); break;
                    case 'uppercase': baseName = baseName.toUpperCase(); break;
                    case 'numbering':
                        const num = String(index + (parseInt(rule.start) || 1)).padStart(rule.padding || 1, '0');
                        if (rule.position === 'start') baseName = num + (rule.separator || '-') + baseName;
                        else baseName = baseName + (rule.separator || '-') + num;
                        break;
                    case 'remove_special':
                        baseName = baseName.replace(/[^a-zA-Z0-9\s-_]/g, '');
                        break;
                }
            }
            return pathPart + baseName + ext;
        },

        escapeRegExp(string) {
            return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        },

        async downloadZip() {
            // Growth Mode: Always allow download
            /* if (this.limitExceeded && !this.isPaid) {
                this.showUpgradeModal = true;
                return;
            } */

            this.isProcessing = true;
            try {
                const res = await fetch('/api/process', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tempId: this.tempId,
                        ruleGroups: this.ruleGroups,
                        originalFileName: this.originalFileName,
                        unlockToken: this.unlockToken
                    })
                });

                if (res.status === 402) {
                    this.showUpgradeModal = true;
                    this.isProcessing = false;
                    return;
                }

                if (!res.ok) throw new Error('Processing failed');

                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `renamed_files.zip`;
                document.body.appendChild(a);
                a.click();
                a.remove();
            } catch (e) {
                alert('Error processing ZIP: ' + e.message);
            } finally {
                this.isProcessing = false;
            }
        },

        async startCheckout(priceId) {
            try {
                const res = await fetch('/api/create-checkout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        successUrl: window.location.origin + '/',
                        cancelUrl: window.location.origin + '/',
                        priceId: priceId
                    })
                });
                const session = await res.json();
                if (session.url) {
                    window.location.href = session.url;
                }
            } catch (e) {
                alert('Checkout failed: ' + e.message);
            }
        }
    }));
});
