import { useEffect, useState, useCallback, useRef } from 'react';
import Voice, { SpeechResultsEvent, SpeechErrorEvent } from '@react-native-voice/voice';
import * as Speech from 'expo-speech';

interface VoiceAssistantReturn {
    isListening: boolean;
    transcript: string;
    speak: (text: string) => void;
    startListening: () => Promise<void>;
    stopListening: () => Promise<void>;
    error: string | null;
}

export function useVoiceAssistant(
    onCommand: (command: string) => void
): VoiceAssistantReturn {
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [error, setError] = useState<string | null>(null);
    const onCommandRef = useRef(onCommand);

    useEffect(() => {
        onCommandRef.current = onCommand;
    }, [onCommand]);

    useEffect(() => {
        const onSpeechResults = (e: SpeechResultsEvent) => {
            if (e.value && e.value.length > 0) {
                const text = e.value[0].toLowerCase().trim();
                setTranscript(text);

                // Check for commands
                if (
                    text.includes('what is that') ||
                    text.includes("what's that") ||
                    text.includes('identify')
                ) {
                    onCommandRef.current('identify');
                } else if (text.includes('stop') || text.includes('quiet')) {
                    onCommandRef.current('stop');
                } else if (text.includes('help')) {
                    onCommandRef.current('help');
                }
            }
        };

        const onSpeechError = (e: SpeechErrorEvent) => {
            if (e.error?.code !== '7') { // Ignore no match errors
                setError(e.error?.message || 'Speech recognition error');
            }
        };

        const onSpeechEnd = () => {
            setIsListening(false);
        };

        Voice.onSpeechResults = onSpeechResults;
        Voice.onSpeechError = onSpeechError;
        Voice.onSpeechEnd = onSpeechEnd;

        return () => {
            Voice.destroy().then(Voice.removeAllListeners);
        };
    }, []);

    const speak = useCallback((text: string) => {
        Speech.stop();
        Speech.speak(text, {
            language: 'en-US',
            rate: 1.0,
            pitch: 1.0,
        });
    }, []);

    const startListening = useCallback(async () => {
        try {
            setError(null);
            await Voice.start('en-US');
            setIsListening(true);
        } catch (e) {
            setError('Failed to start voice recognition');
            console.error(e);
        }
    }, []);

    const stopListening = useCallback(async () => {
        try {
            await Voice.stop();
            setIsListening(false);
        } catch (e) {
            console.error(e);
        }
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
