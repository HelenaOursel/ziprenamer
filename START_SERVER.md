# How to Run ZipRenamer

## IMPORTANT: You must run the server, not open HTML files directly!

### Step 1: Start the Server

Open a terminal in the project folder and run:

```bash
node src/server.js
```

You should see:
```
Server Temp Dir: C:\Users\helena\zip_renamer\temp
ZipRenamer Pro running on port 3000
```

### Step 2: Open in Browser

Open your browser and go to:

```
http://localhost:3000
```

**DO NOT** open `public/index.html` directly by double-clicking it! 
That opens it as `file://` which won't work with the backend.

### Step 3: Upload a ZIP

1. Drag & drop a ZIP file or click to select
2. You'll be redirected to the config page
3. Add rules
4. Click "Download Renamed ZIP"

### Troubleshooting

If you see "processing error zip":
1. Check the terminal where the server is running for error messages
2. Make sure the `temp` folder exists in the project root
3. Check that the server is still running (terminal shows the logs)

If nothing appears in the temp folder when uploading:
1. You're probably opening the HTML file directly instead of through the server
2. The server must be running (`node src/server.js`)
3. Access via `http://localhost:3000` in the browser
