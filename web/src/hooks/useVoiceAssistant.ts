"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// Web Speech API type declarations
interface SpeechRecognitionEvent extends Event {
    results: SpeechRecognitionResultList;
    resultIndex: number;
}

interface SpeechRecognitionResultList {
    length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
    isFinal: boolean;
    length: number;
    item(index: number): SpeechRecognitionAlternative;
    [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
    transcript: string;
    confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
    error: string;
    message?: string;
}

interface ISpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
    onend: (() => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
}

interface ISpeechRecognitionConstructor {
    new(): ISpeechRecognition;
}

declare global {
    interface Window {
        SpeechRecognition?: ISpeechRecognitionConstructor;
        webkitSpeechRecognition?: ISpeechRecognitionConstructor;
    }
}

interface VoiceAssistantReturn {
    isListening: boolean;
    transcript: string;
    speak: (text: string) => void;
    startListening: () => void;
    stopListening: () => void;
    error: string | null;
}

export function useVoiceAssistant(
    onCommand: (command: string) => void
): VoiceAssistantReturn {
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState("");
    const [error, setError] = useState<string | null>(null);
    const recognitionRef = useRef<ISpeechRecognition | null>(null);
    const synthRef = useRef<SpeechSynthesis | null>(null);

    // Initialize speech recognition
    useEffect(() => {
        if (typeof window === "undefined") return;

        const SpeechRecognitionClass =
            window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognitionClass) {
            setError("Speech recognition not supported in this browser");
            return;
        }

        const recognition = new SpeechRecognitionClass();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";

        recognition.onresult = (event: SpeechRecognitionEvent) => {
            const last = event.results[event.results.length - 1];
            const text = last[0].transcript.toLowerCase().trim();
            setTranscript(text);

            if (last.isFinal) {
                // Check for commands
                if (
                    text.includes("what is that") ||
                    text.includes("what's that") ||
                    text.includes("identify")
                ) {
                    onCommand("identify");
                } else if (text.includes("stop") || text.includes("quiet")) {
                    onCommand("stop");
                } else if (text.includes("help")) {
                    onCommand("help");
                }
            }
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
            if (event.error !== "no-speech") {
                console.error("Speech recognition error:", event.error);
            }
        };

        recognition.onend = () => {
            // Auto-restart if still listening
            if (isListening) {
                try {
                    recognition.start();
                } catch {
                    // Ignore errors on restart
                }
            }
        };

        recognitionRef.current = recognition;
        synthRef.current = window.speechSynthesis;

        return () => {
            recognition.stop();
        };
    }, [onCommand, isListening]);

    const speak = useCallback((text: string) => {
        if (!synthRef.current) return;

        // Cancel any ongoing speech
        synthRef.current.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.1;
        utterance.pitch = 1;
        utterance.volume = 1;

        synthRef.current.speak(utterance);
    }, []);

    const startListening = useCallback(() => {
        if (!recognitionRef.current) return;

        try {
            recognitionRef.current.start();
            setIsListening(true);
        } catch {
            // Already started
        }
    }, []);

    const stopListening = useCallback(() => {
        if (!recognitionRef.current) return;

        recognitionRef.current.stop();
        setIsListening(false);
    }, []);

    return {
        isListening,
        transcript,
        speak,
        startListening,
        stopListening,
        error,
    };
}

