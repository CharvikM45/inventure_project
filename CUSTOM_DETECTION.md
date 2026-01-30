# Custom object and face detection

## Can you train a model on images I send?

**No.** The assistant cannot run training on your images. Training needs GPUs, lots of data, and saved model files. What we *can* do:

1. **Use your trained model in the app** – Once you have a trained model (TF.js for web, TFLite for mobile), you can drop it into the project and the app will use it. See below.
2. **Guide you step‑by‑step** – How to collect images, label them, and train a model yourself using free tools.

---

## Training on your own images (objects or faces)

### Option A: No-code (easiest)

1. **Google Teachable Machine**  
   - Go to [teachablemachine.withgoogle.com](https://teachablemachine.withgoogle.com/).  
   - Create an “Image project”, add classes (e.g. “Water bottle”, “My face”, “Desk”).  
   - Upload 50–200+ images per class (or use webcam).  
   - Train, then export:  
     - **Web:** “TensorFlow.js” → “Upload (shareable link)” or download and put in `web/public/model/custom/`.  
     - **Mobile:** “TensorFlow Lite” → download `.tflite` and put in `mobile/assets/models/` and point the app to it (see mobile custom model section below).

2. **Roboflow**  
   - [roboflow.com](https://roboflow.com) – upload images, label, train (including YOLO).  
   - Export for “TensorFlow.js” (web) or “TFLite” (mobile) and use the exported files as below.

### Option B: YOLO fine-tuning (objects)

- Use **Ultralytics YOLO** or **Roboflow** with a YOLO base model.  
- Collect images of your objects, label bounding boxes, then fine-tune.  
- Export to:  
  - **Web:** TF.js format (`model.json` + shards) → place in `web/public/model/custom/`.  
  - **Mobile:** TFLite → place in `mobile/assets/models/` and wire the app to load it.

### Option C: Face recognition (specific people)

- For “who is this person?” (not just “a face”):  
  - Use **face-api.js** (already in the web app) or a face embedding model.  
  - Enroll faces: run your images through the model, save embedding vectors and names.  
  - At runtime, compare camera embeddings to enrolled ones.  
- The web app’s `useFaceRecognition` hook can be extended to load your enrolled faces (e.g. from a JSON or API) and match against them.

---

## Using a custom model in the app

### Web

The app **tries custom first**, then YOLO, then COCO-SSD.

1. Export your model to **TensorFlow.js** in **YOLO-compatible** form:
   - Input: `[1, 640, 640, 3]` (batch, height, width, RGB).
   - Output: same as YOLO (e.g. `[1, 300, 6]` for NMS-free, or `[1, 84, 8400]` for raw).  
   Tools like **Roboflow** (export “TensorFlow.js”) or **Ultralytics** (export to TF.js) produce this. Teachable Machine object-detection export may differ; use a YOLO-style export if possible.

2. Put the model in:
   ```
   web/public/model/custom/
       model.json
       group1-shard1of*.bin
       ...
   ```
3. Add class names (same order as training):
   - Create `web/public/model/custom/classes.json`:
     ```json
     ["water bottle", "my desk", "laptop", "person"]
     ```
4. The app loads `/model/custom/model.json` first. If it loads within 12 seconds, it uses your model and your `classes.json` labels. Otherwise it falls back to the built-in YOLO, then COCO-SSD.

### Mobile

1. Export your model as **TFLite** (e.g. `my_model.tflite`).  
2. Put it in `mobile/assets/models/` (e.g. `my_model.tflite`).  
3. In `mobile/services/ObjectDetectionService.ts`, change the `require` to your file:
   ```ts
   model = await loadTensorflowModel(require('../assets/models/my_model.tflite'));
   ```
4. Update `CLASS_NAMES` in that file to match your trained classes (same order as training).

---

## Summary

| Goal | What you do |
|------|-------------|
| Detect **everything in front of the camera** (default) | Use the app as-is; confidence and max detections are tuned to show more objects. |
| Detect **specific objects** you care about | Train a model (Teachable Machine, Roboflow, or YOLO) on your images, export TF.js (web) or TFLite (mobile), then add the model and class names as above. |
| Recognize **specific faces** | Use face-api.js (or similar) with enrolled embeddings from your images; extend the app to load your enrolled list and match. |

I can’t train on images you send, but once you have a trained model and (optionally) a class list, we can wire it in so the app detects everything in front of the camera using your custom model.
