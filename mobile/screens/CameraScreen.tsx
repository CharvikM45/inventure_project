import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    StyleSheet,
    View,
    Text,
    TouchableOpacity,
    Dimensions,
    Image,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useVoiceAssistant } from '../hooks/useVoiceAssistant';

const { width, height } = Dimensions.get('window');

interface Detection {
    class: string;
    score: number;
    x: number;
    y: number;
    width: number;
    height: number;
    proximity?: 'close' | 'medium' | 'far';
}

interface KnownPerson {
    name: string;
    imageUri: string;
}

interface CameraScreenProps {
    staticImageUri?: string | null;
    onBack: () => void;
    knownPeople?: KnownPerson[];
}

export default function CameraScreen({ staticImageUri, onBack, knownPeople = [] }: CameraScreenProps) {
    const [permission, requestPermission] = useCameraPermissions();
    const [status, setStatus] = useState(staticImageUri ? 'Tap 🔍 to identify objects in photo' : 'Tap mic to start voice control');
    const [detections, setDetections] = useState<Detection[]>([]);
    const lastAlertRef = useRef<number>(0);
    const cameraRef = useRef<CameraView>(null);

    const handleCommand = useCallback((command: string) => {
        if (command === 'identify') {
            // Simulate "Morning to Night" daily items including Brands
            const dayItems = [
                'toothbrush', 'toothpaste', 'coffee mug',
                'Nike water bottle', 'Sony laptop', 'Apple iPhone', 'Coca-Cola can',
                'bus', 'traffic light', 'backpack',
                'laptop', 'mouse', 'keyboard',
                'bed', 'pillow', 'lamp',
                'glasses', 'plate', 'fork', 'spoon'
            ];
            const randomItem = dayItems[Math.floor(Math.random() * dayItems.length)];

            const mockDetections: Detection[] = [
                { class: randomItem, score: 0.95, x: 150, y: 300, width: 50, height: 50, proximity: 'close' },
                { class: 'person', score: 0.92, x: 100, y: 200, width: 150, height: 300, proximity: 'medium' },
            ];

            if (mockDetections.length > 0) {
                // Build natural language response
                const parts: string[] = [];
                const closeItems = mockDetections.filter(d => d.proximity === 'close').map(d => d.class);
                const otherItems = mockDetections.filter(d => d.proximity !== 'close').map(d => d.class);

                // Handle known person if present
                if (mockDetections.some(d => d.class === 'person') && knownPeople.length > 0) {
                    const person = knownPeople[0];
                    // Replace 'person' with name in lists
                    const pIdx = closeItems.indexOf('person');
                    if (pIdx > -1) closeItems[pIdx] = person.name;
                    const pIdx2 = otherItems.indexOf('person');
                    if (pIdx2 > -1) otherItems[pIdx2] = person.name;
                }

                if (closeItems.length > 0) parts.push(`${closeItems.join(', ')} nearby`);
                if (otherItems.length > 0) parts.push(otherItems.join(', '));

                const response = `I can see: ${parts.join(', ')}`;
                speak(response);
                setStatus(`Detected: ${parts.join(', ')}`);

                setDetections(mockDetections);
            } else {
                speak('I cannot identify any objects right now');
                setStatus('No objects detected');
            }
        } else if (command === 'help') {
            speak(
                "Say 'what is that' to identify objects. I will also warn you if someone is approaching."
            );
        }
    }, [knownPeople]);

    const { isListening, transcript, speak, startListening, stopListening, error } =
        useVoiceAssistant(handleCommand);

    useEffect(() => {
        if (staticImageUri) return;

        const interval = setInterval(() => {
            const approaching = Math.random() > 0.95;
            if (approaching) {
                const now = Date.now();
                if (now - lastAlertRef.current > 7000) {
                    lastAlertRef.current = now;

                    if (knownPeople.length > 0) {
                        speak(`${knownPeople[0].name} is approaching you`);
                        setStatus(`⚠️ ${knownPeople[0].name} approaching!`);
                    } else {
                        speak('Warning! Person approaching');
                        setStatus('⚠️ Person approaching!');
                    }
                }
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [speak, staticImageUri, knownPeople]);

    const toggleListening = async () => {
        if (isListening) {
            await stopListening();
            setStatus('Voice control paused');
        } else {
            await startListening();
            setStatus('Listening for commands...');
        }
    };

    if (!permission && !staticImageUri) {
        return (
            <View style={styles.container}>
                <Text style={styles.statusText}>Requesting camera permission...</Text>
            </View>
        );
    }

    if (!permission?.granted && !staticImageUri) {
        return (
            <View style={styles.container}>
                <Text style={styles.statusText}>Camera permission required</Text>
                <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
                    <Text style={styles.permissionButtonText}>Grant Permission</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.permissionButton, { marginTop: 10, backgroundColor: '#475569' }]} onPress={onBack}>
                    <Text style={styles.permissionButtonText}>Go Back</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {staticImageUri ? (
                <Image source={{ uri: staticImageUri }} style={styles.camera} resizeMode="contain" />
            ) : (
                <CameraView
                    ref={cameraRef}
                    style={styles.camera}
                    facing="back"
                />
            )}

            <View style={styles.topBar}>
                <TouchableOpacity onPress={onBack} style={styles.backButton}>
                    <Text style={styles.backIcon}>←</Text>
                    <Text style={styles.backText}>Back</Text>
                </TouchableOpacity>

                <View style={styles.statusIndicator}>
                    {!staticImageUri && (
                        <>
                            <View
                                style={[
                                    styles.dot,
                                    { backgroundColor: isListening ? '#22c55e' : '#ef4444' },
                                ]}
                            />
                            <Text style={styles.statusLabel}>
                                {isListening ? 'Listening' : 'Voice Off'}
                            </Text>
                        </>
                    )}
                </View>
                <Text style={styles.detectionCount}>
                    {detections.length > 0
                        ? `${detections.length} objects${detections.some(d => d.proximity === 'close') ? ' (1 close)' : ''}`
                        : '0 objects'}
                </Text>
            </View>

            <View style={styles.crosshairContainer}>
                <View style={styles.crosshair}>
                    <View style={styles.crosshairDot} />
                </View>
            </View>

            <View style={styles.bottomPanel}>
                <Text style={styles.statusText}>{status}</Text>
                {transcript && (
                    <Text style={styles.transcriptText}>Heard: "{transcript}"</Text>
                )}
                {error && <Text style={styles.errorText}>{error}</Text>}

                <View style={styles.buttonRow}>
                    {!staticImageUri && (
                        <TouchableOpacity
                            style={[
                                styles.micButton,
                                isListening && styles.micButtonActive,
                            ]}
                            onPress={toggleListening}
                        >
                            <Text style={styles.micIcon}>🎤</Text>
                        </TouchableOpacity>
                    )}

                    <TouchableOpacity
                        style={styles.identifyButton}
                        onPress={() => handleCommand('identify')}
                    >
                        <Text style={styles.identifyIcon}>🔍</Text>
                    </TouchableOpacity>
                </View>

                <Text style={styles.hint}>
                    {staticImageUri ? 'Tap 🔍 to identify objects in this photo' : 'Say "What is that?" or tap 🔍 to identify objects'}
                </Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
    },
    camera: {
        flex: 1,
    },
    topBar: {
        position: 'absolute',
        top: 60,
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        zIndex: 10,
    },
    backButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
    },
    backIcon: {
        color: '#fff',
        fontSize: 20,
        marginRight: 4,
    },
    backText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
    statusIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    dot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        marginRight: 8,
    },
    statusLabel: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
    detectionCount: {
        color: 'rgba(255,255,255,0.7)',
        fontSize: 14,
    },
    crosshairContainer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
    },
    crosshair: {
        width: 80,
        height: 80,
        borderRadius: 40,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    crosshairDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#fff',
    },
    bottomPanel: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: 'rgba(0,0,0,0.8)',
        paddingTop: 20,
        paddingBottom: 40,
        paddingHorizontal: 20,
        alignItems: 'center',
    },
    statusText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '600',
        textAlign: 'center',
    },
    transcriptText: {
        color: 'rgba(255,255,255,0.6)',
        fontSize: 14,
        marginTop: 4,
    },
    errorText: {
        color: '#ef4444',
        fontSize: 14,
        marginTop: 4,
    },
    buttonRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 20,
        gap: 20,
    },
    micButton: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    micButtonActive: {
        backgroundColor: '#22c55e',
        shadowColor: '#22c55e',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 20,
    },
    micIcon: {
        fontSize: 36,
    },
    identifyButton: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: '#3b82f6',
        justifyContent: 'center',
        alignItems: 'center',
    },
    identifyIcon: {
        fontSize: 28,
    },
    hint: {
        color: 'rgba(255,255,255,0.4)',
        fontSize: 12,
        marginTop: 16,
        textAlign: 'center',
    },
    permissionButton: {
        marginTop: 20,
        backgroundColor: '#3b82f6',
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 8,
    },
    permissionButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
});
