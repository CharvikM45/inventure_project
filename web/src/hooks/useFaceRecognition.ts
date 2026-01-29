import * as faceapi from '@vladmandic/face-api';

let isLoaded = false;

export const loadModels = async () => {
    if (isLoaded) return;

    // We'll use CDN for models to avoid local storage issues
    const MODEL_URL = 'https://vladmandic.github.io/face-api/model/';

    await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);

    isLoaded = true;
};

export const getFaceDescriptor = async (imageElement: HTMLImageElement | HTMLVideoElement) => {
    await loadModels();

    const detection = await faceapi
        .detectSingleFace(imageElement, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();

    return detection?.descriptor;
};

export const matchFace = (descriptor: Float32Array, knownPeople: { name: string, descriptor: number[] }[]) => {
    if (knownPeople.length === 0) return null;

    const labeledDescriptors = knownPeople.map(p => {
        return new faceapi.LabeledFaceDescriptors(p.name, [new Float32Array(p.descriptor)]);
    });

    const faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.6);
    const bestMatch = faceMatcher.findBestMatch(descriptor);

    return bestMatch.label !== 'unknown' ? bestMatch.label : null;
};
