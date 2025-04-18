import {
    FaceDetector,
    GestureRecognizer,
    FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";

// --- DOM Elements ---
const video = document.getElementById("webcam");
const timeoutOverlay = document.getElementById("timeoutOverlay");
const defaultScreen = document.getElementById("defaultScreen");
const questionnaireScreenA = document.getElementById("questionnaireScreenA");
const questionnaireScreenB = document.getElementById("questionnaireScreenB");
const questionnaireScreenC = document.getElementById("questionnaireScreenC");
const finalScreen = document.getElementById("finalScreen");
const outputScreen = document.getElementById("outputScreen");
const customCursor = document.getElementById("custom_cursor");
const loaderCursor = document.getElementById("loading_cursor");
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const userSelections = {
    era: null,           // from QuestionnaireScreenA
    destination: null,   // from QuestionnaireScreenB
    genre: null          // from QuestionnaireScreenC
};
const personaMapping = [
    // Q1: Era → Archetype
    {
        null: "Time Traveler",
        "Flourishing of Literature & Scriptures": "Sage",
        "Golden Age of Sculpture": "Artisan",
        "Revolution in Paintings": "Rebel",
        "Recent History of Wars & Protest": "Activist"
    },

    // Q2: Destination → Region Name
    {
        null: "Unknown",
        "Asia": "Jade Loop",
        "Africa": "Heat Zone",
        "Europe": "Gilded Bloc",
        "America": "Route Zero"
    },

    // Q3: Genre → Trope
    {
        null: "Soulwalking",
        "Identity-First Location": "Shapeshifting",
        "Fantasy & Magical Surrealistic World": "Cosmic Stoner",
        "Psychological Thriller": "Overclocked",
        "Romantic Drama": "Heartbroken"
    }
];


// --- Global Variables ---
let faceDetector, gestureRecognizer;
let runningMode = "VIDEO";

// Timeout values (in milliseconds)
const PRE_QUESTIONNAIRE_TIMEOUT = 1000; // 1 second before questionnaire appears (adjusted as needed)
const STEP_BACK_TIMEOUT = 12000;        // 12 seconds allowed to step back in questionnaire
const HOLD_TIMEOUT = 1300;

// Timers for tracking face presence in each state.
let stepBackStartTime = null;            // For questionnaire state

// Current active screen state.
let currentScreen = "defaultScreen"; // "defaultScreen", "questionnaireScreen", or "finalScreen"

// Current hovered element for gesture recognition.
let currentHoveredElement = null;

// Gesture click control variables
let isClicking = false;
let holdStartTime = null; // For tracking progress button hold time
let progress = 0; // Progress percentage for the progress bar

const canvas = document.getElementById('webcamCanvas');
const context = canvas.getContext('2d');

// Start capturing webcam footage

navigator.mediaDevices.getUserMedia({
    video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user" // front-facing webcam
    }
})
    .then(stream => {
        video.srcObject = stream;
        video.addEventListener('play', () => {
            function drawFrame() {
                context.save();
                context.scale(-1, 1); // Flip the video horizontally
                context.translate(-canvas.width, 0); // Adjust the canvas position
                context.drawImage(video, 0, 0, canvas.width, canvas.height);
                context.restore();
                requestAnimationFrame(drawFrame);
            }
            drawFrame();
        });
    })
    .catch(error => {
        console.error('Error accessing webcam:', error);
    });

function updateProgress() {
    if (progress < 100) {
        const increment = Math.floor(Math.random() * 20) + 5; // Random increment between 5 and 25
        progress = Math.min(progress + increment, 100); // Ensure it doesn't exceed 100
        progressBar.style.width = progress + '%';
        progressText.textContent = progress + '%';
        setTimeout(updateProgress, Math.random() * 500); // Random delay between updates
    }
    if (progress >= 100) {
        // Transition to the next screen after reaching 100%
        setTimeout(() => {
            transitionToNextWindow(4);
        }, 500); // Delay before transitioning
    }
}

function transitionTo(currentScreen) {
    [defaultScreen, questionnaireScreenA, questionnaireScreenB, questionnaireScreenC, finalScreen, outputScreen].forEach(screen => {
        screen.classList.remove("active");
    });

    setTimeout(() => {
        const targetScreen = document.getElementById(currentScreen);
        targetScreen.classList.add("active");
    }, 450); // Delay in milliseconds

    // Reset timers upon transition.
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
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: "user" // front-facing webcam
            }
        });
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

// Handles a closed_fist gesture based on the interactive element's type.
function handleClosedFist(hoveredElement, pointerX, pointerY, nowMs) {
    if (!hoveredElement || !hoveredElement.hasAttribute('data-gesture-type')) return;
    const gestureType = hoveredElement.getAttribute('data-gesture-type');
    if (isClicking) {
        return
    }
    if (gestureType === "instant") {
        if (!isClicking) {
            hoveredElement.click();
            isClicking = true;
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
            if (holdElapsed >= HOLD_TIMEOUT && !isClicking) {
                hoveredElement.click();
                if (progressBar) progressBar.style.width = "100%";
                isClicking = true;
                holdStartTime = null;
            }
        }
    }
}

// Resets the gesture state and (if needed) any visual progress.
function resetGestureState(hoveredElement) {
    holdStartTime = null;
    if (!isClicking) {
        if (hoveredElement && hoveredElement.hasAttribute('data-gesture-type')) {
            const gestureType = hoveredElement.getAttribute('data-gesture-type');
            if (gestureType === "progress") {
                let progressBar = hoveredElement.querySelector('.progressBar') ||
                    hoveredElement.querySelector('#progressBar');
                if (progressBar) progressBar.style.width = "0%";
            }
        }
    }
    isClicking = false;
    resetCursor();
}

function hoveredCursor() {
    customCursor.classList.add("hovered_cursor");

}

function clickedCursor() {
    customCursor.classList.add("clicked_cursor");
    loaderCursor.classList.add("animated_cursor");
}

function resetCursor() {
    customCursor.classList.remove("hovered_cursor");
    customCursor.classList.remove("clicked_cursor");
    loaderCursor.classList.remove("animated_cursor");
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
                // transitionTo("defaultScreen");
                transitionToNextWindow(5);
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
                customCursor.style.opacity = "1";
                customCursor.style.transform = "scale(1)";
            }
        }
        else {
            customCursor.style.opacity = "0";
            customCursor.style.transform = "scale(0)";
        }
        customCursor.style.left = (pointerX - customCursor.offsetWidth / 2) + "px";
        customCursor.style.top = (pointerY - customCursor.offsetHeight / 2) + "px";

        // --- Check for Interactive Element Under Pointer ---
        const hoveredElement = document.elementFromPoint(pointerX, pointerY);
        if (hoveredElement && hoveredElement.hasAttribute('data-gesture-type')) {
            
            // If a new interactive element is hovered, update the hover class.
            if (currentHoveredElement !== hoveredElement) {
                // Remove the 'hovered' class from the previous element, if any.
                if (currentHoveredElement) {
                    currentHoveredElement.classList.remove("hovered");
                }
                // Add the 'hovered' class to the new element.
                hoveredCursor();
                hoveredElement.classList.add("hovered");
                // Update the stored element.
                currentHoveredElement = hoveredElement;
            }
        } else {
            
            // Remove the hover effect from the previously hovered element.
            if (currentHoveredElement) {
                currentHoveredElement.classList.remove("hovered");
                currentHoveredElement = null;
                resetCursor();
            }
        }

        // --- Process Closed-Fist Gesture ---
        if (gestureResult.gestures && gestureResult.gestures.length > 0) {
            const topGesture = gestureResult.gestures[0][0];
            const gestureName = topGesture.categoryName.toLowerCase();
            if (gestureName === "closed_fist") {
                clickedCursor();
                handleClosedFist(hoveredElement, pointerX, pointerY, nowMs);
            } else {
                resetGestureState(hoveredElement);
            }
        } else {
            resetGestureState(hoveredElement);
        }

    }

    window.requestAnimationFrame(predictWebcam);
}

// --- Loader Text ---
function showLoaderText() {
    var intervalID = window.setInterval(updateScreen, 200);
    var c = document.getElementById("console");

    var txt = [
        "INIT: CHRONO SYSTEM BOOT SEQUENCE STARTED...",
        "LOADING MODULE: TIME STREAM ENCRYPTOR v1.3...",
        "AUTHORIZING TIMECODE: 14-04-2057 REGISTERED...",
        "CALIBRATING TEMPORAL VECTORS: ALIGNMENT SUCCESS...",
        "WARNING: TEMPORAL ANOMALY DETECTED AT 12:34:56 TDT...",
        "RECONFIGURE: SETTING TIME WARP TO 1.5x SPEED...",
        "HANDSHAKE: CONNECTING TO QUANTUM ARCHIVE NODE...",
        "DECRYPTING CHRONO DATA: ACCESS GRANTED...",
        "SECURITY ALERT: TEMPORAL FIREWALL ACTIVATED...",
        "NOTICE: BACKUP TIMELINE SHIFT AVAILABLE...",
        "COMMAND: OPEN PORTAL TO EPOCH 2045...",
        "INITIATING: TIME TRAVELLER PROTOCOL 'DREAMSCAPE'...",
        "RECALL: MEMORY LOG 0x1934 - PREVIOUS JOURNEY DATA...",
        "TRACE: DETECTING STRAY TIME PARTICLES...",
        "ANALYSIS: TEMPORAL VELOCITY STABILIZED AT 0.998c...",
        "UPDATE: CHRONO LOG REGISTER 5-XY UPDATED...",
        "DEBUG: PHASE SHIFT CORRECTION COMPLETE...",
        "SYNC: CLOCKS SYNCHRONIZED WITH QUANTUM CORE...",
        "ERROR: TEMPORAL OFFSET REQUIRING MANUAL OVERRIDE...",
        "RESOLVE: INITIATING CONTINUUM RECALIBRATION...",
        "DATA STREAM: DOWNLOADING CHRONO HISTORICAL RECORDS...",
        "SCAN: DETECTING FUTURISTIC DATA NEXUS...",
        "AUTH: VALIDATING TIME KEYS - ACCEPTED...",
        "COMMAND: SET TRAJECTORY TO 2200 CE...",
        "SECURITY: ENABLE MULTI-FACTOR TEMPORAL AUTH...",
        "ALERT: TIME DISTORTION EVENT IMMINENT...",
        "MONITOR: TRACKING DECAY OF TEMPORAL PARTICLES...",
        "EXECUTE: RUNNING PHASE INVERSION SEQUENCE...",
        "STATUS: CHRONO COORDINATES LOCKED - READY...",
        "INFO: ACCESSING LEGACY ARCHIVE: 1984 DATA...",
        "INITIATING: TIME CAPSULE TRANSMISSION...",
        "EXECUTE: DEPLOYING HISTORY PATCH MODULE...",
        "COMMAND: REVERSE ENGINE - CALENDAR ALGORITHM...",
        "NOTICE: COMPRESSING TIMEFRAME INTO MINUTES...",
        "ALERT: DETECTED PARADOX CLUSTER AT TIMESTREAM NODE...",
        "PROTOCOL: DECOMPRESSION OF EVENT LOGS IN PROGRESS...",
        "DATA: RETRIEVING STATISTICS FROM CHRONO DATABASE...",
        "COMMAND: CALCULATING RISK FACTOR - HIGH...",
        "WARNING: POTENTIAL TIME LOOP IDENTIFIED...",
        "DEBUG: ENCODING FUTURE EVENT SIGNATURE...",
        "INIT: SENDING SIGNAL TO TEMPORAL ANCHOR 0xA2...",
        "LOG: TIMECODE SHIFT ARRIVED AT 03:00 AM EPOCH...",
        "COMMAND: EXECUTE 'HISTORICAL REWIND' SEQUENCE...",
        "NOTICE: SUB-QUANTUM FIELD READINGS NOMINAL...",
        "STATUS: TEMPORAL WINDOW OPEN - ACCESS GRANTED...",
        "SCAN: PREPARING CHRONO-REPLICATOR UNIT...",
        "INSTRUCTION: OVERRIDE SYSTEM CLOCK WITH RIFT KEY...",
        "DEBUG: CRITICAL TIMELINE PATCH MISSING...",
        "UPDATE: CHRONO REGISTERS SYNCHRONIZED AT 2.718x...",
        "VERIFY: ALIGNED WITH MULTIVERSE TIMECODE 2023...",
        "COMMAND: INITIATE TIME TRAVEL SUBROUTINE 'STEADY'...",
        "TRACE: DETECTING SUBLIMINAL TEMPORAL THREADS...",
        "ALERT: CRITICAL REGISTRY MALFUNCTION DETECTED...",
        "STATUS: TEMPORAL DOOR UNLOCKED - WELCOME...",
        "INSTRUCTION: RE-INSTATE QUANTUM TIME BUFFER...",
        "LOAD: TIME PORT PARAMETERS: OFFSET: +0.0049sec...",
        "ALERT: PERCEIVED TIME STATISTICS VARIED - INCONGRUENT...",
        "DEBUG: STREAMING TIMECODE SEQUENCE INTERRUPTED...",
        "UPDATE: ECHOES OF TIME TRANSMITTED SUCCESSFULLY...",
        "NOTICE: TIME CRITICAL EVENT MARKER 'TEMPUS' REACHED...",
        "ALERT: TEMPORAL PARADOX BUFFER OVERFLOW...",
        "COMMAND: RESET TIME FRAME RECONSTRUCTION PROTOCOL...",
        "SCAN: SUBLUMINAL PARTICLE PATHWAY DETECTED...",
        "INFO: LINKING TIME NATURAL FREQ. WITH HISTORY NEXUS...",
        "INIT: TIME BLEND - FUTURE AND PAST INTEGRATED...",
        "DEBUG: ANALYZING HYPERCHAOS PATTERNS...",
        "NOTICE: ENCRYPTED EVENT MARKER 'NEXUS-9' RECEIVED...",
        "COMMAND: RUN MODULE: TEMPORAL DISPLACEMENT ACTUATOR...",
        "AUTH: SENDING QUANTUM PERMISSION TO TIME NODE...",
        "ALERT: EPOCH SHIFT DETECTED IN RIFT CORRIDOR...",
        "STATUS: BACKUP TIMECODE 'PHOENIX' INITIATED...",
        "SCAN: DETECTING ARCHAIC TIMELINES - MANUAL CHECK...",
        "LOADING: PRE-DEFINED CURVES FROM H. ST. CHRONOS...",
        "DEBUG: CALIBRATING DUAL TEMPORAL FRAMES...",
        "NOTICE: TIME STREAM PARTITION READY FOR ANALYSIS...",
        "COMMAND: DEPLOY VIRTUAL TIME GRAPH v0.9...",
        "INIT: CONNECTING TO MULTIVERSAL QUANTUM HUB...",
        "LOG: TIMECODE SYNCHRONIZATION DELAY: 0.004s...",
        "EXECUTE: ROUTE VERIFICATION - ALL PATHS CLEAR...",
        "ALERT: EXTERNAL TIME SIGNAL DETECTED AT 08:15...",
        "DEBUG: RUNNING CHRONO-DIAGNOSTIC ON MODULE L3-07...",
        "NOTICE: LEGACY DATA STREAM 'OLD WAVE' CONNECTED...",
        "STATUS: TIME DISTORTION STATIC RESOLVED...",
        "COMMAND: INIT 'TIME TWIST' EXECUTION MODULE...",
        "UPDATE: NEW TEMPORAL NODE 0xB19 ONLINE...",
        "SCAN: ANALYZING TIME RIFT MULTIPLICITY...",
        "DEBUG: RECORDING TIME ECHO FROM YEAR 1889...",
        "AUTH: VERIFY CHRONO CREDENTIALS COMPLETED...",
        "INFO: CALCULATED DESTINATION: 2345 AD...",
        "COMMAND: INITIATE FINAL TIME SHIFT PROTOCOL...",
        "NOTICE: TEMPORAL DATA STREAM ANALYSIS SUCCESS...",
        "LOG: FINAL CHECKPOINT 'ENTROPY 0' CLEARED...",
        "UPDATE: TIME FRAME 'PHASE SEVEN' READY FOR DEPLOYMENT...",
        "COMMAND: SYNC TIME CONTINUUM WITH HYPERLINK...",
        "DEBUG: MULTI-CHRONO CORE OPERATION INSTANTIATED...",
        "INFO: TIME CYCLE SEQUENCE 0012 - VALIDATED...",
        "ALERT: TEMPORAL REALIGNMENT NEEDED IN NODE 0xC22...",
        "COMMAND: EXECUTE QUICK REWIND CYCLE AT 12:00H...",
        "STATUS: FINAL SYSTEM CHECK COMPLETE - STANDBY...",
        "INIT: PREPARING TIME CRUX TRANSMISSION. JOURNEY READY..."
    ];


    var docfrag = document.createDocumentFragment();

    function updateScreen() {
        //Shuffle the "txt" array
        txt.push(txt.shift());
        //Rebuild document fragment
        txt.forEach(function (e) {
            var p = document.createElement("p");
            p.textContent = e;
            docfrag.appendChild(p);
        });
        //Clear DOM body
        while (c.firstChild) {
            c.removeChild(c.firstChild);
        }
        c.appendChild(docfrag);
    }
}

function toFileName(name) {
    return name?.toLowerCase().replace(/\s+/g, '_') + '.png';
}

function getPersonaText(era, destination, genre) {
    const [eraMap, regionMap, genreMap] = personaMapping;

    const archetype = eraMap[era];
    const origin = regionMap[destination];
    const trope = genreMap[genre];

    // Update text
    const text = `<span>You are the <span style="color: var(--neon-red)">${trope}</span> <span style="color: var(--neon-blue)">${archetype}</span> from the <span style="color: var(--neon-green)">${origin}</span>.</span>`;
    document.getElementById("outputText").innerHTML = text;

    // Update images
    document.getElementById("regionImg").src = `./avatar/${toFileName(origin)}`;
    document.getElementById("archetypeImg").src = `./avatar/${toFileName(archetype)}`;
    document.getElementById("tropeImg").src = `./avatar/${toFileName(trope)}`;

    return text;
}

function handleOptionClick(buttonElement, selectionType) {
    const activeScreen = document.querySelector('.screen.active');

    const activeOptions = activeScreen.querySelectorAll('button.option');
    activeOptions.forEach(option => option.classList.remove('selected'));

    buttonElement.classList.add('selected');

    userSelections[selectionType] = buttonElement.textContent.trim();

    console.log('Updated Selections:', userSelections);
}


// Transition to next window
function transitionToNextWindow(screenId) {
    if (screenId == 0) {
        transitionTo("questionnaireScreenA");
    }
    if (screenId == 1) {
        transitionTo("questionnaireScreenB");
    }
    if (screenId == 2) {
        transitionTo("questionnaireScreenC");
    }
    if (screenId == 3) {
        transitionTo("finalScreen");
        updateProgress(0)
    }
    if (screenId == 4) {
        const finalLine = getPersonaText(userSelections.era, userSelections.destination, userSelections.genre);
        document.getElementById("outputText").innerHTML = finalLine;
        transitionTo("outputScreen");
    }
    if (screenId == 5) {
        userSelections.era = null;
        userSelections.destination = null;
        userSelections.genre = null;

        const selectedOptions = document.querySelectorAll('.selected');
        selectedOptions.forEach(option => option.classList.remove('selected'));
        const hoveredOptions = document.querySelectorAll('.hovered');
        hoveredOptions.forEach(option => option.classList.remove('hovered'));

        progressBar.style.width = "0%";
        progressText.textContent = "0%";
        progress = 0;

        transitionTo("defaultScreen");
    }
}

// --- Main Function ---
async function main() {
    window.transitionToNextWindow = transitionToNextWindow;
    window.handleOptionClick = handleOptionClick;
    window.userSelections = userSelections;
    await setupCamera();
    await initializeModels();
    showLoaderText();
    predictWebcam();
}

main().catch(console.error);
