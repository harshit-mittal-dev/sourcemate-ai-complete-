# SourceMate AI

SourceMate AI is a NotebookLM-inspired AI chatbot frontend where users can create notebooks, upload sources, chat with documents, view source references, save notes, and export chat history.

This project is a NotebookLM-inspired React frontend wired to the Gemini SSE backend in `../server/index.js`. Sources are currently stored in browser local storage and selected source text is included in the Gemini prompt.

PDFs and images are stored in browser IndexedDB and sent to Gemini as file attachments when selected. The current inline upload limit is 15 MB per file.

---

## Run with Gemini Backend

Create `../server/.env`:

```txt
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.1-flash-lite
```

Create `.env` in this folder:

```txt
VITE_GEMINI_API_URL=http://localhost:3001
```

Start the backend from the parent app folder:

```bash
cd ..
node server/index.js
```

Start the Vite frontend from this folder:

```bash
npm run dev
```

For production serving through Express, build this Vite app first:

```bash
npm run build
cd ..
node server/index.js
```

---

## Features

- Dashboard page with recent notebooks
- Create new notebook modal
- Notebook workspace layout
- Upload file source
- Paste text source
- Add website link source
- Source sidebar with select/unselect option
- Source preview modal
- Delete source option
- AI-style chat interface
- Streaming Gemini responses
- Source citation chips
- Save answers as notes
- Copy AI responses
- Explain easier option
- Typing/loading animation
- Study tools panel
- Saved notes panel
- Clear chat option
- Export sources, notes, and chat history as a text file
- Light and dark mode
- Responsive layout

---

## Tech Stack

- React
- Vite
- JavaScript
- CSS

---

## Project Structure

```txt
src/
  components/
    ChatPanel.jsx
    Dashboard.jsx
    SourcePreviewModal.jsx
    SourcesPanel.jsx
    ToolsPanel.jsx
    Topbar.jsx
    UploadModal.jsx
  App.jsx
  App.css
  index.css
  main.jsx
