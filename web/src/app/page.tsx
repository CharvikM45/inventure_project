"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { useVoiceAssistant } from "@/hooks/useVoiceAssistant";
import { getFaceDescriptor } from "@/hooks/useFaceRecognition";

// Dynamic import to avoid SSR issues with webcam/tensorflow
const ObjectDetector = dynamic(() => import("@/components/ObjectDetector"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
      <div className="text-white text-xl animate-pulse">Initializing Camera...</div>
    </div>
  ),
});

interface Detection {
  bbox: [number, number, number, number];
  class: string;
  score: number;
  proximity?: 'close' | 'medium' | 'far';
  name?: string;
}


interface TrackedObject {
  id: string;
  class: string;
  approaching: boolean;
}

interface KnownPerson {
  name: string;
  descriptor: number[];
}

export default function Home() {
  const [mode, setMode] = useState<"landing" | "camera" | "photo" | "manage">("landing");
  const [status, setStatus] = useState("Choose an option to start");
  const [detections, setDetections] = useState<Detection[]>([]);
  const [queryTrigger, setQueryTrigger] = useState(0);
  const [staticImage, setStaticImage] = useState<string | null>(null);
  const [knownPeople, setKnownPeople] = useState<KnownPerson[]>([]);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [enrollName, setEnrollName] = useState("");
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);

  const lastAlertRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const enrollInputRef = useRef<HTMLInputElement>(null);
  const bulkInputRef = useRef<HTMLInputElement>(null);

  // Load known people from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("knownPeople");
    if (saved) {
      setKnownPeople(JSON.parse(saved));
    }
  }, []);

  const saveKnownPeople = (people: KnownPerson[]) => {
    setKnownPeople(people);
    localStorage.setItem("knownPeople", JSON.stringify(people));
  };

  const handleCommand = useCallback((command: string) => {
    if (command === "identify") {
      setQueryTrigger((prev) => prev + 1);
    } else if (command === "help") {
      speak(
        "Say 'what is that' to identify objects. I will also warn you if someone is approaching."
      );
    } else if (command === "stop") {
      window.speechSynthesis?.cancel();
    }
  }, []);

  const { isListening, transcript, speak, startListening, stopListening, error } =
    useVoiceAssistant(handleCommand);

  const handleDetections = useCallback((newDetections: Detection[]) => {
    setDetections(newDetections);
  }, []);

  const handleApproaching = useCallback(
    (object: TrackedObject) => {
      const now = Date.now();
      if (now - lastAlertRef.current > 3000) {
        lastAlertRef.current = now;
        speak(`Warning! ${object.class} approaching`);
        setStatus(`⚠️ ${object.class} approaching!`);
      }
    },
    [speak]
  );

  const handleQueryResponse = useCallback(
    (response: string) => {
      speak(response);
      setStatus(response);
    },
    [speak]
  );

  const toggleListening = () => {
    if (isListening) {
      stopListening();
      setStatus("Voice control paused");
    } else {
      startListening();
      setStatus("Listening for commands...");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setStaticImage(event.target?.result as string);
        setMode("photo");
        setStatus("Photo loaded. Tap search to identify.");
      };
      reader.readAsDataURL(file);
    }
  };

  const handleEnrollClick = () => {
    if (!enrollName) {
      alert("Please enter a name first");
      return;
    }
    enrollInputRef.current?.click();
  };

  const handleEnrollFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && enrollName) {
      await processFaceFile(file, enrollName);
      setEnrollName("");
    }
  };

  const processFaceFile = async (file: File, name: string) => {
    setIsEnrolling(true);
    return new Promise<void>((resolve) => {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = async () => {
          try {
            const descriptor = await getFaceDescriptor(img);
            if (descriptor) {
              const newPerson: KnownPerson = {
                name,
                descriptor: Array.from(descriptor),
              };
              setKnownPeople(prev => {
                const updated = [...prev, newPerson];
                localStorage.setItem("knownPeople", JSON.stringify(updated));
                return updated;
              });
              setStatus(`Enrolled ${name}`);
            }
          } catch (err) {
            console.error(`Error processing ${name}:`, err);
          } finally {
            setIsEnrolling(false);
            resolve();
          }
        };
      };
      reader.readAsDataURL(file);
    });
  };

  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setIsEnrolling(true);
    setBulkProgress({ current: 0, total: files.length });

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Extract name from filename (e.g., "John_Doe.jpg" -> "John Doe")
      const name = file.name.split('.')[0].replace(/_/g, ' ').replace(/-/g, ' ');
      await processFaceFile(file, name);
      setBulkProgress({ current: i + 1, total: files.length });
    }

    setBulkProgress(null);
    setIsEnrolling(false);
    setStatus(`Bulk enrollment complete. Processed ${files.length} files.`);
  };

  if (mode === "landing") {
    return (
      <div className="flex min-h-screen w-screen flex-col items-center justify-center bg-background p-6 text-foreground overflow-auto selection:bg-primary/30">
        {/* Background glow effects */}
        <div className="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[120px] pointer-events-none" />
        <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-secondary/20 rounded-full blur-[120px] pointer-events-none" />

        <div className="mb-16 text-center animate-slide-up relative z-10">
          <div className="inline-block px-4 py-1.5 mb-6 rounded-full bg-white/5 border border-white/10 text-primary text-sm font-semibold tracking-wide uppercase">
            AI-Powered Accessibility
          </div>
          <h1 className="text-6xl md:text-7xl font-bold tracking-tight mb-6 glow-effect">
            Visual <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">Assistant</span>
          </h1>
          <p className="text-slate-400 text-xl max-w-xl mx-auto leading-relaxed">
            Enhancing perception through real-time intelligence and voice guidance.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-4xl relative z-10">
          <button
            onClick={() => {
              setMode("camera");
              setStatus("Camera active. Tap mic for voice control.");
            }}
            className="group glass-card p-10 rounded-[2.5rem] flex flex-col items-start text-left animate-slide-up [animation-delay:100ms]"
          >
            <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mb-8 border border-primary/20 group-hover:scale-110 group-hover:rotate-3 transition-transform duration-500">
              <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold mb-3">Live Vision</h2>
            <p className="text-slate-400 leading-relaxed">Real-time object detection, face recognition, and brand identification via camera.</p>
            <div className="mt-8 flex items-center text-primary font-semibold text-sm">
              Launch Camera <svg className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg>
            </div>
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="group glass-card p-10 rounded-[2.5rem] flex flex-col items-start text-left animate-slide-up [animation-delay:200ms]"
          >
            <div className="w-16 h-16 rounded-2xl bg-secondary/20 flex items-center justify-center mb-8 border border-secondary/20 group-hover:scale-110 group-hover:-rotate-3 transition-transform duration-500">
              <svg className="w-8 h-8 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold mb-3">Analyze Photo</h2>
            <p className="text-slate-400 leading-relaxed">Identify objects and people in uploaded images with detailed brand and text extraction.</p>
            <div className="mt-8 flex items-center text-secondary font-semibold text-sm">
              Upload Image <svg className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg>
            </div>
          </button>

          <button
            onClick={() => setMode("manage")}
            className="md:col-span-2 group glass-card p-8 rounded-[2rem] flex items-center justify-between animate-slide-up [animation-delay:300ms]"
          >
            <div className="flex items-center gap-6">
              <div className="w-14 h-14 rounded-2xl bg-accent/20 flex items-center justify-center group-hover:scale-110 transition-transform border border-accent/20">
                <svg className="w-7 h-7 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-bold">Known People</h2>
                <p className="text-slate-400">{knownPeople.length} people enrolled in your database</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-slate-500 text-sm font-medium">Manage Records</span>
              <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-accent/20 group-hover:text-accent transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" strokeWidth={2} /></svg>
              </div>
            </div>
          </button>
        </div>

        <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />

        <p className="mt-16 text-slate-500 text-sm animate-pulse">
          Fully processed on-device for privacy and speed.
        </p>
      </div>
    );
  }

  if (mode === "manage") {
    return (
      <div className="flex min-h-screen w-screen flex-col bg-background p-6 text-foreground overflow-auto">
        <div className="max-w-5xl w-full mx-auto animate-slide-up">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
            <div>
              <button
                onClick={() => setMode("landing")}
                className="flex items-center gap-2 text-slate-500 hover:text-white transition-colors mb-4 group"
              >
                <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-white/10">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </div>
                <span>Back to Menu</span>
              </button>
              <h1 className="text-4xl font-bold tracking-tight">Manage <span className="text-accent">People</span></h1>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => bulkInputRef.current?.click()}
                disabled={isEnrolling}
                className="flex items-center gap-3 px-6 py-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-accent font-semibold transition-all disabled:opacity-50"
              >
                <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span>Massive Dump (Bulk)</span>
              </button>
              <input type="file" ref={bulkInputRef} className="hidden" accept="image/*" multiple onChange={handleBulkUpload} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Direct Enrollment */}
            <div className="lg:col-span-1">
              <div className="glass-card p-8 rounded-[2rem] sticky top-6">
                <h2 className="text-xl font-bold mb-6">Quick Enroll</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">Full Name</label>
                    <input
                      type="text"
                      placeholder="e.g. John Smith"
                      value={enrollName}
                      onChange={(e) => setEnrollName(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-2xl px-5 py-4 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all"
                    />
                  </div>
                  <button
                    onClick={handleEnrollClick}
                    disabled={isEnrolling}
                    className={`w-full py-4 rounded-2xl font-bold transition-all shadow-lg shadow-primary/20 ${isEnrolling ? "bg-slate-800 text-slate-500" : "bg-primary hover:bg-primary/90 text-white"
                      }`}
                  >
                    {isEnrolling ? "Processing..." : "Select & Upload"}
                  </button>
                </div>
                <input type="file" ref={enrollInputRef} className="hidden" accept="image/*" onChange={handleEnrollFile} />

                {bulkProgress && (
                  <div className="mt-8 pt-8 border-t border-white/5">
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-slate-400">Processing Batch...</span>
                      <span className="text-accent font-bold">{bulkProgress.current} / {bulkProgress.total}</span>
                    </div>
                    <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent transition-all duration-300"
                        style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                <p className="text-slate-500 text-sm mt-8 leading-relaxed">
                  For bulk upload, name your files as you want them to appear (e.g. <span className="text-slate-300 italic">John_Doe.jpg</span>).
                </p>
              </div>
            </div>

            {/* List */}
            <div className="lg:col-span-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {knownPeople.map((person, index) => (
                  <div key={index} className="glass-card p-6 rounded-3xl flex items-center justify-between group animate-slide-up" style={{ animationDelay: `${index * 50}ms` }}>
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center border border-white/5">
                        <span className="text-primary font-bold text-lg">{person.name[0]?.toUpperCase()}</span>
                      </div>
                      <div>
                        <span className="font-bold block">{person.name}</span>
                        <span className="text-slate-500 text-xs uppercase tracking-tighter">Identity Verified</span>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        const updated = knownPeople.filter((_, i) => i !== index);
                        setKnownPeople(updated);
                        localStorage.setItem("knownPeople", JSON.stringify(updated));
                      }}
                      className="w-10 h-10 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-400 transition-all"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))}
                {knownPeople.length === 0 && !isEnrolling && (
                  <div className="md:col-span-2 flex flex-col items-center justify-center py-24 text-center glass-card rounded-[3rem]">
                    <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mb-6">
                      <svg className="w-10 h-10 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-bold mb-2">Database Empty</h3>
                    <p className="text-slate-500 max-w-sm">No one is currently enrolled. Start by uploading a photo or dumping a collection.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      {/* Camera and Detection Overlay */}
      <ObjectDetector
        onDetections={handleDetections}
        onApproaching={handleApproaching}
        onQueryResponse={handleQueryResponse}
        queryTrigger={queryTrigger}
        staticImage={mode === "photo" ? staticImage : null}
        knownPeople={knownPeople}
      />

      {/* Top Status Bar */}
      <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/80 to-transparent p-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => {
              setMode("landing");
              setStaticImage(null);
              setDetections([]);
            }}
            className="flex items-center gap-2 text-white/80 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span>Back</span>
          </button>
          <div className="flex items-center gap-2">
            {mode === "camera" && (
              <div className={`w-3 h-3 rounded-full ${isListening ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
            )}
            <span className="text-white text-sm font-medium">
              {mode === "camera" ? (isListening ? "Listening" : "Voice Off") : "Photo Mode"}
            </span>
          </div>
          <div className="text-white/80 text-sm font-medium">
            {(() => {
              if (detections.length === 0) return "No objects detected";

              // Prioritize known people
              const knownz = detections.filter(d => d.name);
              const unknownz = detections.filter(d => !d.name);

              // Find closest
              const closest = detections.find(d => d.proximity === 'close');

              if (knownz.length > 0) {
                const names = knownz.map(d => d.name).join(", ");
                const others = unknownz.length > 0 ? `, +${unknownz.length} others` : "";
                return `${names}${closest && knownz.includes(closest) ? " (close)" : ""}${others}`;
              }

              const closeCount = detections.filter(d => d.proximity === 'close').length;
              return `${detections.length} objects${closeCount > 0 ? ` (${closeCount} close)` : ""}`;
            })()}
          </div>
        </div>
      </div>

      {/* Center Crosshair */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
        <div className="w-20 h-20 border-2 border-white/50 rounded-full flex items-center justify-center">
          <div className="w-2 h-2 bg-white rounded-full" />
        </div>
      </div>

      {/* Bottom Control Panel */}
      <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black/90 to-transparent p-6">
        {/* Status Display */}
        <div className="mb-4 text-center">
          <p className="text-white text-lg font-medium">{status}</p>
          {mode === "camera" && transcript && (
            <p className="text-white/60 text-sm mt-1">Heard: "{transcript}"</p>
          )}
          {error && <p className="text-red-400 text-sm mt-1">{error}</p>}
        </div>

        {/* Control Buttons */}
        <div className="flex justify-center gap-4">
          {mode === "camera" && (
            <button
              onClick={toggleListening}
              className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 ${isListening
                ? "bg-green-500 scale-110 shadow-lg shadow-green-500/50"
                : "bg-white/20 hover:bg-white/30"
                }`}
            >
              <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z" />
              </svg>
            </button>
          )}

          <button
            onClick={() => setQueryTrigger((prev) => prev + 1)}
            className="w-16 h-16 rounded-full bg-blue-500 hover:bg-blue-600 flex items-center justify-center transition-all"
          >
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>

          {mode === "photo" && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-600 flex items-center justify-center transition-all"
            >
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </button>
          )}
        </div>

        <p className="text-white/50 text-xs text-center mt-4">
          {mode === "camera"
            ? 'Say "What is that?" or tap the search button to identify objects'
            : 'Tap the search button to identify objects in this photo'}
        </p>
      </div>
    </div>
  );
}
