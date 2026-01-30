// Remove top-level import to avoid SSR crash
// import * as faceapi from '@vladmandic/face-api';

let faceapi: any = null;

const loadFaceApi = async () => {
    if (faceapi) return faceapi;
    faceapi = await import('@vladmandic/face-api');
    return faceapi;
};

let modelsLoaded = false;

export const loadModels = async () => {
    if (modelsLoaded) return;
    const api = await loadFaceApi();

    // We'll use CDN for models to avoid local storage issues
    const MODEL_URL = 'https://vladmandic.github.io/face-api/model/';

    await Promise.all([
        api.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        api.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        api.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);

    modelsLoaded = true;
};

export const getFaceDescriptor = async (imageElement: HTMLImageElement | HTMLVideoElement) => {
    await loadModels();
    const api = await loadFaceApi();

    const detection = await api
        .detectSingleFace(imageElement, new api.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();

    return detection?.descriptor;
};

export const matchFace = async (descriptor: Float32Array, knownPeople: { name: string, descriptor: number[] }[]) => {
    if (knownPeople.length === 0) return null;
    const api = await loadFaceApi();

    const labeledDescriptors = knownPeople.map(p => {
        return new api.LabeledFaceDescriptors(p.name, [new Float32Array(p.descriptor)]);
    });

    const faceMatcher = new api.FaceMatcher(labeledDescriptors, 0.6);
    const bestMatch = faceMatcher.findBestMatch(descriptor);

    return bestMatch.label !== 'unknown' ? bestMatch.label : null;
};
