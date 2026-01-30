"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";
import Webcam from "react-webcam";
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-webgl";
import * as cocoSsd from "@tensorflow-models/coco-ssd";

const CLASS_NAMES = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light",
    "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
    "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
    "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle",
    "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange", "broccoli",
    "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant", "bed", "dining table",
    "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone", "microwave", "oven", "toaster",
    "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush"
];

// Friendly labels for everyday items (model detects these; we show clearer names)
const DISPLAY_LABELS: Record<string, string> = {
    "cell phone": "phone",
    "book": "book / paper",
    "laptop": "laptop / computer",
    "dining table": "table",
    "bottle": "bottle / water bottle",
    "cup": "cup / mug",
    "wine glass": "glass",
    "remote": "remote",
    "handbag": "bag",
    "backpack": "backpack / bag",
    "suitcase": "bag",
    "tv": "TV / monitor",
    "keyboard": "keyboard",
    "mouse": "mouse",
    "chair": "chair",
    "couch": "couch / sofa",
    "potted plant": "plant",
    "toilet": "toilet",
    "sink": "sink",
    "refrigerator": "refrigerator",
    "oven": "oven",
    "microwave": "microwave",
    "toaster": "toaster",
    "clock": "clock",
    "fork": "fork",
    "knife": "knife",
    "spoon": "spoon",
    "bowl": "bowl",
    "apple": "apple",
    "banana": "banana",
    "orange": "orange",
    "pizza": "pizza",
    "sandwich": "sandwich",
};

const DETECT_INTERVAL_MS = 120;
const CUSTOM_MODEL_PATH = "/model/custom/model.json";
const CUSTOM_CLASSES_PATH = "/model/custom/classes.json";
const YOLO_MODEL_PATH = "/model/yolo26n_web_model/model.json";
const MODEL_LOAD_TIMEOUT_MS = 12000; // If a model doesn't load in 12s, try next
const VOICE_ALERT_INTERVAL_MS = 4000;
const MIN_CONFIDENCE = 0.08; // Low so phone, bottle, etc. show up reliably
const MIN_CONFIDENCE_PHONE_BOTTLE = 0.05;
const PRIORITY_CLASSES = ["cell phone", "bottle"];
const MAX_DETECTIONS_DRAWN = 40; // After NMS: one box per item
// Only say "Caution" for objects that are close (proxy for ~6 ft) AND ahead (in path / will run into)
const VOICE_ONLY_CLOSE_AND_AHEAD = true;

type Proximity = "close" | "medium" | "far";
type Direction = "left" | "center" | "right";

export interface DetectionItem {
    label: string;
    score: number;
    x: number;
    y: number;
    w: number;
    h: number;
    proximity: Proximity;
    direction: Direction;
}

type DetectorModel = { type: "yolo"; model: tf.GraphModel } | { type: "coco"; model: cocoSsd.ObjectDetection };

// "Close" = large on screen ≈ within ~6 ft; medium = mid-range; far = distant
function getProximity(areaRatio: number): Proximity {
    if (areaRatio > 0.12) return "close";
    if (areaRatio > 0.035) return "medium";
    return "far";
}

function getDirection(centerX: number, frameWidth: number): Direction {
    const third = frameWidth / 3;
    if (centerX < third) return "left";
    if (centerX > 2 * third) return "right";
    return "center";
}

function getProximityColor(proximity: Proximity): string {
    switch (proximity) {
        case "close": return "#ef4444";
        case "medium": return "#f59e0b";
        default: return "#22c55e";
    }
}

// IoU for two boxes (x, y, w, h)
function boxIoU(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
    const interLeft = Math.max(a.x, b.x);
    const interTop = Math.max(a.y, b.y);
    const interRight = Math.min(a.x + a.w, b.x + b.w);
    const interBottom = Math.min(a.y + a.h, b.y + b.h);
    const interW = Math.max(0, interRight - interLeft);
    const interH = Math.max(0, interBottom - interTop);
    const interArea = interW * interH;
    const areaA = a.w * a.h;
    const areaB = b.w * b.h;
    const union = areaA + areaB - interArea;
    return union > 0 ? interArea / union : 0;
}

// One box per object: keep highest-score detection per overlapping group (same label).
const NMS_IOU_THRESHOLD = 0.45;

function applyNMS(items: DetectionItem[]): DetectionItem[] {
    if (items.length <= 1) return items;
    const byLabel = new Map<string, DetectionItem[]>();
    for (const d of items) {
        const list = byLabel.get(d.label) ?? [];
        list.push(d);
        byLabel.set(d.label, list);
    }
    const out: DetectionItem[] = [];
    for (const list of byLabel.values()) {
        list.sort((a, b) => b.score - a.score);
        const keep: DetectionItem[] = [];
        for (const d of list) {
            let suppressed = false;
            for (const k of keep) {
                if (boxIoU(d, k) > NMS_IOU_THRESHOLD) {
                    suppressed = true;
                    break;
                }
            }
            if (!suppressed) keep.push(d);
        }
        out.push(...keep);
    }
    return out.sort((a, b) => b.score - a.score);
}

// Only announce items that are close (≈ within 6 ft) and ahead (in path — will run into them).
function buildVoiceAlert(detections: DetectionItem[], maxItems = 4): string {
    const candidates = VOICE_ONLY_CLOSE_AND_AHEAD
        ? detections.filter(d => d.proximity === "close" && d.direction === "center")
        : detections.filter(d => d.proximity === "close" || d.proximity === "medium");
    const toAnnounce = candidates.slice(0, maxItems);
    if (toAnnounce.length === 0) return "";

    const parts = toAnnounce.map(d => `${d.label} ahead`);
    return `Caution. ${parts.join(". ")}.`;
}

export default function ObjectDetector() {
    const webcamRef = useRef<Webcam>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [detector, setDetector] = useState<DetectorModel | null>(null);
    const [classNames, setClassNames] = useState<string[]>(CLASS_NAMES);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const lastDetectTimeRef = useRef<number>(0);
    const lastVoiceTimeRef = useRef<number>(0);
    const rafIdRef = useRef<number>(0);
    const detectionsRef = useRef<DetectionItem[]>([]);

    useEffect(() => {
        let cancelled = false;
        const withTimeout = <T,>(p: Promise<T>, ms: number) =>
            Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

        const loadModel = async () => {
            try {
                setLoading(true);
                setLoadError(null);
                await tf.setBackend("webgl");
                await tf.ready();

                const tryLoadGraphModel = async (path: string): Promise<tf.GraphModel> => {
                    const model = await tf.loadGraphModel(path);
                    const warmup = tf.zeros([1, 640, 640, 3]);
                    const out = await model.executeAsync(warmup);
                    tf.dispose(warmup);
                    const toDispose = Array.isArray(out) ? out : [out];
                    toDispose.forEach((t: tf.Tensor) => t.dispose());
                    return model;
                };

                // 1) COCO-SSD first so detection works immediately (no YOLO dependency)
                const cocoModel = await cocoSsd.load({ base: "mobilenet_v2" });
                if (cancelled) return;
                setClassNames(CLASS_NAMES);
                setDetector({ type: "coco", model: cocoModel });
                setLoadError(null);

                // 2) Try YOLO in background; switch to it if it loads (optional upgrade)
                withTimeout(tryLoadGraphModel(YOLO_MODEL_PATH), MODEL_LOAD_TIMEOUT_MS)
                    .then((yoloModel) => {
                        if (cancelled) {
                            yoloModel.dispose();
                            return;
                        }
                        setDetector({ type: "yolo", model: yoloModel });
                        setLoadError(null);
                    })
                    .catch(() => { /* keep using COCO-SSD */ });
            } catch (err) {
                if (!cancelled) {
                    console.error("Failed to load model", err);
                    setLoadError(err instanceof Error ? err.message : "Failed to load model");
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        loadModel();
        return () => {
            cancelled = true;
            cancelAnimationFrame(rafIdRef.current);
        };
    }, []);

    const parseYoloToDetections = useCallback((prediction: number[][], canvasW: number, canvasH: number, names: string[]): DetectionItem[] => {
        const scaleX = canvasW / 640;
        const scaleY = canvasH / 640;
        const frameArea = canvasW * canvasH;
        const items: DetectionItem[] = [];
        const numClasses = names.length;

        if (prediction.length === 300 && prediction[0]?.length === 6) {
            prediction.forEach(det => {
                const score = det[4];
                const cls = Math.round(det[5]);
                const minConf = PRIORITY_CLASSES.includes(names[cls] ?? "") ? MIN_CONFIDENCE_PHONE_BOTTLE : MIN_CONFIDENCE;
                if (score < minConf) return;
                const cx = det[0], cy = det[1], w = det[2], h = det[3];
                const x = (cx - w / 2) * scaleX;
                const y = (cy - h / 2) * scaleY;
                const wSc = w * scaleX;
                const hSc = h * scaleY;
                const areaRatio = (wSc * hSc) / frameArea;
                items.push({
                    label: DISPLAY_LABELS[names[cls]] ?? names[cls] ?? String(cls),
                    score,
                    x, y, w: wSc, h: hSc,
                    proximity: getProximity(areaRatio),
                    direction: getDirection(x + wSc / 2, canvasW),
                });
            });
            return items;
        }

        const numAnchors = prediction[0]?.length ?? 0;
        if (numAnchors === 8400) {
            for (let i = 0; i < numAnchors; i++) {
                let maxScore = 0;
                let maxClass = -1;
                for (let c = 0; c < numClasses; c++) {
                    const s = prediction[4 + c]?.[i] ?? 0;
                    if (s > maxScore) {
                        maxScore = s;
                        maxClass = c;
                    }
                }
                const minConf = PRIORITY_CLASSES.includes(names[maxClass] ?? "") ? MIN_CONFIDENCE_PHONE_BOTTLE : MIN_CONFIDENCE;
                if (maxScore < minConf) continue;
                const cx = prediction[0][i], cy = prediction[1][i], w = prediction[2][i], h = prediction[3][i];
                const x = (cx - w / 2) * scaleX;
                const y = (cy - h / 2) * scaleY;
                const wSc = w * scaleX;
                const hSc = h * scaleY;
                const areaRatio = (wSc * hSc) / frameArea;
                items.push({
                    label: DISPLAY_LABELS[names[maxClass]] ?? names[maxClass] ?? String(maxClass),
                    score: maxScore,
                    x, y, w: wSc, h: hSc,
                    proximity: getProximity(areaRatio),
                    direction: getDirection(x + wSc / 2, canvasW),
                });
            }
        }
        return items;
    }, []);

    const parseCocoToDetections = useCallback((predictions: cocoSsd.DetectedObject[], canvasW: number, canvasH: number): DetectionItem[] => {
        const frameArea = canvasW * canvasH;
        return predictions
            .filter(p => p.score >= (PRIORITY_CLASSES.includes(p.class) ? MIN_CONFIDENCE_PHONE_BOTTLE : MIN_CONFIDENCE))
            .map(p => {
                const [x, y, w, h] = p.bbox;
                const areaRatio = (w * h) / frameArea;
                return {
                    label: DISPLAY_LABELS[p.class] ?? p.class,
                    score: p.score,
                    x, y, w, h,
                    proximity: getProximity(areaRatio),
                    direction: getDirection(x + w / 2, canvasW),
                };
            });
    }, []);

    const drawDetections = useCallback((items: DetectionItem[], canvas: HTMLCanvasElement) => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const toDraw = items.slice(0, MAX_DETECTIONS_DRAWN);
        toDraw.forEach(d => {
            const color = getProximityColor(d.proximity);
            // Box: thick stroke so detection boxes are clearly visible
            ctx.strokeStyle = color;
            ctx.lineWidth = 4;
            ctx.strokeRect(d.x, d.y, d.w, d.h);
            // Label: class, confidence, and proximity on each box
            const text = `${d.label} ${(d.score * 100).toFixed(0)}% · ${d.proximity}`;
            ctx.font = "bold 14px system-ui, sans-serif";
            const metrics = ctx.measureText(text);
            const pad = 6;
            const tx = d.x;
            const ty = d.y > 24 ? d.y - 8 : d.y + d.h + 4;
            ctx.fillStyle = "rgba(0,0,0,0.8)";
            ctx.fillRect(tx, ty - 16 - pad, metrics.width + pad * 2, 20 + pad);
            ctx.fillStyle = color;
            ctx.fillText(text, tx + pad, ty - pad);
        });
    }, []);

    const speakAlert = useCallback((text: string) => {
        if (!text || typeof window === "undefined") return;
        const u = window.speechSynthesis;
        if (!u) return;
        u.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.95;
        utterance.pitch = 1;
        utterance.lang = "en-US";
        u.speak(utterance);
    }, []);

    const detect = useCallback(async () => {
        rafIdRef.current = requestAnimationFrame(detect);

        if (!detector || !webcamRef.current?.video || !canvasRef.current) return;

        const video = webcamRef.current.video;
        if (video.readyState !== 4) return;

        const now = performance.now();
        if (now - lastDetectTimeRef.current < DETECT_INTERVAL_MS) return;
        lastDetectTimeRef.current = now;

        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const cw = canvas.width;
        const ch = canvas.height;
        if (cw < 10 || ch < 10) return;

        if (detector.type === "coco") {
            try {
                const predictions = await detector.model.detect(video);
                const raw = parseCocoToDetections(predictions, cw, ch);
                const items = applyNMS(raw);
                detectionsRef.current = items;
                drawDetections(items, canvas);
                if (now - lastVoiceTimeRef.current >= VOICE_ALERT_INTERVAL_MS) {
                    lastVoiceTimeRef.current = now;
                    const msg = buildVoiceAlert(items);
                    if (msg) speakAlert(msg);
                }
            } catch (e) {
                console.error("COCO detect error:", e);
            }
            return;
        }

        const tfImg = tf.browser.fromPixels(video);
        const resized = tf.image.resizeBilinear(tfImg, [640, 640]);
        const casted = resized.cast("float32");
        const expanded = casted.expandDims(0);
        const normalized = expanded.div(255.0);

        try {
            const result = await detector.model.executeAsync(normalized);
            const allTensors: tf.Tensor[] = Array.isArray(result) ? result : (result && typeof result === "object" && (result as tf.Tensor).shape == null ? Object.values(result as Record<string, tf.Tensor>) : [result as tf.Tensor]);
            const outputs = allTensors.filter((t) => t != null && t.shape != null);
            // YOLO26n has two outputs (TopK, Identity); find the one with detection shape [1,300,6] or [1,84,8400] or [1,6,300]
            let prediction: number[][] | null = null;
            for (const ten of outputs) {
                const data = (await ten.array()) as number[][][] | number[][];
                let batch: number[][] | null = null;
                if (Array.isArray(data) && data.length > 0) {
                    const first = data[0];
                    if (Array.isArray(first) && typeof first[0] === "number" && data.length === 300 && first.length === 6) {
                        batch = data as number[][]; // shape [300, 6]
                    } else if (Array.isArray(first) && Array.isArray(first[0])) {
                        batch = first as number[][]; // shape [1, 300, 6] -> data[0]
                    }
                }
                if (!batch) continue;
                const rows = batch.length;
                const cols = batch[0]?.length ?? 0;
                if (rows === 300 && cols === 6) {
                    prediction = batch;
                    break;
                }
                if (rows === 6 && cols === 300) {
                    prediction = [];
                    for (let i = 0; i < 300; i++)
                        prediction.push([batch[0][i], batch[1][i], batch[2][i], batch[3][i], batch[4][i], batch[5][i]]);
                    break;
                }
                if (rows === 84 && cols === 8400) {
                    prediction = batch;
                    break;
                }
            }
            tf.dispose([tfImg, resized, casted, expanded, normalized, ...allTensors]);

            const raw = prediction ? parseYoloToDetections(prediction, cw, ch, classNames) : [];
            const items = applyNMS(raw);
            detectionsRef.current = items;
            drawDetections(items, canvas);

            if (now - lastVoiceTimeRef.current >= VOICE_ALERT_INTERVAL_MS) {
                lastVoiceTimeRef.current = now;
                const msg = buildVoiceAlert(items);
                if (msg) speakAlert(msg);
            }
        } catch (e) {
            tf.dispose([tfImg, resized, casted, expanded, normalized]);
            console.error("YOLO inference error:", e);
        }
    }, [detector, classNames, parseYoloToDetections, parseCocoToDetections, drawDetections, speakAlert]);

    useEffect(() => {
        if (detector && !loading) detect();
        return () => cancelAnimationFrame(rafIdRef.current);
    }, [detector, loading, detect]);

    return (
        <div className="relative w-full max-w-2xl mx-auto overflow-hidden rounded-lg shadow-lg bg-black">
            {loading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center z-50 bg-black/60 text-white gap-2">
                    <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Loading detection model...</span>
                </div>
            )}
            {loadError && !loading && (
                <div className="absolute top-2 left-2 right-2 z-40 px-2 py-1.5 rounded bg-amber-900/80 text-amber-200 text-xs">
                    {loadError}
                </div>
            )}
            <Webcam
                ref={webcamRef}
                className="w-full h-auto"
                screenshotFormat="image/jpeg"
                videoConstraints={{ facingMode: "environment" }}
            />
            <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 w-full h-full pointer-events-none"
            />
        </div>
    );
}
