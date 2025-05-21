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
const mobileConnectBtn = document.getElementById('mobileConnectBtn');
const loginModal = document.getElementById('loginModal');
const addCameraModal = document.getElementById('addCameraModal');
const mobileConnectModal = document.getElementById('mobileConnectModal');
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
    disgust: 0,
    contempt: 0,
    confused: 0,
    calm: 0
};

// Mobile connection variables
let mobileConnectionId = null;
let qrCodeRendered = false;

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
            } else if (data.type === 'emotion_results') {
                // Process emotion detection results
                processResults(data);
            } else if (data.type === 'error') {
                console.error('Error from server:', data.message);
                if (data.camera_id) {
                    updateCameraStatus(data.camera_id, `Error: ${data.message}`);
                }
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
            updateCameraStatus(cameraId, 'Streaming webcam...');
            
            // Start capturing frames for emotion detection
            // Wait a bit for video to initialize before starting capture
            setTimeout(() => {
                startCaptureFrames(cameraId);
            }, 1000);
        } else if (camera.type === 'ip_camera') {
            // Hide video element, show image element for IP camera
            videoElement.style.display = 'none';
            
            // Create img element for IP camera feed
            const img = document.createElement('img');
            img.className = 'ip-camera-feed';
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'contain';
            img.crossOrigin = 'Anonymous'; // For CORS handling
            
            // Show loading state
            updateCameraStatus(cameraId, 'Connecting to IP camera...');
            
            // Direct connection to camera URL without proxy
            const connectToCamera = () => {
                console.log(`Connecting directly to camera: ${camera.url}`);
                updateCameraStatus(cameraId, 'Connecting directly...');
                
                // Add timestamp to avoid caching
                const timestamp = Date.now();
                const cameraUrl = camera.url.includes('?') 
                    ? `${camera.url}&t=${timestamp}` 
                    : `${camera.url}?t=${timestamp}`;
                
                // Set the source directly
                img.src = cameraUrl;
            };
            
            // Handle successful image load
            img.onload = () => {
                console.log(`Successfully connected to IP camera: ${camera.url}`);
                updateCameraStatus(cameraId, 'IP camera connected');
                
                // Log actual image dimensions for debugging
                console.log(`Image dimensions: ${img.naturalWidth}x${img.naturalHeight}`);
            };
            
            // Handle image load error
            img.onerror = () => {
                console.error(`Cannot load image from IP camera: ${camera.url}`);
                updateCameraStatus(cameraId, 'Error connecting to camera');
                
                // Try HTTP if HTTPS fails or vice versa
                if (camera.url.startsWith('https://') && !img.src.includes('http://')) {
                    console.log('Trying HTTP instead of HTTPS...');
                    const httpUrl = camera.url.replace('https://', 'http://');
                    const timestamp = Date.now();
                    img.src = httpUrl.includes('?') ? `${httpUrl}&t=${timestamp}` : `${httpUrl}?t=${timestamp}`;
                    return;
                } else if (camera.url.startsWith('http://') && !img.src.includes('https://')) {
                    console.log('Trying HTTPS instead of HTTP...');
                    const httpsUrl = camera.url.replace('http://', 'https://');
                    const timestamp = Date.now();
                    img.src = httpsUrl.includes('?') ? `${httpsUrl}&t=${timestamp}` : `${httpsUrl}?t=${timestamp}`;
                    return;
                }
                
                // If all methods failed, show error image
                img.src = `data:image/svg+xml;charset=UTF-8,%3Csvg%20width%3D%22400%22%20height%3D%22300%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22%23000%22%2F%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2240%25%22%20font-size%3D%2220%22%20text-anchor%3D%22middle%22%20dominant-baseline%3D%22middle%22%20fill%3D%22%23f44336%22%3ECannot%20connect%20to%20camera%3C%2Ftext%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2255%25%22%20font-size%3D%2214%22%20text-anchor%3D%22middle%22%20dominant-baseline%3D%22middle%22%20fill%3D%22%23fff%22%3EConnection%20error%3C%2Ftext%3E%3C%2Fsvg%3E`;
                
                // Add "Check URL" button
                const checkUrlBtn = document.createElement('button');
                checkUrlBtn.className = 'btn';
                checkUrlBtn.innerHTML = '<i class="fas fa-external-link-alt"></i> Check Camera URL';
                checkUrlBtn.onclick = () => {
                    window.open(camera.url, '_blank');
                };
                const controlsContainer = cameraElement.querySelector('.camera-controls');
                if (controlsContainer.querySelector('.check-url-btn') === null) {
                    controlsContainer.appendChild(checkUrlBtn);
                }
                
                // Add "Edit URL" button
                const editUrlBtn = document.createElement('button');
                editUrlBtn.className = 'btn';
                editUrlBtn.innerHTML = '<i class="fas fa-edit"></i> Edit Camera URL';
                editUrlBtn.onclick = () => {
                    const newUrl = prompt('Enter new camera URL:', camera.url);
                    if (newUrl && newUrl !== camera.url) {
                        updateCameraUrl(cameraId, newUrl);
                    }
                };
                if (controlsContainer.querySelector('.edit-url-btn') === null) {
                    controlsContainer.appendChild(editUrlBtn);
                }
            };
            
            // Add image to DOM
            videoElement.parentNode.insertBefore(img, videoElement.nextSibling);
            
            // Start connection
            connectToCamera();
            
            // Setup auto-refresh for the image
            camera.refreshInterval = setInterval(() => {
                if (img && img.parentNode) {
                    // If not an error image, refresh
                    if (!img.src.startsWith('data:image/svg+xml')) {
                        // Add timestamp to URL to avoid caching
                        const timestamp = Date.now();
                        if (img.src.indexOf('?') !== -1) {
                            // Extract base URL without timestamp
                            const baseUrl = img.src.split(/[?&]t=/)[0];
                            img.src = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}t=${timestamp}`;
                        } else {
                            img.src = `${img.src}?t=${timestamp}`;
                        }
                    }
                } else {
                    // Remove interval if image no longer in DOM
                    clearInterval(camera.refreshInterval);
                    camera.refreshInterval = null;
                }
            }, 1000); // Refresh every second
            
            // Update state
            camera.isStreaming = true;
            startBtn.disabled = true;
            stopBtn.disabled = false;
            
            // Start frame capture after 2 seconds (to ensure image is loaded)
            setTimeout(() => {
                startCaptureFrames(cameraId);
            }, 2000);
        }
    } catch (error) {
        console.error(`Error starting camera ${cameraId}:`, error);
        updateCameraStatus(cameraId, `Error: ${error.message}`);
    }
}

// Hàm cập nhật URL camera trong cơ sở dữ liệu
async function updateCameraUrl(cameraId, newUrl) {
    try {
        // Hiển thị trạng thái đang cập nhật
        updateCameraStatus(cameraId, 'Đang cập nhật URL camera...');
        
        // Lấy thông tin camera hiện tại
        const camera = getCameraById(cameraId);
        if (!camera) {
            throw new Error('Không tìm thấy camera');
        }
        
        // Tạo dữ liệu cập nhật
        const updateData = {
            id: cameraId,
            name: camera.name,
            type: camera.type,
            url: newUrl
        };
        
        // Gửi yêu cầu cập nhật lên server
        const response = await fetch('/api/update-camera', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(updateData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            // Cập nhật URL trong đối tượng camera
            camera.url = newUrl;
            
            // Thông báo thành công
            updateCameraStatus(cameraId, 'URL đã được cập nhật, đang kết nối lại...');
            
            // Khởi động lại camera
            stopStream(cameraId);
            setTimeout(() => {
                startStream(cameraId);
            }, 1000);
        } else {
            updateCameraStatus(cameraId, `Lỗi cập nhật URL: ${result.error}`);
        }
    } catch (error) {
        console.error('Lỗi cập nhật URL camera:', error);
        updateCameraStatus(cameraId, `Lỗi cập nhật URL: ${error.message}`);
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
    
    // Stop frame capture interval if exists
    if (camera.captureInterval) {
        clearInterval(camera.captureInterval);
        camera.captureInterval = null;
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

// Start capturing frames from a camera at regular intervals
function startCaptureFrames(cameraId) {
    const camera = getCameraById(cameraId);
    if (!camera || !camera.isStreaming) return;
    
    // Clear existing interval if any
    if (camera.captureInterval) {
        clearInterval(camera.captureInterval);
    }
    
    // Set interval to capture frames every 4 seconds
    camera.captureInterval = setInterval(() => {
        if (camera.type === 'webcam') {
            captureAndSendFrame(cameraId);
        } else if (camera.type === 'ip_camera') {
            captureAndSendIPCameraFrame(cameraId); // Sử dụng hàm mới cho camera IP
        }
    }, 4000); // 4 seconds
    
    // Capture first frame immediately
    if (camera.type === 'webcam') {
        captureAndSendFrame(cameraId);
    } else if (camera.type === 'ip_camera') {
        captureAndSendIPCameraFrame(cameraId);
    }
    
    console.log(`Started frame capture for camera ${cameraId} at 4-second intervals`);
}

// Capture a frame from camera and send to backend
function captureAndSendFrame(cameraId) {
    const camera = getCameraById(cameraId);
    const cameraElement = getCameraElement(cameraId);
    
    if (!camera || !camera.isStreaming || !cameraElement) return;
    
    try {
        const canvas = cameraElement.querySelector('.overlay-canvas');
        const ctx = canvas.getContext('2d');
        
        // Get source element (video or image) based on camera type
        let sourceElement;
        if (camera.type === 'webcam') {
            sourceElement = cameraElement.querySelector('.video-element');
            if (!sourceElement || !sourceElement.videoWidth) {
                console.log('Video not ready yet, skipping frame');
                return; // Video not ready
            }
            
            // Set canvas dimensions to match video
            canvas.width = sourceElement.videoWidth;
            canvas.height = sourceElement.videoHeight;
        } else if (camera.type === 'ip_camera') {
            sourceElement = cameraElement.querySelector('.ip-camera-feed');
            if (!sourceElement || !sourceElement.complete || !sourceElement.naturalWidth) {
                console.log('IP camera image not loaded yet, skipping frame');
                return; // Image not loaded
            }
            
            // Đảm bảo có ảnh mới nhất từ camera IP trước khi chụp
            // Tạo một timestamp mới để tránh cache
            const timestamp = new Date().getTime();
            
            // Debug thông tin ảnh IP camera
            console.log(`IP Camera ${cameraId} - Dimensions: ${sourceElement.naturalWidth}x${sourceElement.naturalHeight}`);
            
            // Đánh dấu là đang xử lý frame
            updateCameraStatus(cameraId, `Đang xử lý ảnh... (${new Date().toLocaleTimeString()})`);
            
            // Đặt kích thước canvas theo ảnh thực tế
            canvas.width = sourceElement.naturalWidth || sourceElement.width || 640;
            canvas.height = sourceElement.naturalHeight || sourceElement.height || 480;
            
            // Tạo một ảnh mới từ IP camera để đảm bảo đã load xong
            const newImg = new Image();
            newImg.crossOrigin = "Anonymous"; // Thêm để xử lý vấn đề CORS
            
            // Gắn sự kiện để đảm bảo ảnh đã load xong
            newImg.onload = () => {
                // Vẽ ảnh mới lên canvas
                ctx.drawImage(newImg, 0, 0, canvas.width, canvas.height);
                
                // Kiểm tra xem canvas có dữ liệu không
                try {
                    // Thử lấy dữ liệu từ canvas để kiểm tra
                    const pixelData = ctx.getImageData(0, 0, 10, 10);
                    console.log(`Canvas data available: ${pixelData.data.length > 0}`);
                    
                    // Kiểm tra xem ảnh có phải là ảnh đen không
                    let isBlackImage = true;
                    for (let i = 0; i < pixelData.data.length; i += 4) {
                        // Check if pixel has some color (not black)
                        if (pixelData.data[i] > 5 || pixelData.data[i+1] > 5 || pixelData.data[i+2] > 5) {
                            isBlackImage = false;
                            break;
                        }
                    }
                    
                    if (isBlackImage) {
                        console.warn("Detected black image from IP camera, trying alternate method");
                        
                        // Try an alternate approach - create a temporary image element
                        const tempImg = new Image();
                        tempImg.crossOrigin = "Anonymous";
                        
                        // Use a proxy URL for the image to avoid CORS issues
                        fetch(`/api/camera-frame-proxy?url=${encodeURIComponent(sourceElement.src)}&nocache=${Date.now()}`)
                            .then(response => response.blob())
                            .then(blob => {
                                const blobUrl = URL.createObjectURL(blob);
                                tempImg.onload = function() {
                                    // Draw this image to canvas
                                    ctx.drawImage(tempImg, 0, 0, canvas.width, canvas.height);
                                    const frameData = canvas.toDataURL('image/jpeg', 0.85);
                                    sendFrameToServer(cameraId, camera, frameData);
                                    URL.revokeObjectURL(blobUrl); // Clean up
                                };
                                tempImg.src = blobUrl;
                            })
                            .catch(err => {
                                console.error("Error with proxy method:", err);
                                updateCameraStatus(cameraId, `Lỗi tải ảnh: ${err.message}`);
                            });
                        return;
                    }
                } catch (e) {
                    console.error(`Canvas error: ${e.message}`);
                }
                
                // Chuyển canvas thành ảnh và gửi lên server
                try {
                    const frameData = canvas.toDataURL('image/jpeg', 0.85);
                    sendFrameToServer(cameraId, camera, frameData);
                } catch (toDataURLError) {
                    console.error(`Error converting canvas to image: ${toDataURLError.message}`);
                    updateCameraStatus(cameraId, `Lỗi chuyển đổi ảnh: ${toDataURLError.message}`);
                }
            };
            
            // Xử lý lỗi khi load ảnh
            newImg.onerror = (e) => {
                console.error(`Error loading IP camera image: ${e}`);
                updateCameraStatus(cameraId, `Không thể tải ảnh từ camera IP`);
            };
            
            // Thử tải ảnh từ camera và xử lý cả HTTP và HTTPS
            const ipCameraUrl = sourceElement.src;
            if (ipCameraUrl) {
                // Tạo URL mới với timestamp để tránh cache
                const refreshedUrl = ipCameraUrl.split(/[?&]t=/)[0] + 
                    (ipCameraUrl.indexOf('?') === -1 ? '?' : '&') + 't=' + timestamp;
                
                // Gán URL cho ảnh mới
                newImg.src = refreshedUrl;
                console.log(`Loading new image from: ${refreshedUrl}`);
            } else {
                console.error(`IP camera URL missing for ${cameraId}`);
                updateCameraStatus(cameraId, `Lỗi: URL camera không hợp lệ`);
                return;
            }
            
            // Tạo thông báo đang chụp ảnh trên giao diện
            const processingIndicator = document.createElement('div');
            processingIndicator.className = 'processing-indicator';
            processingIndicator.innerHTML = '<span>Đang chụp</span>';
            cameraElement.querySelector('.video-wrapper').appendChild(processingIndicator);
            
            // Sau 1 giây, ẩn thông báo
            setTimeout(() => {
                if (processingIndicator.parentNode) {
                    processingIndicator.parentNode.removeChild(processingIndicator);
                }
            }, 1000);
            
            // Đã chuyển việc gửi frame lên server vào hàm callback onload của ảnh
            return;
        }
        
        if (!sourceElement) return;
        
        // Draw the current frame to canvas
        ctx.drawImage(sourceElement, 0, 0, canvas.width, canvas.height);
        
        // Convert canvas to base64 image
        const frameData = canvas.toDataURL('image/jpeg', 0.85);
        
        // Gửi frame lên server (chỉ cho webcam, IP camera được xử lý riêng ở trên)
        sendFrameToServer(cameraId, camera, frameData);
    } catch (error) {
        console.error(`Error capturing frame from camera ${cameraId}:`, error);
        updateCameraStatus(cameraId, `Lỗi chụp ảnh: ${error.message}`);
    }
}

// Hàm tách riêng để gửi frame lên server
function sendFrameToServer(cameraId, camera, frameData) {
    // Get current timestamp
    const timestamp = Math.floor(Date.now() / 1000);
    
    // Lấy tham chiếu đến camera element
    const cameraElement = getCameraElement(cameraId);
    if (!cameraElement) {
        console.error(`Cannot find camera element for ${cameraId}`);
        return;
    }
    
    // Display status
    updateCameraStatus(cameraId, `Đang xử lý... (${new Date().toLocaleTimeString()})`);
    
    // Check if frameData is valid
    if (!frameData || frameData.length < 100) {
        console.error(`Invalid frame data for camera ${cameraId}`);
        updateCameraStatus(cameraId, `Lỗi: Dữ liệu ảnh không hợp lệ`);
        return;
    }
    
    // Add debugging - Log the size of the frame data
    console.log(`Sending frame from ${camera.type} camera ${cameraId}, data length: ${frameData.length}`);
    
    // Send to server via WebSocket if connected
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'frame',
            cameraId: camera.id,
            cameraName: camera.name,
            timestamp: timestamp,
            frame: frameData
        }));
    } else {
        // WebSocket not connected, use HTTP API instead
        const frameMetadata = {
            width: camera.type === 'webcam' ? 
                cameraElement.querySelector('.video-element').videoWidth : 
                cameraElement.querySelector('.ip-camera-feed').naturalWidth,
            height: camera.type === 'webcam' ? 
                cameraElement.querySelector('.video-element').videoHeight : 
                cameraElement.querySelector('.ip-camera-feed').naturalHeight,
            cameraType: camera.type
        };
        
        fetch('/api/process_frame', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                client_id: 'http_client',
                camera_id: camera.id,
                camera_name: camera.name,
                timestamp: timestamp,
                frame: frameData,
                metadata: frameMetadata
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('Processing result via HTTP:', data);
            // Process the results as if they came from WebSocket
            if (data && data.results) {
                processResults({
                    type: 'emotion_results',
                    camera_id: camera.id,
                    timestamp: timestamp,
                    results: data.results,
                    processing_time: data.processing_time || 0
                });
            }
            updateCameraStatus(cameraId, `Đã xử lý (${new Date().toLocaleTimeString()})`);
            
            // Hiển thị thông báo nếu có ảnh được lưu
            if (data && data.saved_image) {
                // Tạo thông báo đã lưu ảnh trên giao diện
                const savedIndicator = document.createElement('div');
                savedIndicator.className = 'saved-indicator';
                savedIndicator.innerHTML = `<span>Đã lưu ảnh cảm xúc: ${data.results[0]?.dominant_emotion}</span>`;
                cameraElement.querySelector('.video-wrapper').appendChild(savedIndicator);
                
                // Tự động ẩn thông báo sau 3 giây
                setTimeout(() => {
                    if (savedIndicator.parentNode) {
                        savedIndicator.parentNode.removeChild(savedIndicator);
                    }
                }, 3000);
            }
        })
        .catch(error => {
            console.error('Error sending frame via HTTP:', error);
            updateCameraStatus(cameraId, `Lỗi: ${error.message}`);
        });
    }
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
        const emotion = face.dominant_emotion;
        const dominantConfidence = face.emotions[emotion] || 0;
        const confidence = Math.round(dominantConfidence * 100);
        
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
        
        // Draw more detailed emotion percentages below face
        const emotions = face.emotions;
        if (emotions) {
            let yOffset = y + height + 15;
            const textHeight = 15;
            const padding = 5;
            
            // Calculate total width needed
            ctx.font = '12px Arial';
            const totalWidth = width;
            
            // Draw background
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(x, y + height, totalWidth, Object.keys(emotions).length * textHeight + padding * 2);
            
            // Draw emotion percentages
            for (const [emo, score] of Object.entries(emotions)) {
                const percentage = Math.round(score * 100);
                ctx.fillStyle = getEmotionColor(emo);
                ctx.fillText(`${emo}: ${percentage}%`, x + padding, yOffset);
                yOffset += textHeight;
            }
        }
        
        // Update emotion counts for statistics
        // Only count the dominant emotion
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
        happy: '#2ecc71',      // Bright green
        sad: '#3498db',        // Blue
        angry: '#e74c3c',      // Red
        fear: '#9b59b6',       // Purple
        surprise: '#f39c12',   // Orange
        neutral: '#95a5a6',    // Grey
        disgust: '#27ae60',    // Green
        contempt: '#f1c40f',   // Yellow
        happiness: '#2ecc71',  // Same as happy
        sadness: '#3498db',    // Same as sad
        anger: '#e74c3c',      // Same as angry
        fearful: '#9b59b6',    // Same as fear
        surprised: '#f39c12',  // Same as surprise
        disgusted: '#27ae60',  // Same as disgust
        confused: '#8e44ad',   // Deep purple
        calm: '#16a085'        // Teal
    };
    
    return colors[emotion.toLowerCase()] || '#ffffff';
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
        const emotion = face.dominant_emotion;
        const emotions = face.emotions || {};
        
        if (emotionFilter.value === 'all' || emotionFilter.value === emotion) {
            const row = document.createElement('tr');
            
            const timeCell = document.createElement('td');
            timeCell.textContent = timestamp.toLocaleTimeString();
            
            const cameraCell = document.createElement('td');
            cameraCell.textContent = cameraName;
            
            const emotionCell = document.createElement('td');
            
            // Create a detailed emotion display
            const emotionLabel = document.createElement('div');
            emotionLabel.textContent = emotion;
            emotionLabel.style.fontWeight = 'bold';
            emotionLabel.style.color = getEmotionColor(emotion);
            
            const emotionDetails = document.createElement('div');
            emotionDetails.style.fontSize = '10px';
            emotionDetails.style.marginTop = '3px';
            
            // Add all emotions with percentages
            for (const [emo, score] of Object.entries(emotions)) {
                const percentage = Math.round(score * 100);
                const detailItem = document.createElement('div');
                detailItem.textContent = `${emo}: ${percentage}%`;
                detailItem.style.color = getEmotionColor(emo);
                emotionDetails.appendChild(detailItem);
            }
            
            emotionCell.appendChild(emotionLabel);
            emotionCell.appendChild(emotionDetails);
            
            const confidenceCell = document.createElement('td');
            const dominantConfidence = emotions[emotion] || 0;
            confidenceCell.textContent = `${Math.round(dominantConfidence * 100)}%`;
            
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
    
    try {
        const canvas = cameraElement.querySelector('.overlay-canvas');
        const ctx = canvas.getContext('2d');
        
        // Hiển thị thông báo đang chụp
        updateCameraStatus(cameraId, `Đang chụp ảnh...`);
        
        // Tạo hiệu ứng đèn flash
        const flashElement = document.createElement('div');
        flashElement.className = 'camera-flash';
        cameraElement.querySelector('.video-wrapper').appendChild(flashElement);
        
        // Xóa hiệu ứng đèn flash sau 500ms
        setTimeout(() => {
            if (flashElement && flashElement.parentNode) {
                flashElement.parentNode.removeChild(flashElement);
            }
        }, 500);
        
        if (camera.type === 'webcam') {
            const videoElement = cameraElement.querySelector('.video-element');
            if (!videoElement || !videoElement.videoWidth) {
                alert('Camera chưa sẵn sàng, vui lòng thử lại');
                return;
            }
            
            // Thiết lập kích thước canvas
            canvas.width = videoElement.videoWidth;
            canvas.height = videoElement.videoHeight;
            
            // Vẽ khung hình hiện tại lên canvas
            ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        } else if (camera.type === 'ip_camera') {
            const img = cameraElement.querySelector('.ip-camera-feed');
            if (!img || !img.complete || !img.naturalWidth) {
                alert('Camera IP chưa sẵn sàng, vui lòng thử lại');
                return;
            }
            
            // Thiết lập kích thước canvas
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            
            // Vẽ khung hình hiện tại lên canvas
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        }
        
        // Chuyển đổi canvas thành dữ liệu ảnh
        const frameData = canvas.toDataURL('image/jpeg', 0.9);
        const timestamp = Math.floor(Date.now() / 1000);
        
        // Gửi ảnh lên server để xử lý
        fetch('/api/process_frame', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                client_id: 'manual_capture',
                camera_id: camera.id,
                camera_name: camera.name,
                timestamp: timestamp,
                frame: frameData,
                is_manual_capture: true  // Đánh dấu đây là chụp thủ công
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Lỗi HTTP: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.error) {
                updateCameraStatus(cameraId, `Lỗi: ${data.error}`);
                return;
            }
            
            // Xử lý kết quả
            if (data.results && data.results.length > 0) {
                updateCameraStatus(cameraId, `Đã phát hiện ${data.results.length} khuôn mặt!`);
                
                // Hiển thị kết quả nhận dạng
                processResults({
                    type: 'emotion_results',
                    camera_id: camera.id,
                    timestamp: timestamp,
                    results: data.results
                });
                
                // Hiển thị thông báo đã lưu ảnh nếu có
                if (data.saved_image) {
                    const savedIndicator = document.createElement('div');
                    savedIndicator.className = 'saved-indicator';
                    savedIndicator.innerHTML = `<span>Đã lưu ảnh! Cảm xúc: ${data.results[0]?.dominant_emotion}</span>`;
                    cameraElement.querySelector('.video-wrapper').appendChild(savedIndicator);
                    
                    setTimeout(() => {
                        if (savedIndicator.parentNode) {
                            savedIndicator.parentNode.removeChild(savedIndicator);
                        }
                    }, 3000);
                }
            } else {
                updateCameraStatus(cameraId, `Không phát hiện khuôn mặt`);
            }
        })
        .catch(error => {
            console.error('Lỗi khi xử lý khung hình:', error);
            updateCameraStatus(cameraId, `Lỗi: ${error.message}`);
        });
    } catch (error) {
        console.error(`Lỗi khi chụp ảnh từ camera ${cameraId}:`, error);
        updateCameraStatus(cameraId, `Lỗi: ${error.message}`);
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
    
    // Add event listener for saved images button
    document.getElementById('viewSavedImagesBtn').addEventListener('click', () => {
        showSavedImagesModal();
    });
    
    emotionFilter.addEventListener('change', updateEmotionStats);
    
    loginBtn.addEventListener('click', () => showModal(loginModal));
    addCameraBtn.addEventListener('click', () => showModal(addCameraModal));
    mobileConnectBtn.addEventListener('click', () => {
        showModal(mobileConnectModal);
        if (!qrCodeRendered) {
            generateMobileQRCode();
            qrCodeRendered = true;
        }
    });
    
    // Close buttons for modals
    document.querySelectorAll('.close').forEach(closeBtn => {
        closeBtn.addEventListener('click', () => {
            hideModal(loginModal);
            hideModal(addCameraModal);
            hideModal(mobileConnectModal);
            hideModal(document.getElementById('savedImagesModal'));
        });
    });
    
    // Handle camera selection for saved images
    document.getElementById('cameraSelectorForImages').addEventListener('change', (e) => {
        fetchSavedImages(e.target.value);
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
        const mobileInstructionsGroup = document.getElementById('mobileInstructionsGroup');
        
        if (e.target.value === 'ip_camera') {
            ipUrlGroup.style.display = 'block';
            mobileInstructionsGroup.style.display = 'none';
        } else if (e.target.value === 'mobile_camera') {
            ipUrlGroup.style.display = 'none';
            mobileInstructionsGroup.style.display = 'block';
        } else {
            ipUrlGroup.style.display = 'none';
            mobileInstructionsGroup.style.display = 'none';
        }
    });
    
    // Initialize IP camera URL field visibility
    document.getElementById('ipUrlGroup').style.display = 
        document.getElementById('cameraType').value === 'ip_camera' ? 'block' : 'none';
}

// Generate QR code for mobile camera connection
function generateMobileQRCode() {
    // Create a unique mobile connection ID
    mobileConnectionId = 'mobile_' + Math.random().toString(36).substring(2, 9);
    
    // Get the current location
    const protocol = window.location.protocol;
    const host = window.location.host;
    
    // Create a URL for the mobile connection
    const mobileUrl = `${protocol}//${host}/mobile-camera.html?id=${mobileConnectionId}`;
    
    // Generate QR code
    const qrContainer = document.getElementById('qrcode');
    qrContainer.innerHTML = '';
    
    if (typeof QRCode !== 'undefined') {
        new QRCode(qrContainer, {
            text: mobileUrl,
            width: 200,
            height: 200
        });
    } else {
        qrContainer.innerHTML = `<a href="${mobileUrl}" target="_blank">Open Mobile Camera Link</a>`;
    }
    
    // Create mobile camera HTML page if it doesn't exist
    createMobileCameraPage(mobileConnectionId);
}

// Create mobile camera HTML page
function createMobileCameraPage(connectionId) {
    // Create HTML file for mobile camera
    const mobileCameraHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mobile Camera</title>
    <style>
        body, html {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: #000;
            font-family: Arial, sans-serif;
        }
        .container {
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
        }
        .video-container {
            flex: 1;
            position: relative;
        }
        video {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        .controls {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: rgba(0, 0, 0, 0.5);
            color: white;
            padding: 10px;
            text-align: center;
        }
        .status {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: rgba(0, 0, 0, 0.5);
            color: white;
            padding: 10px;
            text-align: center;
        }
        button {
            background: #3498db;
            color: white;
            border: none;
            border-radius: 5px;
            padding: 8px 15px;
            margin: 5px;
            cursor: pointer;
            font-size: 14px;
        }
        button:hover {
            background: #2980b9;
        }
        .camera-switch {
            position: absolute;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.5);
            color: white;
            border: none;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            font-size: 20px;
            display: flex;
            justify-content: center;
            align-items: center;
            cursor: pointer;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="status" id="status">Waiting for camera...</div>
        <div class="video-container">
            <video id="video" autoplay playsinline></video>
            <button class="camera-switch" id="switchCamera">⟳</button>
        </div>
        <div class="controls">
            <button id="startBtn">Start Camera</button>
            <button id="stopBtn" disabled>Stop Camera</button>
        </div>
    </div>

    <script>
        // Get connection ID from URL
        const urlParams = new URLSearchParams(window.location.search);
        const connectionId = urlParams.get('id');
        
        // DOM elements
        const video = document.getElementById('video');
        const startBtn = document.getElementById('startBtn');
        const stopBtn = document.getElementById('stopBtn');
        const switchBtn = document.getElementById('switchCamera');
        const statusEl = document.getElementById('status');
        
        // WebSocket and camera variables
        let ws = null;
        let stream = null;
        let isStreaming = false;
        let captureInterval = null;
        let facingMode = 'user'; // Front camera by default
        
        // Connect to WebSocket
        function connectWebSocket() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const host = window.location.host;
            ws = new WebSocket(\`\${protocol}//\${host}/ws/\${connectionId}\`);
            
            ws.onopen = () => {
                statusEl.textContent = 'Connected to server';
                // Register this mobile camera
                ws.send(JSON.stringify({
                    type: 'register_mobile_camera',
                    id: connectionId,
                    name: 'Mobile Camera ' + connectionId.substring(7)
                }));
            };
            
            ws.onclose = () => {
                statusEl.textContent = 'Disconnected from server';
                // Try to reconnect
                setTimeout(connectWebSocket, 3000);
            };
            
            ws.onerror = (error) => {
                statusEl.textContent = 'Error connecting to server';
                console.error('WebSocket error:', error);
            };
        }
        
        // Start camera
        async function startCamera() {
            try {
                // Request camera permission
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: facingMode }
                });
                
                // Set video source
                video.srcObject = stream;
                
                // Update UI
                startBtn.disabled = true;
                stopBtn.disabled = false;
                statusEl.textContent = 'Camera active';
                isStreaming = true;
                
                // Start capturing frames
                startCapturing();
            } catch (error) {
                statusEl.textContent = 'Error accessing camera: ' + error.message;
                console.error('Error accessing camera:', error);
            }
        }
        
        // Stop camera
        function stopCamera() {
            // Stop capturing frames
            if (captureInterval) {
                clearInterval(captureInterval);
                captureInterval = null;
            }
            
            // Stop camera stream
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
                stream = null;
                video.srcObject = null;
            }
            
            // Update UI
            startBtn.disabled = false;
            stopBtn.disabled = true;
            statusEl.textContent = 'Camera stopped';
            isStreaming = false;
        }
        
        // Switch between front and back camera
        async function switchCamera() {
            // Stop current camera
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
                stream = null;
            }
            
            // Switch facing mode
            facingMode = facingMode === 'user' ? 'environment' : 'user';
            
            // If currently streaming, restart camera
            if (isStreaming) {
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: facingMode }
                    });
                    video.srcObject = stream;
                    statusEl.textContent = 'Camera switched to ' + (facingMode === 'user' ? 'front' : 'back');
                } catch (error) {
                    statusEl.textContent = 'Error switching camera: ' + error.message;
                    console.error('Error switching camera:', error);
                }
            }
        }
        
        // Start capturing frames and sending to server
        function startCapturing() {
            // Create canvas for image processing
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Set capture interval (4 seconds)
            captureInterval = setInterval(() => {
                if (!isStreaming || !stream || !ws || ws.readyState !== WebSocket.OPEN) return;
                
                try {
                    // Set canvas size to match video
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    
                    // Draw current frame on canvas
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    
                    // Convert to base64 image
                    const frameData = canvas.toDataURL('image/jpeg', 0.8);
                    
                    // Send to server
                    ws.send(JSON.stringify({
                        type: 'mobile_frame',
                        id: connectionId,
                        frame: frameData,
                        timestamp: Date.now() / 1000
                    }));
                    
                    // Update status
                    statusEl.textContent = 'Frame captured at ' + new Date().toLocaleTimeString();
                } catch (error) {
                    console.error('Error capturing frame:', error);
                    statusEl.textContent = 'Error capturing frame: ' + error.message;
                }
            }, 4000);
        }
        
        // Event listeners
        startBtn.addEventListener('click', startCamera);
        stopBtn.addEventListener('click', stopCamera);
        switchBtn.addEventListener('click', switchCamera);
        
        // Connect to WebSocket when page loads
        window.addEventListener('load', connectWebSocket);
        
        // Handle page visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                // Page is hidden, pause capturing
                if (captureInterval) {
                    clearInterval(captureInterval);
                    captureInterval = null;
                    statusEl.textContent = 'Capturing paused (page hidden)';
                }
            } else if (isStreaming) {
                // Page is visible again, resume capturing
                startCapturing();
                statusEl.textContent = 'Capturing resumed';
            }
        });
    </script>
</body>
</html>
    `;
    
    // Use fetch to create file on server
    fetch('/api/create-mobile-page', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            content: mobileCameraHtml
        })
    })
    .then(response => response.json())
    .then(result => {
        console.log('Mobile camera page created:', result);
    })
    .catch(error => {
        console.error('Error creating mobile camera page:', error);
    });
}

// Show saved images modal
function showSavedImagesModal() {
    // Show the modal
    const modal = document.getElementById('savedImagesModal');
    showModal(modal);
    
    // Populate camera selector
    populateCameraSelectorForImages();
    
    // Fetch all saved images initially
    fetchSavedImages('all');
}

// Populate camera selector for saved images
function populateCameraSelectorForImages() {
    const selector = document.getElementById('cameraSelectorForImages');
    // Keep the "all" option and remove others
    while (selector.options.length > 1) {
        selector.remove(1);
    }
    
    // Add camera options
    activeCameras.forEach(camera => {
        const option = document.createElement('option');
        option.value = camera.id;
        option.textContent = camera.name;
        selector.appendChild(option);
    });
}

// Display saved images in container
function displaySavedImages(images) {
    const container = document.getElementById('savedImagesContainer');
    container.innerHTML = '';
    
    if (!images || images.length === 0) {
        container.innerHTML = '<p>Không có ảnh nào được lưu</p>';
        return;
    }
    
    // Sắp xếp ảnh theo thời gian (mới nhất lên đầu)
    // Lưu ý: API đã sắp xếp, nhưng sắp xếp thêm ở phía client để đảm bảo
    images.sort((a, b) => {
        if (a.date && b.date) return a.date < b.date ? 1 : -1;
        return b.filename.localeCompare(a.filename);
    });
    
    // Create image elements
    images.forEach(image => {
        const imageItem = document.createElement('div');
        imageItem.className = 'saved-image-item';
        
        // Get camera name from active cameras
        const camera = activeCameras.find(cam => cam.id === image.camera_id);
        const cameraName = camera ? camera.name : image.camera_id;
        
        // Create image URL
        const imageUrl = `${window.location.protocol}//${window.location.hostname}:8000${image.path}`;
        
        // Sử dụng thông tin đã được phân tích từ server
        const emotion = image.emotion || 'không xác định';
        const formattedDate = image.date || 'không xác định';
        
        imageItem.innerHTML = `
            <div class="saved-image-wrapper">
                <img src="${imageUrl}" alt="Hình ảnh nhận diện" onerror="this.src='data:image/svg+xml;charset=UTF-8,%3Csvg%20width%3D%22200%22%20height%3D%22150%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20font-size%3D%2220%22%20text-anchor%3D%22middle%22%20dominant-baseline%3D%22middle%22%3EHình%20ảnh%20lỗi%3C%2Ftext%3E%3C%2Fsvg%3E';">
                <div class="image-overlay">
                    <button class="fullscreen-btn"><i class="fas fa-expand"></i></button>
                </div>
            </div>
            <div class="saved-image-info">
                <p><strong>Camera:</strong> ${cameraName}</p>
                <p><strong>Thời gian:</strong> ${formattedDate}</p>
                <p><strong>Cảm xúc:</strong> <span class="emotion-highlight">${emotion}</span></p>
                <div class="saved-image-actions">
                    <button class="btn btn-sm view-btn" title="Xem đầy đủ"><i class="fas fa-eye"></i></button>
                    <button class="btn btn-sm download-btn" title="Tải xuống"><i class="fas fa-download"></i></button>
                </div>
            </div>
        `;
        
        // Thêm hành động cho nút fullscreen
        const fullscreenBtn = imageItem.querySelector('.fullscreen-btn');
        fullscreenBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.open(imageUrl, '_blank');
        });
        
        // Thêm hành động cho nút xem
        const viewBtn = imageItem.querySelector('.view-btn');
        viewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.open(imageUrl, '_blank');
        });
        
        // Thêm hành động cho nút tải xuống
        const downloadBtn = imageItem.querySelector('.download-btn');
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Tạo link tải về
            const link = document.createElement('a');
            link.href = imageUrl;
            link.download = image.filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
        
        // Thêm sự kiện click cho toàn bộ item (xem ảnh đầy đủ)
        imageItem.addEventListener('click', () => {
            window.open(imageUrl, '_blank');
        });
        
        container.appendChild(imageItem);
    });
}

// Fetch saved images from backend
function fetchSavedImages(cameraId) {
    const container = document.getElementById('savedImagesContainer');
    container.innerHTML = '<p>Đang tải ảnh...</p>';
    
    // Prepare URL with optional camera filter
    let url = `${window.location.protocol}//${window.location.hostname}:8000/saved-images`;
    if (cameraId && cameraId !== 'all') {
        url += `?camera_id=${cameraId}`;
    }
    
    fetch(url)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.json();
        })
        .then(images => {
            console.log('Fetched saved images:', images);
            displaySavedImages(images);
        })
        .catch(error => {
            console.error('Error fetching saved images:', error);
            container.innerHTML = `
                <div class="error-message">
                    <p><i class="fas fa-exclamation-circle"></i> Lỗi: ${error.message}</p>
                    <p>Không thể tải danh sách ảnh từ máy chủ.</p>
                    <button class="btn retry-btn">Thử lại</button>
                </div>
            `;
            
            // Add retry button functionality
            const retryBtn = container.querySelector('.retry-btn');
            if (retryBtn) {
                retryBtn.addEventListener('click', () => {
                    fetchSavedImages(cameraId);
                });
            }
        });
}

// Cập nhật hàm captureAndSendIPCameraFrame để sử dụng server-side capture
function captureAndSendIPCameraFrame(cameraId) {
    const camera = getCameraById(cameraId);
    const cameraElement = getCameraElement(cameraId);
    
    if (!camera || !cameraElement) return;
    
    try {
        // Update status
        updateCameraStatus(cameraId, `Capturing image... (${new Date().toLocaleTimeString()})`);
        
        // Add flash effect
        const flashElement = document.createElement('div');
        flashElement.className = 'camera-flash';
        cameraElement.querySelector('.video-wrapper').appendChild(flashElement);
        
        // Remove flash effect after 500ms
        setTimeout(() => {
            if (flashElement && flashElement.parentNode) {
                flashElement.parentNode.removeChild(flashElement);
            }
        }, 500);
        
        // Sử dụng API server-side để lấy ảnh từ camera IP
        fetch('/api/capture-ip-camera', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                camera_url: camera.url,
                camera_id: camera.id
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                throw new Error(data.error);
            }
            
            // Nếu có dữ liệu ảnh từ server
            if (data.image_data) {
                // Tạo một ảnh mới từ dữ liệu base64
                const img = new Image();
                img.onload = function() {
                    // Tạo canvas để xử lý ảnh
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth || 640;
                    canvas.height = img.naturalHeight || 480;
                    
                    // Vẽ ảnh lên canvas
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    
                    // Chuyển đổi sang base64 (nếu cần)
                    try {
                        const frameData = canvas.toDataURL('image/jpeg', 0.9);
                        
                        // Gửi frame đến server
                        sendFrameToServer(cameraId, camera, frameData);
                        
                        updateCameraStatus(cameraId, `Image processed (${new Date().toLocaleTimeString()})`);
                    } catch (canvasError) {
                        console.error('Error processing canvas:', canvasError);
                        updateCameraStatus(cameraId, `Error processing image: ${canvasError.message}`);
                    }
                };
                
                img.onerror = function(err) {
                    console.error('Error loading image from server:', err);
                    updateCameraStatus(cameraId, 'Error loading image');
                };
                
                // Load ảnh từ dữ liệu base64
                img.src = data.image_data;
            } else {
                updateCameraStatus(cameraId, 'No image data received');
            }
        })
        .catch(error => {
            console.error('Error capturing IP camera image:', error);
            updateCameraStatus(cameraId, `Error: ${error.message}`);
        });
    } catch (error) {
        console.error(`Error in IP camera frame capture: ${error.message}`);
        updateCameraStatus(cameraId, `Error: ${error.message}`);
    }
}

// Hiển thị thông báo khi lưu ảnh thành công
function showSavedNotification(cameraElement, emotion) {
    const notification = document.createElement('div');
    notification.className = 'saved-indicator';
    notification.innerHTML = `<span>Đã lưu ảnh cảm xúc: ${emotion || 'không xác định'}</span>`;
    
    cameraElement.querySelector('.video-wrapper').appendChild(notification);
    
    // Tự động ẩn thông báo sau 3 giây
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 3000);
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', init); 