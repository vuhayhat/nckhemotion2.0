// DOM Elements
const multiCameraContainer = document.getElementById('multiCameraContainer');
const cameraList = document.getElementById('cameraList');
const startAllBtn = document.getElementById('startAllBtn');
const stopAllBtn = document.getElementById('stopAllBtn');
const emotionFilter = document.getElementById('emotionFilter');
const emotionStats = document.getElementById('emotionStats');
const detectionTable = document.getElementById('detectionTable');
const loginBtn = document.getElementById('loginBtn');
const addCameraBtn = document.getElementById('addCameraBtn');
const loginModal = document.getElementById('loginModal');
const addCameraModal = document.getElementById('addCameraModal');
const loginForm = document.getElementById('loginForm');
const addCameraForm = document.getElementById('addCameraForm');
const cameraTemplate = document.getElementById('cameraTemplate');

// WebSocket connection
let ws = null;

// Current state
let activeCameras = [];
let isLoggedIn = false;
let emotionCounts = {
    happy: 0,
    sad: 0,
    angry: 0,
    fear: 0,
    surprise: 0,
    neutral: 0,
    disgust: 0
};

// Connect to WebSocket
function connectWebSocket() {
    const clientId = 'client_' + Math.random().toString(36).substring(2, 9);
    const wsUrl = `ws://${window.location.hostname}:${window.location.port}/ws/${clientId}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            if (data.type === 'camera_list') {
                renderCameraList(data.cameras);
                renderCameraGrids(data.cameras);
            } else if (data.results) {
                // Process emotion detection results
                processResults(data);
            } else if (data.type === 'error') {
                console.error('Error from server:', data.message);
                updateCameraStatus(data.cameraId, `Error: ${data.message}`);
            } else if (data.type === 'camera_proxy') {
                // Handle camera proxy URL
                handleCameraProxy(data.cameraId, data.proxyUrl);
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected');
        // Try to reconnect after a delay
        setTimeout(connectWebSocket, 3000);
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

// Function to fetch camera list from backend
function fetchCameraList() {
    fetch('/api/cameras')
        .then(response => response.json())
        .then(cameras => {
            renderCameraList(cameras);
            renderCameraGrids(cameras);
        })
        .catch(error => {
            console.error('Error fetching camera list:', error);
            
            // Fallback if no cameras are available - add a default webcam
            if (!document.querySelector('.camera-item')) {
                const defaultCamera = {
                    id: 'default_webcam',
                    name: 'Default Webcam',
                    type: 'webcam',
                    url: ''
                };
                
                renderCameraList([defaultCamera]);
                renderCameraGrids([defaultCamera]);
            }
        });
}

// Render camera list in sidebar
function renderCameraList(cameras) {
    cameraList.innerHTML = '';
    
    if (!cameras || cameras.length === 0) {
        const noCamera = document.createElement('div');
        noCamera.className = 'camera-item';
        noCamera.textContent = 'No cameras available';
        cameraList.appendChild(noCamera);
        return;
    }
    
    cameras.forEach(camera => {
        const cameraItem = document.createElement('div');
        cameraItem.className = 'camera-item';
        cameraItem.dataset.id = camera.id;
        cameraItem.dataset.url = camera.url;
        cameraItem.dataset.type = camera.type;
        cameraItem.textContent = camera.name;
        
        cameraList.appendChild(cameraItem);
    });
}

// Render camera grids for all cameras
function renderCameraGrids(cameras) {
    multiCameraContainer.innerHTML = '';
    activeCameras = [];
    if (!cameras || cameras.length === 0) {
        const noCameraMsg = document.createElement('div');
        noCameraMsg.className = 'no-camera-message';
        noCameraMsg.textContent = 'No cameras available. Add a camera to get started.';
        multiCameraContainer.appendChild(noCameraMsg);
        return;
    }
    cameras.forEach(camera => {
        const cameraElement = createCameraElement(camera);
        multiCameraContainer.appendChild(cameraElement);
        activeCameras.push({ ...camera, element: cameraElement, isStreaming: false });
    });
}

// Create camera element from template
function createCameraElement(camera) {
    const template = cameraTemplate.content.cloneNode(true);
    const cameraBox = template.querySelector('.camera-box');
    cameraBox.dataset.id = camera.id;
    cameraBox.dataset.type = camera.type;
    cameraBox.dataset.url = camera.url || '';
    const titleElement = cameraBox.querySelector('.camera-title');
    titleElement.textContent = camera.name;
    const startBtn = cameraBox.querySelector('.start-btn');
    const stopBtn = cameraBox.querySelector('.stop-btn');
    const captureBtn = cameraBox.querySelector('.capture-btn');
    startBtn.addEventListener('click', () => startStream(camera.id));
    stopBtn.addEventListener('click', () => stopStream(camera.id));
    captureBtn.addEventListener('click', () => captureSingleFrame(camera.id));
    return cameraBox;
}

// Get camera by ID
function getCameraById(cameraId) {
    return activeCameras.find(cam => cam.id === cameraId);
}

// Get camera DOM element
function getCameraElement(cameraId) {
    return multiCameraContainer.querySelector(`.camera-box[data-id="${cameraId}"]`);
}

// Update camera status text
function updateCameraStatus(cameraId, statusText) {
    const cameraElement = getCameraElement(cameraId);
    if (cameraElement) {
        const statusElement = cameraElement.querySelector('.camera-status');
        if (statusElement) {
            statusElement.textContent = statusText;
        }
    }
}

// Start streaming for a specific camera
async function startStream(cameraId) {
    const camera = getCameraById(cameraId);
    const cameraElement = getCameraElement(cameraId);
    if (!camera || !cameraElement) return;
    const videoElement = cameraElement.querySelector('.video-element');
    const startBtn = cameraElement.querySelector('.start-btn');
    const stopBtn = cameraElement.querySelector('.stop-btn');
    // Remove old feeds
    const oldImg = cameraElement.querySelector('.ip-camera-feed');
    if (oldImg) oldImg.remove();
    videoElement.style.display = '';
    try {
        if (camera.type === 'webcam') {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            videoElement.srcObject = stream;
            camera.stream = stream;
            camera.isStreaming = true;
            startBtn.disabled = true;
            stopBtn.disabled = false;
            updateCameraStatus(cameraId, 'Streaming...');
        } else if (camera.type === 'ip_camera') {
            // Hide video element, show image element for IP camera
            videoElement.style.display = 'none';
            
            // Create img element for IP camera feed
            const img = document.createElement('img');
            img.className = 'ip-camera-feed';
            img.src = camera.url;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'contain';
            
            // Add timestamp to prevent caching
            if (img.src.indexOf('?') === -1) {
                img.src += '?t=' + new Date().getTime();
            } else {
                img.src += '&t=' + new Date().getTime();
            }
            
            // Insert image after video element
            videoElement.parentNode.insertBefore(img, videoElement.nextSibling);
            
            // Set up periodic refresh for MJPEG feeds
            const refreshRate = 1000; // 1 second
            camera.refreshInterval = setInterval(() => {
                if (img && img.parentNode) {
                    // Update timestamp to get fresh image
                    const timestamp = new Date().getTime();
                    if (img.src.indexOf('?') === -1) {
                        img.src = camera.url + '?t=' + timestamp;
                    } else {
                        img.src = camera.url.split(/[?&]t=/)[0] + 
                               (camera.url.indexOf('?') === -1 ? '?' : '&') + 
                               't=' + timestamp;
                    }
                } else {
                    // Clear interval if image is no longer in DOM
                    clearInterval(camera.refreshInterval);
                }
            }, refreshRate);
            
            camera.isStreaming = true;
            startBtn.disabled = true;
            stopBtn.disabled = false;
            updateCameraStatus(cameraId, 'Streaming IP camera...');
        }
    } catch (error) {
        updateCameraStatus(cameraId, `Error: ${error.message}`);
    }
}

// Stop streaming for a specific camera
function stopStream(cameraId) {
    const camera = getCameraById(cameraId);
    const cameraElement = getCameraElement(cameraId);
    if (!camera || !cameraElement) return;
    const videoElement = cameraElement.querySelector('.video-element');
    const startBtn = cameraElement.querySelector('.start-btn');
    const stopBtn = cameraElement.querySelector('.stop-btn');
    
    // Stop webcam stream if exists
    if (camera.stream) {
        camera.stream.getTracks().forEach(track => track.stop());
        camera.stream = null;
        videoElement.srcObject = null;
    }
    
    // Stop IP camera refresh interval if exists
    if (camera.refreshInterval) {
        clearInterval(camera.refreshInterval);
        camera.refreshInterval = null;
    }
    
    // Remove IP camera feed image if exists
    const ipCameraFeed = cameraElement.querySelector('.ip-camera-feed');
    if (ipCameraFeed) ipCameraFeed.remove();
    
    videoElement.style.display = '';
    camera.isStreaming = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    updateCameraStatus(cameraId, 'Stopped');
}

// Start all camera streams
function startAllStreams() {
    activeCameras.forEach(camera => {
        if (!camera.isStreaming) {
            startStream(camera.id);
        }
    });
}

// Stop all camera streams
function stopAllStreams() {
    activeCameras.forEach(camera => {
        if (camera.isStreaming) {
            stopStream(camera.id);
        }
    });
}

// Capture frames from webcam and send to server
function captureFrames(cameraId) {
    const camera = getCameraById(cameraId);
    const cameraElement = getCameraElement(cameraId);
    
    if (!camera || !camera.isStreaming || !camera.stream || !cameraElement) return;
    
    const videoElement = cameraElement.querySelector('.video-element');
    const canvas = cameraElement.querySelector('.overlay-canvas');
    const ctx = canvas.getContext('2d');
    
    // Set canvas dimensions to match video
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    
    // Capture frame from video
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    
    // Convert canvas to base64 image
    const frameData = canvas.toDataURL('image/jpeg', 0.8);
    
    // Send to server via WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'frame',
            cameraId: camera.id,
            frame: frameData
        }));
    }
    
    // Schedule next frame capture (aim for about 1-2 FPS to reduce load)
    setTimeout(() => captureFrames(cameraId), 500);
}

// Process emotion detection results
function processResults(data) {
    if (!data.results || data.results.length === 0 || !data.camera_id) return;
    
    const cameraId = data.camera_id;
    const cameraElement = getCameraElement(cameraId);
    
    if (!cameraElement) return;
    
    const camera = getCameraById(cameraId);
    if (!camera) return;
    
    // Find the element to draw on
    const canvas = cameraElement.querySelector('.overlay-canvas');
    const ctx = canvas.getContext('2d');
    
    // Get the target element for dimensions
    let targetElement = cameraElement.querySelector('.video-element');
    const ipCameraFeed = cameraElement.querySelector('.ip-camera-feed');
    
    if (ipCameraFeed && camera.type === 'ip_camera') {
        targetElement = ipCameraFeed;
    }
    
    // Set canvas dimensions to match the target element
    canvas.width = targetElement.clientWidth;
    canvas.height = targetElement.clientHeight;
    
    // Clear previous drawings
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw face rectangles and emotion labels
    data.results.forEach(face => {
        const { x, y, width, height } = face.face_location;
        const emotion = face.emotion;
        const confidence = Math.round(face.confidence * 100);
        
        // Draw rectangle around face
        ctx.strokeStyle = getEmotionColor(emotion);
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width, height);
        
        // Draw emotion label
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(x, y - 25, width, 25);
        ctx.fillStyle = getEmotionColor(emotion);
        ctx.font = '16px Arial';
        ctx.fillText(`${emotion} (${confidence}%)`, x + 5, y - 7);
        
        // Update emotion counts
        emotionCounts[emotion] = (emotionCounts[emotion] || 0) + 1;
    });
    
    // Update statistics
    updateEmotionStats();
    
    // Add to detection history
    addDetectionToHistory(data);
    
    // Update status
    updateCameraStatus(cameraId, `${data.results.length} face(s) detected`);
}

// Get color for emotion
function getEmotionColor(emotion) {
    const colors = {
        happy: '#2ecc71',
        sad: '#3498db',
        angry: '#e74c3c',
        fear: '#9b59b6',
        surprise: '#f39c12',
        neutral: '#95a5a6',
        disgust: '#27ae60'
    };
    
    return colors[emotion] || '#ffffff';
}

// Update emotion statistics display
function updateEmotionStats() {
    emotionStats.innerHTML = '';
    
    Object.keys(emotionCounts).forEach(emotion => {
        if (emotionFilter.value === 'all' || emotionFilter.value === emotion) {
            const statItem = document.createElement('div');
            statItem.className = 'emotion-stat';
            
            const count = document.createElement('div');
            count.className = 'count';
            count.textContent = emotionCounts[emotion];
            
            const label = document.createElement('div');
            label.className = 'label';
            label.textContent = emotion.charAt(0).toUpperCase() + emotion.slice(1);
            
            statItem.appendChild(count);
            statItem.appendChild(label);
            emotionStats.appendChild(statItem);
        }
    });
}

// Reset emotion statistics
function resetEmotionStats() {
    Object.keys(emotionCounts).forEach(emotion => {
        emotionCounts[emotion] = 0;
    });
    updateEmotionStats();
    detectionTable.innerHTML = '';
}

// Add detection to history table
function addDetectionToHistory(data) {
    if (!data.results || data.results.length === 0) return;
    
    const timestamp = new Date(data.timestamp * 1000);
    const cameraName = getCameraById(data.camera_id)?.name || data.camera_id;
    
    data.results.forEach(face => {
        if (emotionFilter.value === 'all' || emotionFilter.value === face.emotion) {
            const row = document.createElement('tr');
            
            const timeCell = document.createElement('td');
            timeCell.textContent = timestamp.toLocaleTimeString();
            
            const cameraCell = document.createElement('td');
            cameraCell.textContent = cameraName;
            
            const emotionCell = document.createElement('td');
            emotionCell.textContent = face.emotion;
            emotionCell.style.color = getEmotionColor(face.emotion);
            
            const confidenceCell = document.createElement('td');
            confidenceCell.textContent = `${Math.round(face.confidence * 100)}%`;
            
            row.appendChild(timeCell);
            row.appendChild(cameraCell);
            row.appendChild(emotionCell);
            row.appendChild(confidenceCell);
            
            // Add to top of table
            if (detectionTable.firstChild) {
                detectionTable.insertBefore(row, detectionTable.firstChild);
            } else {
                detectionTable.appendChild(row);
            }
            
            // Limit table size
            if (detectionTable.children.length > 50) {
                detectionTable.removeChild(detectionTable.lastChild);
            }
        }
    });
}

// Capture a single frame
function captureSingleFrame(cameraId) {
    const camera = getCameraById(cameraId);
    const cameraElement = getCameraElement(cameraId);
    if (!camera || !cameraElement) return;
    if (camera.type === 'webcam') {
        const videoElement = cameraElement.querySelector('.video-element');
        const canvas = cameraElement.querySelector('.overlay-canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        const frameData = canvas.toDataURL('image/jpeg', 0.8);
        // Gửi frameData lên backend nếu cần
    } else if (camera.type === 'ip_camera') {
        const img = cameraElement.querySelector('.ip-camera-feed');
        if (!img) return;
        const canvas = cameraElement.querySelector('.overlay-canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const frameData = canvas.toDataURL('image/jpeg', 0.8);
        // Gửi frameData lên backend nếu cần
    }
}

// Show modal
function showModal(modal) {
    modal.classList.add('active');
}

// Hide modal
function hideModal(modal) {
    modal.classList.remove('active');
}

// Handle camera proxy URL from server
function handleCameraProxy(cameraId, proxyUrl) {
    const cameraElement = getCameraElement(cameraId);
    if (!cameraElement) return;
    
    const ipCameraFeed = cameraElement.querySelector('.ip-camera-feed');
    if (ipCameraFeed) {
        const camera = getCameraById(cameraId);
        if (!camera) return;
        
        // Use the proxy URL instead of the direct camera URL
        const fullProxyUrl = `${window.location.origin}${proxyUrl}`;
        
        // Clear any existing interval
        if (camera.refreshInterval) {
            clearInterval(camera.refreshInterval);
        }
        
        // Set up periodic refresh for the image with the proxy URL
        let timestamp = Date.now();
        ipCameraFeed.src = `${fullProxyUrl}?t=${timestamp}`;
        
        // Refresh the image every 100ms
        camera.refreshInterval = setInterval(() => {
            if (!camera.isStreaming) {
                clearInterval(camera.refreshInterval);
                return;
            }
            timestamp = Date.now();
            ipCameraFeed.src = `${fullProxyUrl}?t=${timestamp}`;
        }, 100);
        
        console.log(`Using proxy URL for camera ${cameraId}: ${fullProxyUrl}`);
    }
}

// Initialize app
function init() {
    // Connect to WebSocket
    connectWebSocket();
    
    // Fetch camera list from backend
    fetchCameraList();
    
    // Add event listeners for global controls
    startAllBtn.addEventListener('click', startAllStreams);
    stopAllBtn.addEventListener('click', stopAllStreams);
    
    emotionFilter.addEventListener('change', updateEmotionStats);
    
    loginBtn.addEventListener('click', () => showModal(loginModal));
    addCameraBtn.addEventListener('click', () => showModal(addCameraModal));
    
    // Close buttons for modals
    document.querySelectorAll('.close').forEach(closeBtn => {
        closeBtn.addEventListener('click', () => {
            hideModal(loginModal);
            hideModal(addCameraModal);
        });
    });
    
    // Handle login form submission
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        
        // Implement login logic here
        // For demo, just accept admin/admin
        if (username === 'admin' && password === 'admin') {
            isLoggedIn = true;
            loginBtn.textContent = 'Logout';
            hideModal(loginModal);
            alert('Logged in successfully!');
        } else {
            alert('Invalid credentials!');
        }
    });
    
    // Handle add camera form submission
    addCameraForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const cameraName = document.getElementById('cameraName').value;
        const cameraType = document.getElementById('cameraType').value;
        let cameraUrl = document.getElementById('cameraUrl').value;
        
        // Ensure URL for IP camera is properly formatted
        if (cameraType === 'ip_camera' && cameraUrl) {
            // Make sure URL ends with /video for IP Webcam cameras
            if (cameraUrl.endsWith('/') && !cameraUrl.endsWith('/video/')) {
                cameraUrl += 'video';
            } else if (!cameraUrl.endsWith('/video') && !cameraUrl.includes('/video?')) {
                // If URL doesn't end with /video and doesn't contain /video? (for query params)
                if (cameraUrl.includes('?')) {
                    // If URL already has query parameters
                    const urlParts = cameraUrl.split('?');
                    cameraUrl = urlParts[0];
                    if (!cameraUrl.endsWith('/')) cameraUrl += '/';
                    cameraUrl += 'video?' + urlParts[1];
                } else {
                    // No query parameters
                    if (!cameraUrl.endsWith('/')) cameraUrl += '/';
                    cameraUrl += 'video';
                }
            }
        }
        
        // Generate a unique ID
        const cameraId = 'cam_' + Math.random().toString(36).substring(2, 9);
        
        // Add camera to list
        const camera = {
            id: cameraId,
            name: cameraName,
            type: cameraType,
            url: cameraType === 'ip_camera' ? cameraUrl : ''
        };
        
        try {
            // Send to backend API to save in database
            const response = await fetch('/api/cameras', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(camera)
            });
            
            const result = await response.json();
            
            if (result.success) {
                // Fetch updated camera list from backend
                fetchCameraList();
                hideModal(addCameraModal);
                
                // Find the new camera in the list and select it
                setTimeout(() => {
                    const cameraItems = document.querySelectorAll('.camera-item');
                    for (const item of cameraItems) {
                        if (item.dataset.id === result.camera_id || item.dataset.id === cameraId) {
                            item.click();
                            break;
                        }
                    }
                }, 500);
            } else {
                alert('Failed to add camera: ' + (result.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error adding camera:', error);
            alert('Failed to add camera: ' + error.message);
            
            // Fallback to local UI update if server communication fails
            const currentCameras = activeCameras.map(c => ({
                id: c.id,
                name: c.name,
                type: c.type,
                url: c.url || ''
            }));
            
            currentCameras.push(camera);
            renderCameraList(currentCameras);
            renderCameraGrids(currentCameras);
            hideModal(addCameraModal);
        }
    });
    
    // Show/hide IP camera URL field based on camera type
    document.getElementById('cameraType').addEventListener('change', (e) => {
        const ipUrlGroup = document.getElementById('ipUrlGroup');
        ipUrlGroup.style.display = e.target.value === 'ip_camera' ? 'block' : 'none';
    });
    
    // Initialize IP camera URL field visibility
    document.getElementById('ipUrlGroup').style.display = 
        document.getElementById('cameraType').value === 'ip_camera' ? 'block' : 'none';
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', init); 