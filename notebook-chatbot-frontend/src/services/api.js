const GEMINI_API_BASE_URL = (
  import.meta.env.VITE_GEMINI_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  ""
).replace(/\/$/, "");

const SOURCE_STORAGE_KEY = "notebook_chatbot_sources";
const SOURCE_FILE_DB_NAME = "notebook_chatbot_file_store";
const SOURCE_FILE_STORE = "files";
const MAX_INLINE_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_CONTEXT_CHARS = 60000;

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function readSources() {
  try {
    return JSON.parse(localStorage.getItem(SOURCE_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeSources(sources) {
  localStorage.setItem(SOURCE_STORAGE_KEY, JSON.stringify(sources));
}

function openFileDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SOURCE_FILE_DB_NAME, 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(SOURCE_FILE_STORE);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runFileStoreTransaction(mode, callback) {
  const db = await openFileDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SOURCE_FILE_STORE, mode);
    const store = transaction.objectStore(SOURCE_FILE_STORE);
    const request = callback(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

function saveSourceFile(sourceId, filePayload) {
  return runFileStoreTransaction("readwrite", (store) =>
    store.put(filePayload, sourceId)
  );
}

function getSourceFile(sourceId) {
  return runFileStoreTransaction("readonly", (store) => store.get(sourceId));
}

function deleteSourceFile(sourceId) {
  return runFileStoreTransaction("readwrite", (store) =>
    store.delete(sourceId)
  );
}

function getFileType(fileName = "") {
  const extension = fileName.split(".").pop()?.toUpperCase();

  if (extension === "PDF") return "PDF";
  if (extension === "DOCX") return "DOCX";
  if (extension === "PPT" || extension === "PPTX") return "PPT";
  if (extension === "TXT" || extension === "MD") return "TEXT";

  return extension || "FILE";
}

function getMimeType(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (file.type) return file.type;
  if (extension === "pdf") return "application/pdf";
  if (extension === "txt") return "text/plain";
  if (extension === "md") return "text/markdown";
  if (extension === "csv") return "text/csv";
  if (extension === "json") return "application/json";

  return "application/octet-stream";
}

function isTextFile(file) {
  const mimeType = getMimeType(file);
  const extension = file.name.split(".").pop()?.toLowerCase();

  return (
    mimeType.startsWith("text/") ||
    ["txt", "md", "csv", "json"].includes(extension)
  );
}

function canSendInlineToGemini(mimeType) {
  return mimeType === "application/pdf" || mimeType.startsWith("image/");
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };

    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function buildSource({
  name,
  type,
  content = "",
  fileKind = "text",
  mimeType = "",
  url = null,
  size = 0,
}) {
  const now = new Date().toISOString();
  const safeContent = content || "";
  const chunks = chunkText(safeContent);

  return {
    id: createId("source"),
    name,
    type,
    url,
    pages: Math.max(1, chunks.length),
    status: "Processed",
    processingStatus: "completed",
    sizeReadable: formatBytes(size || safeContent.length),
    totalCharacters: safeContent.length,
    totalChunks: Math.max(1, chunks.length),
    textPreview:
      safeContent.slice(0, 500) ||
      (fileKind === "inline"
        ? "This file will be sent directly to Gemini when selected."
        : ""),
    content: safeContent,
    fileKind,
    mimeType,
    fileSize: size,
    createdAt: now,
    updatedAt: now,
  };
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );

  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function chunkText(text) {
  if (!text.trim()) return [];

  const chunkSize = 1200;
  const chunks = [];

  for (let index = 0; index < text.length; index += chunkSize) {
    chunks.push(text.slice(index, index + chunkSize));
  }

  return chunks;
}

function mapSourceToChunks(source) {
  return chunkText(source.content || "").map((text, index) => ({
    id: `${source.id}_chunk_${index}`,
    chunkIndex: index,
    pageNumber: index + 1,
    text,
  }));
}

function buildPrompt(question, selectedSources) {
  if (selectedSources.length === 0) {
    return question;
  }

  let remainingCharacters = MAX_TEXT_CONTEXT_CHARS;

  const sourceContext = selectedSources
    .map((source, index) => {
      let content =
        source.fileKind === "inline"
          ? "This source is attached as a file part. Read the attached file directly."
          : source.content?.trim() || source.textPreview?.trim() || "";

      if (content.length > remainingCharacters) {
        content = `${content.slice(0, remainingCharacters)}\n[Source truncated before sending to Gemini.]`;
      }

      remainingCharacters = Math.max(0, remainingCharacters - content.length);

      if (!content) {
        content = "No extracted text is available for this source.";
      }

      return `Source ${index + 1}: ${source.name}\n${content}`;
    })
    .join("\n\n---\n\n");

  return `Use the selected notebook sources to answer the question. If the sources do not contain enough information, say that clearly and then answer from general knowledge only if helpful.

Selected sources:
${sourceContext}

Question:
${question}`;
}

async function buildGeminiFiles(selectedSources) {
  const inlineSources = selectedSources.filter(
    (source) => source.fileKind === "inline"
  );

  const files = [];

  for (const source of inlineSources) {
    if (source.fileSize > MAX_INLINE_FILE_BYTES) {
      throw new Error(
        `${source.name} is too large to send inline. Please use a PDF under ${formatBytes(
          MAX_INLINE_FILE_BYTES
        )}.`
      );
    }

    const filePayload = await getSourceFile(source.id);

    if (!filePayload?.data || !filePayload?.mimeType) {
      throw new Error(`${source.name} is missing from browser file storage.`);
    }

    files.push({
      name: source.name,
      mimeType: filePayload.mimeType,
      data: filePayload.data,
    });
  }

  return files;
}

function parseStreamPayload(rawData) {
  if (!rawData || rawData === "[DONE]") {
    return { type: "end" };
  }

  if (rawData === "[ERROR]") {
    return { type: "error", message: "Gemini stream failed." };
  }

  try {
    return JSON.parse(rawData);
  } catch {
    return { delta: rawData };
  }
}

function waitForStreamOpen(eventSource) {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error("Could not connect to Gemini stream."));
    }, 5000);

    const handleOpen = () => {
      window.clearTimeout(timeoutId);
      eventSource.removeEventListener("open", handleOpen);
      eventSource.removeEventListener("error", handleError);
      resolve();
    };

    const handleError = () => {
      if (eventSource.readyState === EventSource.CLOSED) {
        window.clearTimeout(timeoutId);
        eventSource.removeEventListener("open", handleOpen);
        eventSource.removeEventListener("error", handleError);
        reject(new Error("Gemini stream connection closed."));
      }
    };

    eventSource.addEventListener("open", handleOpen);
    eventSource.addEventListener("error", handleError);
  });
}

export async function getSources() {
  return {
    sources: readSources(),
  };
}

export async function getSourceById(sourceId) {
  const source = readSources().find((item) => item.id === sourceId);

  if (!source) {
    throw new Error("Source not found.");
  }

  return {
    source,
    chunks: mapSourceToChunks(source),
  };
}

export async function uploadSourceFile(file) {
  const mimeType = getMimeType(file);

  if (isTextFile(file)) {
    const content = await file.text();
    const source = buildSource({
      name: file.name,
      type: getFileType(file.name),
      content,
      mimeType,
      size: file.size,
    });

    const sources = [source, ...readSources()];
    writeSources(sources);

    return source;
  }

  if (!canSendInlineToGemini(mimeType)) {
    throw new Error("Only PDF, image, and plain text files can be sent to Gemini right now.");
  }

  if (file.size > MAX_INLINE_FILE_BYTES) {
    throw new Error(
      `${file.name} is too large. Please upload a file under ${formatBytes(
        MAX_INLINE_FILE_BYTES
      )}.`
    );
  }

  const source = buildSource({
    name: file.name,
    type: getFileType(file.name),
    fileKind: "inline",
    mimeType,
    size: file.size,
  });

  await saveSourceFile(source.id, {
    name: file.name,
    mimeType,
    size: file.size,
    data: await readFileAsBase64(file),
  });

  const sources = [source, ...readSources()];
  writeSources(sources);

  return source;
}

export async function uploadTextSource(title, content) {
  const source = buildSource({
    name: title,
    type: "TEXT",
    content,
    size: content.length,
  });

  const sources = [source, ...readSources()];
  writeSources(sources);

  return source;
}

export async function uploadLinkSource(url) {
  const source = buildSource({
    name: url,
    type: "LINK",
    url,
    content: `Link source added by the user: ${url}`,
    size: url.length,
  });

  const sources = [source, ...readSources()];
  writeSources(sources);

  return source;
}

export async function deleteSourceById(sourceId) {
  await deleteSourceFile(sourceId);
  writeSources(readSources().filter((source) => source.id !== sourceId));
}

export async function chatWithSources(question, sourceIds = []) {
  let answer = "";
  let endPayload = {};

  await streamChatWithSources({
    question,
    sourceIds,
    onToken: (token) => {
      answer += token;
    },
    onEnd: (payload) => {
      endPayload = payload;
    },
  });

  return {
    answer,
    ...endPayload,
  };
}

export async function streamChatWithSources({
  question,
  sourceIds = [],
  onToken,
  onEnd,
}) {
  const allSources = readSources();
  const selectedSources = allSources.filter((source) =>
    sourceIds.includes(source.id)
  );

  const eventSource = new EventSource(`${GEMINI_API_BASE_URL}/stream`);
  let streamComplete = false;
  let streamError = null;
  let postComplete = false;

  const streamPromise = new Promise((resolve, reject) => {
    eventSource.addEventListener("message", (event) => {
      const payload = parseStreamPayload(event.data);

      if (payload.type === "error" || payload.error) {
        streamError = new Error(
          payload.message || payload.error || "Gemini stream failed."
        );
        eventSource.close();
        reject(streamError);
        return;
      }

      if (payload.type === "end") {
        streamComplete = true;
        eventSource.close();
        onEnd?.({
          citations: selectedSources.map((source) => ({
            sourceName: source.name,
            page: 1,
          })),
        });
        resolve();
        return;
      }

      const token = payload.delta || payload.text || "";

      if (token) {
        onToken?.(token);
      }
    });

    eventSource.addEventListener("error", () => {
      if (!streamComplete && postComplete) {
        streamError = new Error("Gemini stream connection failed.");
        eventSource.close();
        reject(streamError);
      }
    });
  });

  try {
    await waitForStreamOpen(eventSource);

    const response = await fetch(`${GEMINI_API_BASE_URL}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: buildPrompt(question, selectedSources),
        files: await buildGeminiFiles(selectedSources),
      }),
    });

    postComplete = true;

    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw new Error(message || "Gemini request failed.");
    }

    await streamPromise;
  } catch (error) {
    eventSource.close();
    throw streamError || error;
  }
}
