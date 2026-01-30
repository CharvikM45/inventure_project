import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';

let model: TensorflowModel | null = null;

// COCO Class names
export const CLASS_NAMES = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light",
    "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
    "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
    "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle",
    "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange", "broccoli",
    "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant", "bed", "dining table",
    "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone", "microwave", "oven", "toaster",
    "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush"
];

export interface DetectionResult {
    class: string;
    confidence: number;
    box: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
}

export const loadModel = async () => {
    if (model) return model;
    try {
        console.log("Loading YOLO26n model...");
        // @ts-ignore
        model = await loadTensorflowModel(require('../assets/models/yolo26n.tflite'));
        console.log("Model loaded successfully!");
        return model;
    } catch (e) {
        console.error("Failed to load model:", e);
        return null;
    }
};
