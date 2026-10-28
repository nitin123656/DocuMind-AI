import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  Check,
  FileText,
  FileUp,
  MessageSquareText,
  Sparkles,
  Upload,
  X,
} from "lucide-react";

const API_BASE = "https://documind-ai-qttq.onrender.com/api";

async function readResponse(response) {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Server responded with ${response.status}`);
  }
  return data;
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-1" aria-label="DocuMind is thinking">
      {[0, 1, 2].map((dot) => (
        <motion.span
          key={dot}
          className="size-2 rounded-full bg-violet-300"
          animate={{ y: [0, -5, 0], opacity: [0.45, 1, 0.45] }}
          transition={{ duration: 0.8, repeat: Infinity, delay: dot * 0.14 }}
        />
      ))}
    </div>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === "user";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className={`flex w-full gap-3 ${isUser ? "justify-end" : "justify-start"}`}
    >
      {!isUser && (
        <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-xl border border-violet-300/20 bg-violet-400/10 text-violet-200">
          <Sparkles size={15} />
        </div>
      )}
      <div
        className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-6 sm:max-w-[76%] ${
          isUser
            ? "rounded-br-md bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-950/40"
            : "rounded-tl-md border border-white/[0.08] bg-white/[0.045] text-slate-200 shadow-lg shadow-black/10 backdrop-blur-xl"
        }`}
      >
        {message.loading ? (
          <ThinkingIndicator />
        ) : (
          <p className="whitespace-pre-wrap break-words">{message.text}</p>
        )}
        {!isUser && message.sources?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-white/[0.07] pt-3">
            {message.sources.map((source, index) => (
              <motion.span
                key={`${source.sourceNumber ?? index}-${source.chunkIndex ?? ""}`}
                whileHover={{ y: -2, scale: 1.03 }}
                title={source.excerpt || `Document chunk ${source.chunkIndex ?? index + 1}`}
                className="inline-flex cursor-help items-center gap-1.5 rounded-full border border-cyan-300/15 bg-cyan-300/[0.07] px-2.5 py-1 text-[11px] font-medium text-cyan-200 shadow-[0_0_18px_rgba(34,211,238,0.07)] transition-colors hover:border-cyan-200/40 hover:bg-cyan-300/[0.13]"
              >
                <FileText size={11} />
                Source {source.sourceNumber ?? index + 1}
                <span className="text-cyan-100/50">•</span>
                {Number(source.similarity).toFixed(2)}
              </motion.span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function App() {
  const [file, setFile] = useState(null);
  const [docInfo, setDocInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: "ai",
      text: "Your documents, ready to think with. Upload a PDF or text file and ask me anything inside it.",
      sources: [],
    },
  ]);
  const [uploadError, setUploadError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  function selectFile(nextFile) {
    if (!nextFile) return;
    const isSupported =
      nextFile.type === "application/pdf" ||
      nextFile.type === "text/plain" ||
      /\.(pdf|txt)$/i.test(nextFile.name);
    if (!isSupported) {
      setUploadError("Please choose a PDF or TXT file.");
      return;
    }
    setFile(nextFile);
    setDocInfo(null);
    setUploadError("");
  }

  async function handleUpload(event) {
    event.preventDefault();
    if (!file || loading) return;

    setLoading(true);
    setUploading(true);
    setUploadError("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      
      const response = await fetch(`${API_BASE}/p1/upload`, { method: "POST", body: formData });
      
      const data = await readResponse(response);
      setDocInfo(data);
      setMessages([
        {
          id: Date.now(),
          role: "ai",
          text: `I've read ${data.fileName} and indexed ${data.totalChunks} ${data.totalChunks === 1 ? "section" : "sections"}. What would you like to know?`,
          sources: [],
        },
      ]);
    } catch (error) {
      setUploadError(error.message);
    } finally {
      setLoading(false);
      setUploading(false);
    }
  }

  async function handleAsk(event) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || !docInfo || loading) return;

    const userMessage = { id: Date.now(), role: "user", text: trimmed, sources: [] };
    const pendingId = Date.now() + 1;
    setMessages((previous) => [
      ...previous,
      userMessage,
      { id: pendingId, role: "ai", text: "", sources: [], loading: true },
    ]);
    setQuestion("");
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/p1/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: docInfo.documentId, question: trimmed }),
      });
      
      const data = await readResponse(response);
      setMessages((previous) => [
        ...previous.filter((message) => message.id !== pendingId),
        { id: Date.now() + 2, role: "ai", text: data.answer, sources: data.sources },
      ]);
    } catch (error) {
      setMessages((previous) => [
        ...previous.filter((message) => message.id !== pendingId),
        { id: Date.now() + 3, role: "ai", text: `I couldn't complete that request: ${error.message}`, sources: [] },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);
    selectFile(event.dataTransfer.files?.[0]);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100 selection:bg-violet-400/30">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-48 size-[32rem] rounded-full bg-indigo-600/[0.13] blur-[140px]" />
        <div className="absolute -right-40 top-[28%] size-[30rem] rounded-full bg-fuchsia-600/[0.09] blur-[150px]" />
        <div className="absolute bottom-[-18rem] left-[35%] size-[32rem] rounded-full bg-cyan-500/[0.07] blur-[150px]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-4 sm:px-6 lg:px-10">
        <header className="flex h-[76px] shrink-0 items-center justify-between border-b border-white/[0.07]">
          <a href="/" className="group flex items-center gap-3" aria-label="DocuMind home">
            <span className="relative flex size-10 items-center justify-center rounded-2xl border border-violet-300/20 bg-gradient-to-br from-indigo-400/20 to-fuchsia-400/10 text-violet-200 shadow-[0_0_28px_rgba(139,92,246,0.16)]">
              <Sparkles size={19} />
              <span className="absolute -right-1 -top-1 size-2.5 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.9)]" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-white">
              DocuMind<span className="text-violet-300"> AI</span>
            </span>
          </a>
          <div className="flex items-center gap-2 rounded-full border border-emerald-300/10 bg-emerald-300/[0.045] px-3 py-1.5 text-[11px] font-medium text-emerald-200/80">
            <span className="size-1.5 rounded-full bg-emerald-300 shadow-[0_0_9px_rgba(110,231,183,0.8)]" />
            PRIVATE WORKSPACE
          </div>
        </header>

        <section className="flex flex-1 flex-col py-7 lg:py-10">
          <div className="mb-7 flex flex-col gap-2">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-violet-300/80">
              <Sparkles size={13} />
              Your AI study space
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Make sense of <span className="bg-gradient-to-r from-indigo-300 via-violet-300 to-cyan-200 bg-clip-text text-transparent">every page.</span>
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-slate-400">
              Bring your notes into focus. Ask questions and get grounded answers with citations to your source.
            </p>
          </div>

          <div className="grid flex-1 gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
            <aside className="flex flex-col gap-4">
              <div className="rounded-3xl border border-white/[0.08] bg-white/[0.035] p-5 shadow-2xl shadow-black/20 backdrop-blur-2xl">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">Your document</p>
                    <p className="mt-1 text-xs text-slate-500">PDF or plain text</p>
                  </div>
                  <span className="flex size-9 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.04] text-violet-200">
                    <FileText size={16} />
                  </span>
                </div>

                <form onSubmit={handleUpload}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.txt,application/pdf,text/plain"
                    className="sr-only"
                    onChange={(event) => {
                      selectFile(event.target.files?.[0]);
                      event.currentTarget.value = "";
                    }}
                  />
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.015 }}
                    whileTap={{ scale: 0.985 }}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    className={`group flex min-h-[166px] w-full flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-5 text-center transition-all ${
                      isDragging
                        ? "border-violet-300 bg-violet-400/[0.12] shadow-[0_0_28px_rgba(139,92,246,0.2)]"
                        : "border-white/[0.13] bg-slate-950/40 hover:border-violet-300/50 hover:bg-violet-400/[0.04]"
                    }`}
                  >
                    <span className="mb-3 flex size-11 items-center justify-center rounded-2xl border border-violet-300/15 bg-gradient-to-br from-indigo-400/15 to-fuchsia-400/10 text-violet-200 transition-transform group-hover:-translate-y-0.5">
                      <Upload size={19} />
                    </span>
                    <span className="text-sm font-medium text-slate-200">
                      {file ? "Document selected" : "Drop a file here"}
                    </span>
                    <span className="mt-1 text-xs text-slate-500">
                      {file ? "Click to choose another" : "or click to browse · PDF, TXT"}
                    </span>
                  </motion.button>

                  <AnimatePresence mode="wait">
                    {file && (
                      <motion.div
                        key={file.name}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        className="mt-3 flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.035] p-3"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-cyan-300/[0.08] text-cyan-200">
                          <FileText size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-slate-200">{file.name}</span>
                          <span className="mt-0.5 block text-[10px] text-slate-500">
                            {(file.size / 1024 / 1024).toFixed(file.size < 1024 * 1024 ? 3 : 2)} MB
                          </span>
                        </span>
                        <button
                          type="button"
                          aria-label="Remove selected file"
                          onClick={() => {
                            setFile(null);
                            setDocInfo(null);
                            setUploadError("");
                          }}
                          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/[0.06] hover:text-white"
                        >
                          <X size={14} />
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <motion.button
                    type="submit"
                    disabled={!file || loading}
                    animate={loading && uploading ? { opacity: [0.75, 1, 0.75] } : { opacity: 1 }}
                    transition={loading && uploading ? { duration: 1.1, repeat: Infinity } : { duration: 0.2 }}
                    whileHover={!loading && file ? { scale: 1.015 } : {}}
                    whileTap={!loading && file ? { scale: 0.985 } : {}}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-950/40 transition hover:shadow-violet-900/30 disabled:cursor-not-allowed disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-400 disabled:shadow-none"
                  >
                    {loading && uploading ? (
                      <>
                        <motion.span
                          className="size-4 rounded-full border-2 border-white/30 border-t-white"
                          animate={{ rotate: 360 }}
                          transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                        />
                        Indexing document...
                      </>
                    ) : docInfo ? (
                      <>
                        <Check size={16} />
                        Indexed successfully
                      </>
                    ) : (
                      <>
                        <FileUp size={16} />
                        Upload &amp; Index
                      </>
                    )}
                  </motion.button>
                </form>

                {uploadError && (
                  <motion.p
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    role="alert"
                    className="mt-3 rounded-lg border border-rose-400/15 bg-rose-400/[0.06] px-3 py-2 text-xs leading-5 text-rose-200"
                  >
                    {uploadError}
                  </motion.p>
                )}

                {docInfo && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 rounded-xl border border-emerald-300/10 bg-emerald-300/[0.045] p-3"
                  >
                    <div className="flex items-center gap-2 text-xs font-medium text-emerald-200">
                      <Check size={14} />
                      Ready to explore
                    </div>
                    <p className="mt-2 truncate text-xs text-slate-400" title={docInfo.fileName}>
                      {docInfo.fileName}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {docInfo.totalChunks} indexed {docInfo.totalChunks === 1 ? "section" : "sections"}
                    </p>
                  </motion.div>
                )}
              </div>

              <div className="hidden rounded-3xl border border-white/[0.07] bg-white/[0.025] p-5 lg:block">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-cyan-300/[0.08] text-cyan-200">
                    <MessageSquareText size={14} />
                  </span>
                  How it works
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  DocuMind finds the most relevant passages in your file, then uses them to answer with source citations.
                </p>
              </div>
            </aside>

            <section className="flex h-[600px] min-h-0 flex-col overflow-hidden rounded-3xl border border-white/[0.09] bg-slate-900/60 shadow-2xl shadow-black/30 backdrop-blur-2xl">
              <div className="flex h-[68px] shrink-0 items-center justify-between border-b border-white/[0.07] px-4 sm:px-6">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-xl border border-violet-300/15 bg-violet-400/[0.08] text-violet-200">
                    <MessageSquareText size={16} />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">Document chat</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {docInfo ? "Answers grounded in your file" : "Upload a file to begin"}
                    </p>
                  </div>
                </div>
                {docInfo && (
                  <div className="hidden max-w-[42%] items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.035] px-3 py-1.5 sm:flex">
                    <FileText size={12} className="shrink-0 text-cyan-200" />
                    <span className="truncate text-[11px] text-slate-400">{docInfo.fileName}</span>
                  </div>
                )}
              </div>

              <div
                aria-live="polite"
                className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 [scrollbar-color:rgba(148,163,184,0.2)_transparent] [scrollbar-width:thin] sm:px-6"
              >
                <AnimatePresence initial={false}>
                  {messages.map((message) => (
                    <MessageBubble key={message.id} message={message} />
                  ))}
                </AnimatePresence>
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={handleAsk} className="shrink-0 border-t border-white/[0.07] bg-slate-950/35 p-3 sm:p-4">
                <div className="flex items-end gap-2 rounded-2xl border border-white/[0.09] bg-white/[0.035] p-2 transition focus-within:border-violet-300/30 focus-within:shadow-[0_0_24px_rgba(139,92,246,0.08)]">
                  <textarea
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    placeholder={docInfo ? "Ask anything about your document..." : "Upload a document to start chatting"}
                    aria-label="Question about the uploaded document"
                    disabled={!docInfo || loading}
                    rows={1}
                    className="max-h-28 min-h-10 flex-1 resize-y bg-transparent px-2 py-2 text-sm leading-5 text-slate-100 outline-none placeholder:text-slate-600 disabled:cursor-not-allowed"
                  />
                  <motion.button
                    type="submit"
                    aria-label="Send question"
                    disabled={!docInfo || loading || !question.trim()}
                    whileHover={docInfo && !loading && question.trim() ? { scale: 1.06 } : {}}
                    whileTap={docInfo && !loading && question.trim() ? { scale: 0.94 } : {}}
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-md shadow-indigo-950/40 transition disabled:cursor-not-allowed disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-600 disabled:shadow-none"
                  >
                    <ArrowUp size={17} />
                  </motion.button>
                </div>
                <p className="mt-2 text-center text-[10px] text-slate-600">
                  AI responses are based on your uploaded document · Enter to send
                </p>
              </form>
            </section>
          </div>
        </section>

        <footer className="flex h-12 shrink-0 items-center justify-center border-t border-white/[0.06] text-[10px] tracking-wide text-slate-600">
          YOUR DOCUMENTS STAY YOURS <span className="mx-2 text-slate-700">·</span> GROUNDED ANSWERS, REAL SOURCES
        </footer>
      </div>
    </main>
  );
}