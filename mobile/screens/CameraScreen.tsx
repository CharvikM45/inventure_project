import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    StyleSheet,
    View,
    Text,
    TouchableOpacity,
    Dimensions,
    ActivityIndicator,
    PixelRatio,
} from 'react-native';
import {
    Camera,
    useCameraDevice,
    useCameraPermission,
    useFrameProcessor,
    runAtTargetFps
} from 'react-native-vision-camera';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import { Worklets } from 'react-native-worklets-core';
import { useVoiceAssistant } from '../hooks/useVoiceAssistant';
import { loadModel, DetectionResult, CLASS_NAMES } from '../services/ObjectDetectionService';
import DetectionOverlay from '../components/DetectionOverlay';
import { useSharedValue } from 'react-native-reanimated';
import { TensorflowModel } from 'react-native-fast-tflite';

const { width, height } = Dimensions.get('window');



interface CameraScreenProps {
    staticImageUri?: string | null;
    onBack: () => void;
    knownPeople?: any[];
}

export default function CameraScreen({ staticImageUri, onBack, knownPeople = [] }: CameraScreenProps) {
    const { hasPermission, requestPermission } = useCameraPermission();
    const device = useCameraDevice('back');
    const [status, setStatus] = useState('Initializing YOLO...');
    const [model, setModel] = useState<TensorflowModel | null>(null);
    const [detections, setDetections] = useState<any[]>([]);

    // Resize plugin
    const { resize } = useResizePlugin();

    // Load Model
    useEffect(() => {
        const init = async () => {
            const loadedModel = await loadModel();
            if (loadedModel) {
                setModel(loadedModel);
                setStatus('Point camera at objects');
            } else {
                setStatus('Failed to load YOLO model');
            }
        };
        init();
    }, []);

    const updateDetectionsJS = Worklets.createRunOnJS((results: any[]) => {
        setDetections(results);
    });

    const frameProcessor = useFrameProcessor((frame) => {
        'worklet';
        if (model == null) return;

        runAtTargetFps(10, () => {
            'worklet';

            // 1. Resize
            const resized = resize(frame, {
                scale: {
                    width: 640,
                    height: 640,
                },
                pixelFormat: 'rgb',
                dataType: 'float32',
            });

            // 2. Run Inference
            const outputs = model.runSync([resized]);
            const data = outputs[0]; // Float32Array or Uint8Array

            // Check output shape to determine parsing logic
            // We can't easily check shape property on TypedArray, but we know model metadata
            // For now, let's infer from data length or assume standard if not met.

            // YOLO26n NMS-Free: [1, 300, 6] -> 1800 elements
            // YOLOv8: [1, 84, 8400] -> 705600 elements

            const numElements = data.length;
            const results = [];

            if (numElements < 5000) {
                // Assume YOLO26n/End-to-End [1, 300, 6] format
                // Layout: [batch, n_dets, 6] (x, y, w, h, score, class)
                const numDets = numElements / 6;

                for (let i = 0; i < numDets; i++) {
                    const offset = i * 6;
                    const score = Number(data[offset + 4]);

                    if (score > 0.45) {
                        const x = Number(data[offset + 0]);
                        const y = Number(data[offset + 1]);
                        const w = Number(data[offset + 2]);
                        const h = Number(data[offset + 3]);
                        const clsParams = Number(data[offset + 5]);

                        results.push({
                            class: CLASS_NAMES[Math.round(clsParams)] || 'unknown',
                            score: score,
                            x: x - w / 2, // Convert cx,cy to top-left
                            y: y - h / 2,
                            width: w,
                            height: h,
                            proximity: (w * h) > (640 * 640 * 0.15) ? 'close' : 'far'
                        });
                    }
                }
            } else {
                // Assume YOLOv8 [1, 84, 8400] format
                const numAnchors = 8400;
                const numClass = 80;

                // Stride: 1 (batch) * 84 * 8400
                // data layout: [0..83] rows, [0..8399] cols flattened
                // idx = row * 8400 + col

                for (let i = 0; i < numAnchors; i++) {
                    // Find max score
                    let maxScore = 0;
                    let maxClass = -1;

                    // Loop all 80 classes
                    for (let c = 0; c < numClass; c++) {
                        const score = Number(data[(4 + c) * numAnchors + i]);
                        if (score > maxScore) {
                            maxScore = score;
                            maxClass = c;
                        }
                    }

                    if (maxScore > 0.5) {
                        const cx = Number(data[0 * numAnchors + i]);
                        const cy = Number(data[1 * numAnchors + i]);
                        const w = Number(data[2 * numAnchors + i]);
                        const h = Number(data[3 * numAnchors + i]);

                        const x = cx - w / 2;
                        const y = cy - h / 2;

                        results.push({
                            class: CLASS_NAMES[maxClass] || 'unknown',
                            score: maxScore,
                            x: x,
                            y: y,
                            width: w,
                            height: h,
                            proximity: (w * h) > (640 * 640 * 0.15) ? 'close' : 'far'
                        });
                    }
                }
            }

            // Sort and limit results
            if (results.length > 0) {
                results.sort((a, b) => b.score - a.score);
                const topResults = results.slice(0, 20);
                updateDetectionsJS(topResults);
            } else {
                updateDetectionsJS([]);
            }
        });
    }, [model]);

    // Permissions
    useEffect(() => {
        if (!hasPermission) requestPermission();
    }, [hasPermission, requestPermission]);

    // Voice setup
    const handleCommandRef = useRef<(command: string) => void>(() => { });
    const { isListening, startListening, stopListening, transcript } = useVoiceAssistant(handleCommandRef.current);

    const toggleListening = async () => {
        if (isListening) {
            await stopListening();
        } else {
            await startListening();
        }
    };

    if (!device) return <View style={styles.container}><ActivityIndicator size="large" color="#fff" /></View>;
    if (!hasPermission) return <View style={styles.container}><Text style={styles.text}>No Camera Permission</Text></View>;

    return (
        <View style={styles.container}>
            <Camera
                style={StyleSheet.absoluteFill}
                device={device}
                isActive={true}
                frameProcessor={frameProcessor}
                pixelFormat="yuv"
            />

            <View style={styles.overlay}>
                {detections.length > 0 && <DetectionOverlay detections={detections} frameWidth={640} frameHeight={640} />}
            </View>

            <View style={styles.uiContainer}>
                <Text style={styles.statusText}>{status}</Text>
                <Text style={styles.subText}>{detections.length} objects detected</Text>
                {transcript ? <Text style={styles.transcript}>{transcript}</Text> : null}
            </View>

            <TouchableOpacity onPress={onBack} style={styles.backButton}>
                <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: 'black' },
    text: { color: 'white', fontSize: 20 },
    overlay: { ...StyleSheet.absoluteFillObject },
    uiContainer: {
        position: 'absolute',
        bottom: 40,
        left: 0,
        right: 0,
        alignItems: 'center',
        padding: 20,
    },
    statusText: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
        textShadowColor: 'rgba(0,0,0,0.7)',
        textShadowRadius: 4,
    },
    subText: {
        color: '#ccc',
        fontSize: 14,
        marginTop: 4,
    },
    transcript: {
        color: '#88fa88',
        marginTop: 10,
    },
    backButton: {
        position: 'absolute',
        top: 60,
        left: 20,
        backgroundColor: 'rgba(0,0,0,0.5)',
        padding: 10,
        borderRadius: 20,
    },
    backText: { color: 'white' },
});
