document.addEventListener('alpine:init', () => {
    Alpine.data('app', () => ({
        step: 1, // 1: Upload, 2: Config/Preview, 3: Download
        files: [],
        totalFiles: 0,
        tempId: null,
        isDragging: false,
        isProcessing: false,
        limitExceeded: false,
        isPaid: false,
        rules: [],

        // i18n
        lang: 'en',
        currentTranslations: {},

        init() {
            // Load default language
            this.setLang('en');

            // Check for payment session_id in URL
            const urlParams = new URLSearchParams(window.location.search);
            const sessionId = urlParams.get('session_id');
            if (sessionId) {
                this.verifyPayment(sessionId);
            }
        },

        async setLang(l) {
            this.lang = l;
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
                this.limitExceeded = data.limitExceeded;

                if (this.limitExceeded) {
                    // Growth Mode: Ignore limit
                    this.showUpgradeModal = false;
                }

                this.step = 2;
                // Add default rule
                if (this.rules.length === 0) {
                    this.addRule('replace');
                }
            } catch (e) {
                alert('Error analyzing ZIP: ' + e.message);
            } finally {
                this.isProcessing = false;
            }
        },

        addRule(type) {
            const defaults = {
                replace: { type: 'replace', find: '', replace: '' },
                prefix: { type: 'prefix', text: 'new_' },
                suffix: { type: 'suffix', text: '_v1' },
                numbering: { type: 'numbering', start: 1, padding: 3, separator: '-', position: 'end' },
                lowercase: { type: 'lowercase' },
                uppercase: { type: 'uppercase' },
                remove_special: { type: 'remove_special' }
            };
            this.rules.push({ ...defaults[type], id: Date.now() });
        },

        removeRule(index) {
            this.rules.splice(index, 1);
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
                        rules: this.rules,
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
