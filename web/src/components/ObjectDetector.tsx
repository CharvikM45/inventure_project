"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import Webcam from "react-webcam";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import * as mobilenet from "@tensorflow-models/mobilenet";
import * as faceapi from '@vladmandic/face-api';
import Tesseract from 'tesseract.js';
import "@tensorflow/tfjs";
import { loadModels as loadFaceModels, matchFace } from "@/hooks/useFaceRecognition";

interface Detection {
    bbox: [number, number, number, number];
    class: string;
    score: number;
    proximity?: 'close' | 'medium' | 'far';
    name?: string; // For identified faces
}

// Estimate proximity based on bounding box size relative to frame
function estimateProximity(
    bbox: [number, number, number, number],
    frameWidth: number,
    frameHeight: number
): 'close' | 'medium' | 'far' {
    const [, , w, h] = bbox;
    const bboxArea = w * h;
    const frameArea = frameWidth * frameHeight;
    const ratio = bboxArea / frameArea;

    if (ratio > 0.12) return 'close';   // > 12% of frame
    if (ratio > 0.025) return 'medium'; // 2.5-12% of frame
    return 'far';                        // < 2.5% of frame
}

function getProximityLabel(proximity: 'close' | 'medium' | 'far'): string {
    switch (proximity) {
        case 'close': return 'nearby';
        case 'medium': return '';
        case 'far': return 'far away';
    }
}

function getProximityColor(proximity: 'close' | 'medium' | 'far'): string {
    switch (proximity) {
        case 'close': return '#ef4444';  // Red for close
        case 'medium': return '#f59e0b'; // Amber for medium
        case 'far': return '#22c55e';    // Green for far
    }
}

interface TrackedObject {
    id: string;
    class: string;
    bbox: [number, number, number, number];
    lastSeen: number;
    prevArea: number;
    approaching: boolean;
}

interface KnownPerson {
    name: string;
    descriptor: number[];
}

interface ObjectDetectorProps {
    onDetections: (detections: Detection[]) => void;
    onApproaching: (object: TrackedObject) => void;
    onQueryResponse: (response: string) => void;
    queryTrigger: number;
    staticImage?: string | null;
    knownPeople?: KnownPerson[];
}

export default function ObjectDetector({
    onDetections,
    onApproaching,
    onQueryResponse,
    queryTrigger,
    staticImage,
    knownPeople = [],
}: ObjectDetectorProps) {
    const webcamRef = useRef<Webcam>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const modelRef = useRef<cocoSsd.ObjectDetection | null>(null);
    const mobilenetRef = useRef<mobilenet.MobileNet | null>(null);
    const trackedObjectsRef = useRef<Map<string, TrackedObject>>(new Map());
    const identifiedPeopleRef = useRef<Map<string, number>>(new Map()); // name -> lastSeen

    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const lastDetectionsRef = useRef<Detection[]>([]);

    // Load models
    useEffect(() => {
        const load = async () => {
            try {
                const [model, net] = await Promise.all([
                    cocoSsd.load({ base: "lite_mobilenet_v2" }),
                    mobilenet.load(),
                    loadFaceModels(),
                ]);
                modelRef.current = model;
                mobilenetRef.current = net;
                setIsLoading(false);
            } catch (err) {
                setError("Failed to load AI models");
                console.error(err);
            }
        };
        load();
    }, []);

    // Handle "What is that?" query
    useEffect(() => {
        const handleQuery = async () => {
            if (queryTrigger > 0) {
                let element: HTMLVideoElement | HTMLImageElement | null = null;
                if (staticImage && imgRef.current) element = imgRef.current;
                else if (webcamRef.current?.video && webcamRef.current.video.readyState === 4) element = webcamRef.current.video;

                if (!element) {
                    onQueryResponse("I cannot see clearly right now");
                    return;
                }

                // 1. Get OCR for brand/label recognition
                let recognizedText = "";
                try {
                    const { data: { text } } = await Tesseract.recognize(element, 'eng');
                    // Filter for meaningful words (brands usually stand out)
                    const words = text.split(/\s+/).filter(w => w.length > 2 && !/^(the|and|for|with)$/i.test(w));
                    if (words.length > 0) {
                        recognizedText = words.slice(0, 3).join(' '); // Take top 3 words
                    }
                } catch (err) {
                    console.error("OCR failed", err);
                }

                // 2. Get MobileNet classification for potentially better object detail
                let detailedObject = "";
                if (mobilenetRef.current) {
                    const predictions = await mobilenetRef.current.classify(element, 3);
                    const validPredictions = predictions.filter(p => p.probability > 0.2);

                    if (validPredictions.length > 0) {
                        const top = validPredictions[0];
                        if (validPredictions.length > 1 && validPredictions[1].probability > 0.3) {
                            detailedObject = `${top.className}, or maybe a ${validPredictions[1].className}`;
                        } else {
                            detailedObject = top.className;
                        }
                    }
                }

                // 3. Build comprehensive description from detection boxes
                const detections = lastDetectionsRef.current;
                const closeItems: string[] = [];
                const mediumItems: string[] = [];
                const farItems: string[] = [];

                detections.forEach(d => {
                    const displayName = d.name || d.class;
                    // Don't duplicate if MobileNet found the same thing
                    if (detailedObject && displayName.toLowerCase().includes(detailedObject.toLowerCase().split(',')[0])) return;

                    const proximity = d.proximity || 'medium';
                    if (proximity === 'close') closeItems.push(displayName);
                    else if (proximity === 'far') farItems.push(displayName);
                    else mediumItems.push(displayName);
                });

                const parts: string[] = [];

                if (recognizedText) {
                    parts.push(`I can read the label: "${recognizedText}"`);
                }

                if (detailedObject) {
                    parts.push(`This looks like a ${detailedObject}`);
                }

                if (closeItems.length > 0) {
                    const items = [...new Set(closeItems)].join(', ');
                    parts.push(`${items} nearby`);
                }
                if (mediumItems.length > 0) {
                    const items = [...new Set(mediumItems)].join(', ');
                    parts.push(items);
                }
                if (farItems.length > 0) {
                    const items = [...new Set(farItems)].join(', ');
                    parts.push(`${items} far away`);
                }

                if (parts.length > 0) {
                    onQueryResponse(parts.join('. '));
                } else {
                    onQueryResponse("I cannot identify any objects right now");
                }
            }
        };
        handleQuery();
    }, [queryTrigger, onQueryResponse, staticImage]);


    // Detection logic for static image
    const detectStatic = useCallback(async () => {
        if (!modelRef.current || !imgRef.current || !canvasRef.current) return;

        const img = imgRef.current;
        const predictions = await modelRef.current.detect(img);

        // Add proximity to each prediction
        const enhancedPredictions: Detection[] = predictions.map(pred => ({
            ...pred,
            proximity: estimateProximity(pred.bbox, img.naturalWidth, img.naturalHeight),
        }));

        lastDetectionsRef.current = enhancedPredictions;

        const ctx = canvasRef.current.getContext("2d");
        if (!ctx) return;

        canvasRef.current.width = img.naturalWidth;
        canvasRef.current.height = img.naturalHeight;
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

        enhancedPredictions.forEach((pred) => {
            const [x, y, w, h] = pred.bbox;
            const proximity = pred.proximity || 'medium';
            const color = getProximityColor(proximity);
            const proximityLabel = getProximityLabel(proximity);

            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            ctx.strokeRect(x, y, w, h);
            ctx.fillStyle = color;
            ctx.font = "bold 16px Arial";

            const label = proximityLabel
                ? `${pred.class} (${proximityLabel})`
                : pred.class;
            ctx.fillText(label, x, y > 20 ? y - 5 : y + 20);
        });

        onDetections(enhancedPredictions);
    }, [onDetections]);


    // Detection loop for webcam
    const detectWebcam = useCallback(async () => {
        if (
            !modelRef.current ||
            !webcamRef.current?.video ||
            !canvasRef.current
        )
            return;

        const video = webcamRef.current.video;
        if (video.readyState !== 4) return;

        const frameWidth = video.videoWidth;
        const frameHeight = video.videoHeight;

        // Run object detection and face recognition in parallel
        const [predictions, faceDetections] = await Promise.all([
            modelRef.current.detect(video),
            faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
                .withFaceLandmarks()
                .withFaceDescriptors()
        ]);

        // Draw on canvas
        const ctx = canvasRef.current.getContext("2d");
        if (!ctx) return;

        canvasRef.current.width = frameWidth;
        canvasRef.current.height = frameHeight;
        ctx.clearRect(0, 0, frameWidth, frameHeight);

        // Collect all detections (faces + objects) with proximity
        const allDetections: Detection[] = [];
        const now = Date.now();

        // Handle faces and identification
        faceDetections.forEach(fd => {
            const { x, y, width, height } = fd.detection.box;
            const bbox: [number, number, number, number] = [x, y, width, height];
            const proximity = estimateProximity(bbox, frameWidth, frameHeight);
            const match = matchFace(fd.descriptor, knownPeople);
            const proximityLabel = getProximityLabel(proximity);

            // Use proximity color for border
            const color = getProximityColor(proximity);
            ctx.strokeStyle = match ? "#a855f7" : color;
            ctx.lineWidth = 4;
            ctx.strokeRect(x, y, width, height);

            // Label with name and proximity
            const displayName = match || "person";
            const label = proximityLabel
                ? `${displayName} (${proximityLabel})`
                : displayName;

            ctx.fillStyle = match ? "#a855f7" : color;
            ctx.font = "bold 18px Arial";
            ctx.fillText(label, x, y > 25 ? y - 8 : y + height + 18);

            // Add to detections array
            allDetections.push({
                bbox,
                class: "person",
                score: fd.detection.score,
                proximity,
                name: match || undefined,
            });

            // Alert if first time seeing identified person or after 10s
            if (match) {
                const lastSeen = identifiedPeopleRef.current.get(match) || 0;
                if (now - lastSeen > 10000) {
                    identifiedPeopleRef.current.set(match, now);
                    const proximityText = proximity === 'close' ? 'right in front of you'
                        : proximity === 'far' ? 'in the distance'
                            : 'nearby';
                    onQueryResponse(`${match} is ${proximityText}`);
                }
            }
        });

        // Track objects and detect approaching
        const newTracked = new Map<string, TrackedObject>();

        predictions.forEach((pred, idx) => {
            const [x, y, w, h] = pred.bbox;
            const area = w * h;
            const key = `${pred.class}_${idx}`;
            const proximity = estimateProximity(pred.bbox, frameWidth, frameHeight);
            const proximityLabel = getProximityLabel(proximity);
            const color = getProximityColor(proximity);

            // Draw bounding box (skip if already drawing face for person)
            const isFaceArea = faceDetections.some(fd => {
                const box = fd.detection.box;
                return x < box.x + box.width && x + w > box.x && y < box.y + box.height && y + h > box.y;
            });

            if (pred.class !== "person" || !isFaceArea) {
                ctx.strokeStyle = color;
                ctx.lineWidth = 3;
                ctx.strokeRect(x, y, w, h);

                ctx.fillStyle = color;
                ctx.font = "bold 16px Arial";

                const label = proximityLabel
                    ? `${pred.class} (${proximityLabel})`
                    : pred.class;
                ctx.fillText(label, x, y > 20 ? y - 5 : y + 20);

                // Add non-person or non-face-overlapping items to detections
                allDetections.push({
                    ...pred,
                    proximity,
                });
            }

            // Check if approaching
            const existing = trackedObjectsRef.current.get(key);
            const approaching =
                existing && area > existing.prevArea * 1.15 && pred.class === "person";

            const tracked: TrackedObject = {
                id: key,
                class: pred.class,
                bbox: pred.bbox,
                lastSeen: now,
                prevArea: area,
                approaching: !!approaching,
            };

            newTracked.set(key, tracked);

            if (approaching) {
                onApproaching(tracked);
            }
        });

        trackedObjectsRef.current = newTracked;
        lastDetectionsRef.current = allDetections;
        onDetections(allDetections);
    }, [onDetections, onApproaching, knownPeople, onQueryResponse]);


    // Run detection loop
    useEffect(() => {
        if (isLoading) return;

        if (staticImage) {
            detectStatic();
            return;
        }

        const interval = setInterval(detectWebcam, 150);
        return () => clearInterval(interval);
    }, [isLoading, detectWebcam, detectStatic, staticImage]);

    if (error) {
        return (
            <div className="flex h-screen items-center justify-center bg-black text-red-500 text-xl">
                {error}
            </div>
        );
    }

    return (
        <div className="relative w-full h-full">
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
                    <div className="text-white text-xl animate-pulse">
                        Loading AI Models...
                    </div>
                </div>
            )}
            {staticImage ? (
                <img
                    ref={imgRef}
                    src={staticImage}
                    alt="To be analyzed"
                    className="absolute inset-0 w-full h-full object-contain bg-black"
                    onLoad={detectStatic}
                />
            ) : (
                <Webcam
                    ref={webcamRef}
                    audio={false}
                    screenshotFormat="image/jpeg"
                    videoConstraints={{
                        facingMode: "environment",
                        width: { ideal: 1280 },
                        height: { ideal: 720 },
                    }}
                    className="absolute inset-0 w-full h-full object-cover"
                />
            )}
            <canvas
                ref={canvasRef}
                className={`absolute inset-0 w-full h-full pointer-events-none ${staticImage ? 'object-contain' : 'object-cover'}`}
            />
        </div>
    );
}
