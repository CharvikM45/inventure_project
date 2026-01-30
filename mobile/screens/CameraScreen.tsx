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
import { loadModel, CLASS_NAMES, DISPLAY_LABELS } from '../services/ObjectDetectionService';
import DetectionOverlay from '../components/DetectionOverlay';
import { useSharedValue } from 'react-native-reanimated';
import { TensorflowModel } from 'react-native-fast-tflite';

const { width, height } = Dimensions.get('window');

const FRAME_SIZE = 640;
const VOICE_ALERT_INTERVAL_MS = 4000;
const MIN_CONFIDENCE = 0.08; // Low so phone, bottle, etc. show up
const MIN_CONFIDENCE_PHONE_BOTTLE = 0.05;
const MAX_DETECTIONS = 40;   // After NMS: one box per item
const NMS_IOU_THRESHOLD = 0.45;
// Only say "Caution" when close (~6 ft proxy) AND ahead (in path — will run into)
const VOICE_ONLY_CLOSE_AND_AHEAD = true;

function getProximity(areaRatio: number): 'close' | 'medium' | 'far' {
    if (areaRatio > 0.12) return 'close';
    if (areaRatio > 0.035) return 'medium';
    return 'far';
}

function getDirection(centerX: number, frameW: number): 'left' | 'center' | 'right' {
    const third = frameW / 3;
    if (centerX < third) return 'left';
    if (centerX > 2 * third) return 'right';
    return 'center';
}

function buildVoiceAlert(detections: { class: string; proximity: string; direction: string }[], maxItems = 4): string {
    const candidates = VOICE_ONLY_CLOSE_AND_AHEAD
        ? detections.filter(d => d.proximity === 'close' && d.direction === 'center')
        : detections.filter(d => d.proximity === 'close' || d.proximity === 'medium');
    const toAnnounce = candidates.slice(0, maxItems);
    if (toAnnounce.length === 0) return '';
    const parts = toAnnounce.map(d => `${d.class} ahead`);
    return `Caution. ${parts.join('. ')}.`;
}

interface CameraScreenProps {
    staticImageUri?: string | null;
    onBack: () => void;
    knownPeople?: any[];
}

export default function CameraScreen({ staticImageUri, onBack, knownPeople = [] }: CameraScreenProps) {
    const { hasPermission, requestPermission } = useCameraPermission();
    const device = useCameraDevice('back');
    const [status, setStatus] = useState('Loading detection model...');
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
                setStatus('Detection unavailable');
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
                    const clsParams = Number(data[offset + 5]);
                    const rawClass = CLASS_NAMES[Math.round(clsParams)] || 'unknown';
                    const isPhoneOrBottle = rawClass === 'cell phone' || rawClass === 'bottle';
                    const minConf = isPhoneOrBottle ? MIN_CONFIDENCE_PHONE_BOTTLE : MIN_CONFIDENCE;

                    if (score > minConf) {
                        const cx = Number(data[offset + 0]);
                        const cy = Number(data[offset + 1]);
                        const w = Number(data[offset + 2]);
                        const h = Number(data[offset + 3]);
                        const x = cx - w / 2;
                        const y = cy - h / 2;
                        const areaRatio = (w * h) / (FRAME_SIZE * FRAME_SIZE);
                        const centerX = x + w / 2;
                        results.push({
                            class: DISPLAY_LABELS[rawClass] ?? rawClass,
                            score: score,
                            x, y,
                            width: w,
                            height: h,
                            proximity: getProximity(areaRatio),
                            direction: getDirection(centerX, FRAME_SIZE),
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

                    const rawClass = CLASS_NAMES[maxClass] || 'unknown';
                    const isPhoneOrBottle = rawClass === 'cell phone' || rawClass === 'bottle';
                    const minConf = isPhoneOrBottle ? MIN_CONFIDENCE_PHONE_BOTTLE : MIN_CONFIDENCE;

                    if (maxScore > minConf) {
                        const cx = Number(data[0 * numAnchors + i]);
                        const cy = Number(data[1 * numAnchors + i]);
                        const w = Number(data[2 * numAnchors + i]);
                        const h = Number(data[3 * numAnchors + i]);
                        const x = cx - w / 2;
                        const y = cy - h / 2;
                        const areaRatio = (w * h) / (FRAME_SIZE * FRAME_SIZE);
                        results.push({
                            class: DISPLAY_LABELS[rawClass] ?? rawClass,
                            score: maxScore,
                            x, y,
                            width: w,
                            height: h,
                            proximity: getProximity(areaRatio),
                            direction: getDirection(cx, FRAME_SIZE),
                        });
                    }
                }
            }

            // Class-aware NMS: one box per object, no duplicates
            const applyNMS = (items: typeof results) => {
                if (items.length <= 1) return items;
                const boxIoU = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => {
                    const interLeft = Math.max(a.x, b.x);
                    const interTop = Math.max(a.y, b.y);
                    const interRight = Math.min(a.x + a.width, b.x + b.width);
                    const interBottom = Math.min(a.y + a.height, b.y + b.height);
                    const interW = Math.max(0, interRight - interLeft);
                    const interH = Math.max(0, interBottom - interTop);
                    const interArea = interW * interH;
                    const union = a.width * a.height + b.width * b.height - interArea;
                    return union > 0 ? interArea / union : 0;
                };
                items.sort((a, b) => (a.class === b.class ? b.score - a.score : (a.class < b.class ? -1 : 1)));
                const kept: typeof results = [];
                for (let i = 0; i < items.length; i++) {
                    const d = items[i];
                    let suppressed = false;
                    for (let k = 0; k < kept.length; k++) {
                        if (kept[k].class === d.class && boxIoU(d, kept[k]) > NMS_IOU_THRESHOLD) {
                            suppressed = true;
                            break;
                        }
                    }
                    if (!suppressed) kept.push(d);
                }
                return kept.sort((a, b) => b.score - a.score);
            };

            const nmsResults = applyNMS(results);
            if (nmsResults.length > 0) {
                updateDetectionsJS(nmsResults.slice(0, MAX_DETECTIONS));
            } else {
                updateDetectionsJS([]);
            }
        });
    }, [model]);

    // Permissions
    useEffect(() => {
        if (!hasPermission) requestPermission();
    }, [hasPermission, requestPermission]);

    const handleCommandRef = useRef<(command: string) => void>(() => {});
    const { speak, transcript } = useVoiceAssistant(handleCommandRef.current);
    const lastVoiceTimeRef = useRef<number>(0);

    const detectionsRef = useRef<any[]>([]);
    detectionsRef.current = detections;

    useEffect(() => {
        const id = setInterval(() => {
            const list = detectionsRef.current;
            if (list.length === 0) return;
            const msg = buildVoiceAlert(list);
            if (msg) speak(msg);
        }, VOICE_ALERT_INTERVAL_MS);
        return () => clearInterval(id);
    }, [speak]);

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
