// server\index.js
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const app = express();
app.use(cors());
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '25mb' }));

const port = process.env.PORT || 3001;
const geminiApiKey = process.env.GEMINI_API_KEY;
const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

if (!geminiApiKey) {
  console.warn('GEMINI_API_KEY is not set. Requests to /send will fail until it is configured.');
} else {
  console.log('Gemini model set to:', geminiModel);
}

const genAI = geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null;
const model = genAI ? genAI.getGenerativeModel({ model: geminiModel }) : null;

const notebookBuildPath = path.join(__dirname, '../notebook-chatbot-frontend/dist');
const legacyBuildPath = path.join(__dirname, '../build');
const staticBuildPath = fs.existsSync(notebookBuildPath) ? notebookBuildPath : legacyBuildPath;

// Serve static files from the Vite notebook frontend when it has been built.
app.use(express.static(staticBuildPath));

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    geminiConfigured: Boolean(geminiApiKey),
  });
});

let eventStreamResponse;

function hasActiveStream() {
  return eventStreamResponse && !eventStreamResponse.destroyed && !eventStreamResponse.writableEnded;
}

function sendStreamEvent(payload) {
  if (hasActiveStream()) {
    eventStreamResponse.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

function buildGeminiRequestParts(message, files = []) {
  const parts = [
    {
      text: `You are a helpful assistant. Use any attached notebook files as source material when they are relevant.\n\nUser: ${message}`,
    },
  ];

  files.forEach((file) => {
    if (!file?.data || !file?.mimeType) {
      return;
    }

    parts.push({
      inlineData: {
        data: file.data,
        mimeType: file.mimeType,
      },
    });
  });

  return parts;
}

app.post('/send', async (req, res) => {
  try {
    if (!model) {
      return res.status(500).send('GEMINI_API_KEY is not configured');
    }

    const userMessage = req.body.message || '';
    const files = Array.isArray(req.body.files) ? req.body.files : [];

    if (!hasActiveStream()) {
      return res.status(503).send('No active stream client');
    }

    const result = await model.generateContentStream(
      buildGeminiRequestParts(userMessage, files)
    );

    for await (const chunk of result.stream) {
      const text = chunk.text?.() || '';
      if (text) {
        sendStreamEvent({ delta: text });
      }
    }

    if (hasActiveStream()) {
      eventStreamResponse.write('data: [DONE]\n\n');
    }

    return res.status(200).json({ message: 'Stream started' });
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    if (hasActiveStream()) {
      sendStreamEvent({ error: 'Error processing your request' });
      eventStreamResponse.write('data: [ERROR]\n\n');
    }
    return res.status(500).send('Error processing your request');
  }
});

app.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  eventStreamResponse = res;
  req.on('close', () => {
    if (eventStreamResponse === res) {
      eventStreamResponse = null;
    }
  });
});

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res
      .status(413)
      .send('Request is too large. Try a smaller PDF or increase JSON_BODY_LIMIT.');
  }

  return next(err);
});

// The "catchall" handler: for any request that doesn't match one above, send back the index.html file.
app.get('*', (req, res) => {
  res.sendFile(path.join(staticBuildPath, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
