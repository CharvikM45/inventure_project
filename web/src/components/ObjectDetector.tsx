"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";
import Webcam from "react-webcam";
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-webgl";

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

export default function ObjectDetector() {
    const webcamRef = useRef<Webcam>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [model, setModel] = useState<tf.GraphModel | null>(null);
    const [loading, setLoading] = useState(true);

    // Load Model
    useEffect(() => {
        const loadModel = async () => {
            try {
                setLoading(true);
                // Ensure webgl backend is ready
                await tf.setBackend("webgl");
                await tf.ready();

                console.log("Loading YOLO web model...");
                // Path matches the instruction to user: web/public/model/yolo26n_web_model/model.json
                const loadedModel = await tf.loadGraphModel("/model/yolo26n_web_model/model.json");
                setModel(loadedModel);
                console.log("Model loaded!", loadedModel);
                setLoading(false);
            } catch (err) {
                console.error("Failed to load model", err);
                setLoading(false);
            }
        };
        loadModel();
    }, []);

    // Detection Loop
    const detect = useCallback(async () => {
        // console.log("Detect loop iteration...");
        if (!model) {
            console.log("Model not loaded yet in detect loop");
            requestAnimationFrame(detect);
            return;
        }
        if (!webcamRef.current || !canvasRef.current) {
            console.log("Refs missing");
            requestAnimationFrame(detect);
            return;
        }

        const video = webcamRef.current.video;
        if (!video || video.readyState !== 4) {
            console.log("Video not ready. ReadyState:", video?.readyState);
            requestAnimationFrame(detect);
            return;
        }

        const { videoWidth, videoHeight } = video;
        canvasRef.current.width = videoWidth;
        canvasRef.current.height = videoHeight;

        // 1. Preprocess
        // console.log("Preprocessing frame...");
        const tfImg = tf.browser.fromPixels(video);
        // Resize to 640x640 (standard YOLO input)
        const resized = tf.image.resizeBilinear(tfImg, [640, 640]);
        const casted = resized.cast("float32");
        const expanded = casted.expandDims(0); // [1, 640, 640, 3]
        const normalized = expanded.div(255.0); // Normalize to 0-1

        // 2. Inference
        try {
            const result = await model.executeAsync(normalized);
            // YOLOv8/26 output is usually [1, 84, 8400] (transposed) or [1, 5+80, 8400]
            // We need to check shape.

            let resTensor = Array.isArray(result) ? result[0] : result;
            console.log("Model Output Shape:", resTensor.shape);

            // Parse results
            // We will do this on CPU for simplicity in this version, 
            // though WebGL/GPU optimization exists.
            const data = await resTensor.array() as number[][][];
            // data[0] is the batch 0 output

            const prediction = data[0]; // shape ideally [84, 8400] (or similar transposed)
            console.log("Prediction Sample (feature 0, first 10):", prediction[0]?.slice(0, 10));
            console.log("Prediction Dimensions: ", prediction.length, "x", prediction[0]?.length);
            // If shape is [1, 300, 6] (NMS free), handle that.

            tf.dispose([tfImg, resized, casted, expanded, normalized, resTensor]);
            if (Array.isArray(result)) result.forEach(t => t.dispose());

            drawDetections(prediction, canvasRef.current);

        } catch (e) {
            console.error(e);
        }

        // Loop
        requestAnimationFrame(detect);
    }, [model]);

    useEffect(() => {
        if (model && !loading) {
            detect();
        }
    }, [model, loading, detect]);

    const drawDetections = (prediction: number[][], canvas: HTMLCanvasElement) => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Heuristic signature check
        // If output is [300, 6] (NMS free) vs [84, 8400] (Standard)

        // NMS Free (transposed or not? Standard is usually [batch, dets, 6])
        // If prediction.length is 300 and prediction[0].length is 6
        if (prediction.length === 300 && prediction[0].length === 6) {
            // [x, y, w, h, score, class]
            prediction.forEach(det => {
                const score = det[4];
                if (score > 0.45) {
                    const x = det[0];
                    const y = det[1];
                    const w = det[2];
                    const h = det[3];
                    const cls = Math.round(det[5]);

                    // Check if coordinates are normalized or pixels. 
                    // Usually pixels relative to input 640x640.
                    // We need to scale to video size.
                    const scaleX = canvas.width / 640;
                    const scaleY = canvas.height / 640;

                    drawBox(ctx, x * scaleX, y * scaleY, w * scaleX, h * scaleY, score, cls);
                }
            });
            return;
        }

        // Standard YOLOv8 [84, 8400] -> rows=features, cols=anchors
        // We need to transpose to iterate anchors easily if it comes in [features, anchors]
        // But data comes as array of arrays.

        // Let's assume standard [84, 8400]. 
        const numAnchors = prediction[0].length; // 8400
        const numFeatures = prediction.length;   // 84

        if (numAnchors === 8400) {
            // We iterate anchors
            for (let i = 0; i < numAnchors; i++) {
                // Find max class score
                let maxScore = 0;
                let maxClass = -1;

                // Classes start at index 4
                for (let c = 0; c < 80; c++) {
                    const score = prediction[4 + c][i];
                    if (score > maxScore) {
                        maxScore = score;
                        maxClass = c;
                    }
                }

                if (maxScore > 0.5) {
                    const cx = prediction[0][i]; // 640 scale
                    const cy = prediction[1][i];
                    const w = prediction[2][i];
                    const h = prediction[3][i];

                    const scaleX = canvas.width / 640;
                    const scaleY = canvas.height / 640;

                    // cx,cy,w,h are in 640x640 space usually
                    drawBox(ctx, cx * scaleX, cy * scaleY, w * scaleX, h * scaleY, maxScore, maxClass);
                }
            }
        }
    };

    const drawBox = (ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, score: number, cls: number) => {
        const x = cx - w / 2;
        const y = cy - h / 2;

        ctx.strokeStyle = "#00FF00";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);

        ctx.fillStyle = "#00FF00";
        ctx.font = "16px Arial";
        ctx.fillText(`${CLASS_NAMES[cls] || cls} ${(score * 100).toFixed(1)}%`, x, y > 20 ? y - 5 : y + 15);
    };

    return (
        <div className="relative w-full max-w-2xl mx-auto overflow-hidden rounded-lg shadow-lg bg-black">
            {loading && (
                <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/50 text-white">
                    Loading Model...
                </div>
            )}
            <Webcam
                ref={webcamRef}
                className="w-full h-auto"
                screenshotFormat="image/jpeg"
                videoConstraints={{
                    facingMode: "environment"
                }}
            />
            <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 w-full h-full pointer-events-none"
            />
        </div>
    );
}
