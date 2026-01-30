import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Constants from 'expo-constants';

// Initialize Gemini AI
const GEMINI_API_KEY = Constants.expoConfig?.extra?.geminiApiKey || 'YOUR_API_KEY_HERE';
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

export interface Detection {
    class: string;
    score: number;
    x: number;
    y: number;
    width: number;
    height: number;
    proximity?: 'close' | 'medium' | 'far';
    isShape?: boolean;
    isText?: boolean;
}

interface VisionResponse {
    detections: Detection[];
    labels: string[];
    shapes: string[];
}

// Cache to reduce API calls
let lastDetectionTime = 0;
let cachedDetections: Detection[] = [];
const CACHE_DURATION = 2000; // 2 seconds

/**
 * Estimate proximity based on bounding box size relative to frame
 */
function estimateProximity(
    bbox: { x: number; y: number; width: number; height: number },
    frameWidth: number,
    frameHeight: number
): 'close' | 'medium' | 'far' {
    const bboxArea = bbox.width * bbox.height;
    const frameArea = frameWidth * frameHeight;
    const ratio = bboxArea / frameArea;

    if (ratio > 0.15) return 'close';   // > 15% of frame
    if (ratio > 0.04) return 'medium';  // 4-15% of frame
    return 'far';                       // < 4% of frame
}

/**
 * Convert image URI to base64
 */
async function imageToBase64(uri: string): Promise<string> {
    try {
        // Resize image to reduce API payload size
        const manipResult = await manipulateAsync(
            uri,
            [{ resize: { width: 640 } }],
            { compress: 0.7, format: SaveFormat.JPEG, base64: true }
        );

        return manipResult.base64 || '';
    } catch (error) {
        console.error('Error converting image to base64:', error);
        throw error;
    }
}

/**
 * Parse Gemini response to extract structured detection data
 */
function parseVisionResponse(text: string, frameWidth: number, frameHeight: number): VisionResponse {
    const detections: Detection[] = [];
    const labels: string[] = [];
    const shapes: string[] = [];

    try {
        // Try to parse JSON response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const data = JSON.parse(jsonMatch[0]);

            // Process objects
            if (data.objects && Array.isArray(data.objects)) {
                data.objects.forEach((obj: any) => {
                    const bbox = {
                        x: (obj.bbox?.x || 0) * frameWidth,
                        y: (obj.bbox?.y || 0) * frameHeight,
                        width: (obj.bbox?.width || 0.1) * frameWidth,
                        height: (obj.bbox?.height || 0.1) * frameHeight,
                    };

                    detections.push({
                        class: obj.name || obj.label || 'object',
                        score: obj.confidence || 0.8,
                        x: bbox.x,
                        y: bbox.y,
                        width: bbox.width,
                        height: bbox.height,
                        proximity: estimateProximity(bbox, frameWidth, frameHeight),
                    });
                });
            }

            // Process shapes
            if (data.shapes && Array.isArray(data.shapes)) {
                data.shapes.forEach((shape: any) => {
                    shapes.push(shape.type || shape.name || shape);

                    const bbox = {
                        x: (shape.bbox?.x || 0.4) * frameWidth,
                        y: (shape.bbox?.y || 0.4) * frameHeight,
                        width: (shape.bbox?.width || 0.2) * frameWidth,
                        height: (shape.bbox?.height || 0.2) * frameHeight,
                    };

                    detections.push({
                        class: `${shape.type || shape.name || 'shape'}`,
                        score: shape.confidence || 0.85,
                        x: bbox.x,
                        y: bbox.y,
                        width: bbox.width,
                        height: bbox.height,
                        proximity: estimateProximity(bbox, frameWidth, frameHeight),
                        isShape: true,
                    });
                });
            }

            // Process text/labels
            if (data.text && Array.isArray(data.text)) {
                data.text.forEach((textItem: any) => {
                    const text = textItem.content || textItem.text || textItem;
                    if (text && text.length > 1) {
                        labels.push(text);

                        const bbox = {
                            x: (textItem.bbox?.x || 0.1) * frameWidth,
                            y: (textItem.bbox?.y || 0.1) * frameHeight,
                            width: (textItem.bbox?.width || 0.3) * frameWidth,
                            height: (textItem.bbox?.height || 0.05) * frameHeight,
                        };

                        detections.push({
                            class: `📝 ${text}`,
                            score: textItem.confidence || 0.9,
                            x: bbox.x,
                            y: bbox.y,
                            width: bbox.width,
                            height: bbox.height,
                            proximity: 'medium',
                            isText: true,
                        });
                    }
                });
            }
        }
    } catch (error) {
        console.error('Error parsing vision response:', error);

        // Fallback: extract information from text
        const lines = text.toLowerCase().split('\n');

        // Look for common objects
        const commonObjects = ['person', 'phone', 'laptop', 'bottle', 'cup', 'book', 'chair', 'table'];
        commonObjects.forEach(obj => {
            if (text.toLowerCase().includes(obj)) {
                detections.push({
                    class: obj,
                    score: 0.7,
                    x: frameWidth * 0.3,
                    y: frameHeight * 0.3,
                    width: frameWidth * 0.4,
                    height: frameHeight * 0.4,
                    proximity: 'medium',
                });
            }
        });

        // Look for shapes
        const commonShapes = ['circle', 'square', 'rectangle', 'triangle', 'oval'];
        commonShapes.forEach(shape => {
            if (text.toLowerCase().includes(shape)) {
                shapes.push(shape);
                detections.push({
                    class: shape,
                    score: 0.75,
                    x: frameWidth * 0.4,
                    y: frameHeight * 0.4,
                    width: frameWidth * 0.2,
                    height: frameHeight * 0.2,
                    proximity: 'medium',
                    isShape: true,
                });
            }
        });
    }

    return { detections, labels, shapes };
}

/**
 * Analyze image using Gemini Vision API
 */
export async function analyzeImage(
    imageUri: string,
    frameWidth: number = 640,
    frameHeight: number = 480
): Promise<VisionResponse> {
    // Check cache
    const now = Date.now();
    if (now - lastDetectionTime < CACHE_DURATION && cachedDetections.length > 0) {
        return {
            detections: cachedDetections,
            labels: cachedDetections.filter(d => d.isText).map(d => d.class.replace('📝 ', '')),
            shapes: cachedDetections.filter(d => d.isShape).map(d => d.class),
        };
    }

    try {
        // Convert image to base64
        const base64Image = await imageToBase64(imageUri);

        if (!base64Image) {
            throw new Error('Failed to convert image to base64');
        }

        // Create the model
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        // Craft a detailed prompt for object detection, shape recognition, and OCR
        const prompt = `Analyze this image and provide a detailed JSON response with the following structure:
{
  "objects": [
    {
      "name": "object name or brand",
      "confidence": 0.0-1.0,
      "bbox": {"x": 0.0-1.0, "y": 0.0-1.0, "width": 0.0-1.0, "height": 0.0-1.0}
    }
  ],
  "shapes": [
    {
      "type": "circle|square|rectangle|triangle|oval|etc",
      "confidence": 0.0-1.0,
      "bbox": {"x": 0.0-1.0, "y": 0.0-1.0, "width": 0.0-1.0, "height": 0.0-1.0}
    }
  ],
  "text": [
    {
      "content": "visible text or label",
      "confidence": 0.0-1.0,
      "bbox": {"x": 0.0-1.0, "y": 0.0-1.0, "width": 0.0-1.0, "height": 0.0-1.0}
    }
  ]
}

Important:
- Identify ALL visible objects, including brand names if visible
- Detect geometric shapes (circles, squares, triangles, etc.)
- Read ALL visible text, labels, and brand names
- Provide normalized bounding boxes (0.0 to 1.0 coordinates)
- Be specific with object names (e.g., "Coca-Cola can" not just "can")`;

        // Generate content
        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Image,
                },
            },
        ]);

        const response = await result.response;
        const text = response.text();

        // Parse the response
        const visionResponse = parseVisionResponse(text, frameWidth, frameHeight);

        // Update cache
        lastDetectionTime = now;
        cachedDetections = visionResponse.detections;

        return visionResponse;
    } catch (error) {
        console.error('Error analyzing image:', error);

        // Return cached data if available
        if (cachedDetections.length > 0) {
            return {
                detections: cachedDetections,
                labels: cachedDetections.filter(d => d.isText).map(d => d.class.replace('📝 ', '')),
                shapes: cachedDetections.filter(d => d.isShape).map(d => d.class),
            };
        }

        throw error;
    }
}

/**
 * Clear detection cache
 */
export function clearCache() {
    cachedDetections = [];
    lastDetectionTime = 0;
}
