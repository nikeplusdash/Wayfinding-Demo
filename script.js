// script.js
import {
    FaceDetector,
    GestureRecognizer,
    FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";

// --- DOM Elements ---
const video = document.getElementById("webcam");
const liveView = document.getElementById("liveView");
const timeoutOverlay = document.getElementById("timeoutOverlay");

const defaultScreen = document.getElementById("defaultScreen");
const questionnaireScreen = document.getElementById("questionnaireScreen");
const finalScreen = document.getElementById("finalScreen");
const customCursor = document.getElementById("custom_cursor");

// --- Global Variables ---
let faceDetector, gestureRecognizer;
let runningMode = "VIDEO";

// Timeout values (in milliseconds)
const PRE_QUESTIONNAIRE_TIMEOUT = 1000; // 1 second before questionnaire appears (adjusted as needed)
const STEP_BACK_TIMEOUT = 12000;        // 12 seconds allowed to step back in questionnaire
const HOLD_TIMEOUT = 1300;

// Timers for tracking face presence in each state.
let preQuestionnaireStartTime = null;  // For default state (pre-questionnaire)
let stepBackStartTime = null;            // For questionnaire state

// Debug flag (set to false to disable debug bounding boxes)
const DEBUG = true;

// Current active screen state.
let currentScreen = "defaultScreen"; // "defaultScreen", "questionnaireScreen", or "finalScreen"

// Gesture click control variables
let isClicking = false;
let holdStartTime = null; // For tracking progress button hold time

// --- Utility Functions ---
function getRandomColor() {
    return '#' + Math.floor(Math.random() * 16777215).toString(16);
}

function transitionTo(screenId) {
    currentScreen = screenId;
    [defaultScreen, questionnaireScreen, finalScreen].forEach(screen => {
        screen.classList.remove("active");
    });
    document.getElementById(screenId).classList.add("active");
    // Reset timers upon transition.
    preQuestionnaireStartTime = null;
    stepBackStartTime = null;
}

// --- Initialize Models ---
const initializeModels = async () => {
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );
    faceDetector = await FaceDetector.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
            delegate: "GPU"
        },
        runningMode: runningMode
    });
    gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
            delegate: "GPU"
        },
        runningMode: runningMode
    });
};

// --- Set Up Camera ---
async function setupCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        return new Promise((resolve) => {
            video.onloadeddata = () => {
                video.play();
                resolve();
            };
        });
    } catch (err) {
        console.error("Error accessing the webcam:", err);
    }
}

// --- Debug Overlay: Draw bounding boxes ---
function updateDebugOverlay(detections) {
    liveView.innerHTML = "";
    detections.forEach(detection => {
        const bbox = detection.boundingBox;
        const x = bbox.originX * video.videoWidth;
        const y = bbox.originY * video.videoHeight;
        const width = bbox.width * video.videoWidth;
        const height = bbox.height * video.videoHeight;

        const boxDiv = document.createElement("div");
        boxDiv.style.position = "absolute";
        boxDiv.style.border = "2px solid lime";
        boxDiv.style.left = (video.offsetLeft + x) + "px";
        boxDiv.style.top = (video.offsetTop + y) + "px";
        boxDiv.style.width = width + "px";
        boxDiv.style.height = height + "px";
        liveView.appendChild(boxDiv);
    });
}

// --- Gesture Handling Functions ---

// Handles a closed_fist gesture based on the interactive element's type.
function handleClosedFist(hoveredElement, pointerX, pointerY, nowMs) {
    if (!hoveredElement || !hoveredElement.hasAttribute('data-gesture-type')) return;
    const gestureType = hoveredElement.getAttribute('data-gesture-type');

    if (gestureType === "instant") {
        if (!isClicking) {
            hoveredElement.click();
            isClicking = true;
            customCursor.style.background = "white";
        }
    } else if (gestureType === "progress") {
        if (holdStartTime === null) {
            holdStartTime = nowMs;
        }
        const holdElapsed = nowMs - holdStartTime;
        // Locate the progress bar within the hovered element
        let progressBar = hoveredElement.querySelector('.progressBar') ||
            hoveredElement.querySelector('#progressBar');
        if (progressBar) {
            const progressPercent = Math.min((holdElapsed / HOLD_TIMEOUT) * 100, 100);
            progressBar.style.width = progressPercent + "%";
        }
        if (holdElapsed >= HOLD_TIMEOUT && !isClicking) {
            hoveredElement.click();
            isClicking = true;
            customCursor.style.background = "white";
            if (progressBar) progressBar.style.width = "0%";
            holdStartTime = null;
        }
    }
}

// Resets the gesture state and (if needed) any visual progress.
function resetGestureState(hoveredElement) {
    holdStartTime = null;
    isClicking = false;
    if (hoveredElement && hoveredElement.hasAttribute('data-gesture-type')) {
        const gestureType = hoveredElement.getAttribute('data-gesture-type');
        if (gestureType === "progress") {
            let progressBar = hoveredElement.querySelector('.progressBar') ||
                hoveredElement.querySelector('#progressBar');
            if (progressBar) progressBar.style.width = "0%";
        }
    }
    customCursor.style.background = "red";
}

// --- Main Processing Loop ---
let lastVideoTime = -1;
async function predictWebcam() {
    if (!faceDetector || !gestureRecognizer) {
        requestAnimationFrame(predictWebcam);
        return;
    }

    // Ensure models are in VIDEO mode.
    if (runningMode === "IMAGE") {
        runningMode = "VIDEO";
        await faceDetector.setOptions({ runningMode: "VIDEO" });
        await gestureRecognizer.setOptions({ runningMode: "VIDEO" });
    }

    const nowMs = performance.now();

    if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;

        // --- Face Detection ---
        const faceResult = faceDetector.detectForVideo(video, nowMs);
        const detections = faceResult.detections;

        let countdownMessage = "";

        // --- Default Screen ---
        if (currentScreen === "defaultScreen") {
            if (detections && detections.length > 0) {
                if (!preQuestionnaireStartTime) {
                    preQuestionnaireStartTime = performance.now();
                }
                const elapsed = performance.now() - preQuestionnaireStartTime;
                const remaining = Math.max(0, (PRE_QUESTIONNAIRE_TIMEOUT - elapsed) / 1000);
                countdownMessage = `Starting questionnaire in: ${remaining.toFixed(1)} s`;
                if (elapsed >= PRE_QUESTIONNAIRE_TIMEOUT) {
                    transitionTo("questionnaireScreen");
                }
            } else {
                preQuestionnaireStartTime = null;
                countdownMessage = "";
            }
        }
        // --- Questionnaire Screen ---
        else if (currentScreen === "questionnaireScreen") {
            if (detections && detections.length > 0) {
                stepBackStartTime = null;
            } else {
                if (!stepBackStartTime) {
                    stepBackStartTime = performance.now();
                }
                const elapsed = performance.now() - stepBackStartTime;
                const remaining = Math.max(0, (STEP_BACK_TIMEOUT - elapsed) / 1000);
                countdownMessage = `Please step back in within: ${remaining.toFixed(1)} s`;
                if (elapsed >= STEP_BACK_TIMEOUT) {
                    transitionTo("defaultScreen");
                }
            }
        }
        timeoutOverlay.textContent = countdownMessage;

        // --- Gesture Recognition ---
        const gestureResult = gestureRecognizer.recognizeForVideo(video, nowMs);

        // --- Update Custom Cursor Position (using hand landmark) ---
        let pointerX = window.innerWidth / 2;
        let pointerY = window.innerHeight / 2;
        if (gestureResult.landmarks && gestureResult.landmarks.length > 0) {
            const handLandmarks = gestureResult.landmarks[0];
            if (handLandmarks.length > 0) {
                // Use the first landmark as pointer; mirror the x-coordinate.
                const center = handLandmarks[0];
                pointerX = (1 - center.x) * window.innerWidth;
                pointerY = center.y * window.innerHeight;
            }
        }
        customCursor.style.left = (pointerX - customCursor.offsetWidth / 2) + "px";
        customCursor.style.top = (pointerY - customCursor.offsetHeight / 2) + "px";

        // --- Check for Interactive Element Under Pointer ---
        const hoveredElement = document.elementFromPoint(pointerX, pointerY);
        if (hoveredElement && hoveredElement.hasAttribute('data-gesture-type')) {
            // Change cursor shape to square (via border-radius)
            customCursor.style.borderRadius = "0";
        } else {
            customCursor.style.borderRadius = "50%";
        }

        // --- Process Closed-Fist Gesture ---
        if (gestureResult.gestures && gestureResult.gestures.length > 0) {
            const topGesture = gestureResult.gestures[0][0];
            const gestureName = topGesture.categoryName.toLowerCase();
            if (gestureName === "closed_fist") {
                handleClosedFist(hoveredElement, pointerX, pointerY, nowMs);
            } else {
                resetGestureState(hoveredElement);
            }
        } else {
            resetGestureState(hoveredElement);
        }

        // --- Debug Overlay (if enabled) ---
        if (DEBUG) {
            updateDebugOverlay(detections);
        }
    }

    window.requestAnimationFrame(predictWebcam);
}

// --- Main Function ---
async function main() {
    await setupCamera();
    await initializeModels();
    predictWebcam();
}

main().catch(console.error);
