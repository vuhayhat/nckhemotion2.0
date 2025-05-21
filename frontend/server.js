const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const WebSocket = require('ws');
const axios = require('axios');
const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config();

// Create Express app
const app = express();
const server = http.createServer(app);

// Configure middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'emotion_recognition',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres'
});

// Configure WebSocket server for backend communication
const backendWsUrl = process.env.BACKEND_WS_URL || 'ws://localhost:8000/ws';
const backendApiUrl = process.env.BACKEND_API_URL || 'http://localhost:8000';

// Configure WebSocket server for browser connections
const wss = new WebSocket.Server({ server });

// Store active connections
const clients = new Map();

wss.on('connection', (ws, req) => {
  const clientId = req.url.split('/').pop();
  clients.set(clientId, ws);
  
  console.log(`Client connected: ${clientId}`);
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      // Handle different message types
      switch(data.type) {
        case 'frame':
          // Forward frame to backend for emotion recognition
          const frameResult = await sendFrameToBackendForProcessing(clientId, data.cameraId, data.cameraName, data.timestamp, data.frame);
          // Send results back to client if available
          if (frameResult && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(frameResult));
          }
          break;
          
        case 'mobile_frame':
          // Handle frame from mobile camera
          const mobileResult = await sendFrameToBackendForProcessing(clientId, data.id, 'Mobile Camera', data.timestamp, data.frame);
          // No need to send results back to the mobile device
          break;
          
        case 'register_mobile_camera':
          // Register mobile camera to system
          console.log(`Mobile camera registered: ${data.id} - ${data.name}`);
          // Add the mobile camera to database
          try {
            const mobileCamera = {
              id: data.id,
              name: data.name || `Mobile Camera ${data.id.substring(7)}`,
              type: 'mobile_camera',
              url: ''
            };
            
            const response = await axios.post(`${backendApiUrl}/cameras`, mobileCamera);
            
            // Broadcast camera list update to all clients
            broadcastCameraList();
          } catch (error) {
            console.error('Error registering mobile camera:', error);
          }
          break;
          
        case 'start_stream':
          // Handle starting a stream from a camera
          startCameraStream(clientId, data.cameraId, data.url);
          break;
          
        case 'stop_stream':
          // Handle stopping a stream
          stopCameraStream(clientId, data.cameraId);
          break;
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendError(ws, 'Error processing message');
    }
  });
  
  ws.on('close', () => {
    clients.delete(clientId);
    console.log(`Client disconnected: ${clientId}`);
  });
  
  // Send initial data
  sendCameraList(ws);
});

// Active camera streams
const activeStreams = new Map();

// Send frame to backend for emotion recognition processing
async function sendFrameToBackendForProcessing(clientId, cameraId, cameraName, timestamp, frameData) {
  try {
    // Prepare data for backend
    const payload = {
      client_id: clientId,
      camera_id: cameraId,
      camera_name: cameraName || 'Unknown Camera',
      timestamp: timestamp || Math.floor(Date.now() / 1000),
      frame: frameData
    };
    
    // Send frame to backend API for emotion recognition
    const response = await axios.post(`${backendApiUrl}/process_frame`, payload, {
      headers: {
        'Content-Type': 'application/json'
      },
      // Set a reasonable timeout
      timeout: 10000
    });
    
    // If successful, return the results to be sent to the client
    if (response.status === 200 && response.data) {
      console.log(`Processed frame from camera ${cameraId}, detected ${response.data.results ? response.data.results.length : 0} faces`);
      
      // Format for client
      return {
        type: 'emotion_results',
        camera_id: cameraId,
        timestamp: timestamp,
        results: response.data.results || [],
        processing_time: response.data.processing_time || 0
      };
    } else {
      console.warn(`Backend returned unexpected response for camera ${cameraId}:`, response.status);
      return null;
    }
  } catch (error) {
    console.error(`Error processing frame for camera ${cameraId}:`, error.message);
    
    // Send error message to client
    const client = clients.get(clientId);
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'error',
        camera_id: cameraId,
        message: `Failed to process frame: ${error.message}`
      }));
    }
    
    return null;
  }
}

// Start streaming from a camera
function startCameraStream(clientId, cameraId, url) {
  // Store the camera information
  console.log(`Started stream for camera ${cameraId} with URL ${url}`);
  
  // No longer need to create a proxy for IP cameras
}

// Stop streaming from a camera
function stopCameraStream(clientId, cameraId) {
  // Cleanup any resources associated with the stream
  const wsKey = `${clientId}-${cameraId}`;
  
  if (activeStreams.has(wsKey)) {
    const ws = activeStreams.get(wsKey);
    ws.close();
    activeStreams.delete(wsKey);
  }
  
  console.log(`Stopped stream for camera ${cameraId}`);
}

// Send camera list to client
async function sendCameraList(ws) {
  try {
    const response = await axios.get(`${backendApiUrl}/cameras`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'camera_list',
        cameras: response.data
      }));
    }
  } catch (error) {
    console.error('Error fetching camera list:', error);
    sendError(ws, 'Error fetching camera list');
  }
}

// Send error message to client
function sendError(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'error', message }));
  }
}

// API routes
app.get('/api/cameras', async (req, res) => {
  try {
    const response = await axios.get(`${backendApiUrl}/cameras`);
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching cameras:', error);
    res.status(500).json({ error: 'Failed to fetch cameras' });
  }
});

app.post('/api/cameras', async (req, res) => {
  try {
    const response = await axios.post(`${backendApiUrl}/cameras`, req.body);
    res.json(response.data);
  } catch (error) {
    console.error('Error adding camera:', error);
    res.status(500).json({ success: false, error: 'Failed to add camera' });
  }
});

// API endpoint to update camera information
app.post('/api/update-camera', async (req, res) => {
  try {
    const cameraData = req.body;
    
    if (!cameraData.id) {
      return res.status(400).json({ success: false, error: 'Camera ID is required' });
    }
    
    // Gửi thông tin cập nhật đến backend
    // Vì backend chưa có endpoint update riêng, sử dụng endpoint add camera để ghi đè
    const response = await axios.post(`${backendApiUrl}/cameras`, cameraData);
    
    if (response.data && response.data.success) {
      // Cập nhật thành công, broadcast thông tin camera mới đến tất cả clients
      broadcastCameraList();
      res.json({ success: true, cameraId: cameraData.id });
    } else {
      res.json({ success: false, error: 'Failed to update camera information' });
    }
  } catch (error) {
    console.error('Error updating camera:', error);
    res.status(500).json({ success: false, error: 'Failed to update camera information' });
  }
});

// Create mobile-camera.html file
app.post('/api/create-mobile-page', (req, res) => {
  try {
    const { content } = req.body;
    const filePath = path.join(__dirname, 'public', 'mobile-camera.html');
    
    // Write file
    fs.writeFileSync(filePath, content, 'utf8');
    
    res.json({ success: true, message: 'Mobile camera page created successfully' });
  } catch (error) {
    console.error('Error creating mobile camera page:', error);
    res.status(500).json({ success: false, error: 'Failed to create mobile camera page' });
  }
});

app.get('/api/detections', async (req, res) => {
  try {
    const { camera_id, from_time, to_time, limit } = req.query;
    let url = `${backendApiUrl}/detections`;
    
    // Construct query parameters
    const params = new URLSearchParams();
    if (camera_id) params.append('camera_id', camera_id);
    if (from_time) params.append('from_time', from_time);
    if (to_time) params.append('to_time', to_time);
    if (limit) params.append('limit', limit);
    
    if (params.toString()) {
      url += `?${params.toString()}`;
    }
    
    const response = await axios.get(url);
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching detections:', error);
    res.status(500).json({ error: 'Failed to fetch detections' });
  }
});

// API endpoint to register a new camera proxy - removed since we no longer need proxying
app.get('/api/register-camera-proxy', async (req, res) => {
  res.status(400).json({
    success: false,
    error: 'Camera proxy functionality has been disabled'
  });
});

// API endpoint to get a frame from camera - removed since we're using direct connection
app.get('/api/camera-frame-proxy', async (req, res) => {
  res.status(400).json({
    error: 'Camera proxy functionality has been disabled. Use direct connection to camera URL.'
  });
});

// Simple proxy endpoint for IP cameras - removed as we're using direct connections only
app.get('/api/simple-proxy', async (req, res) => {
  res.status(400).json({
    error: 'Proxy functionality has been disabled. Use direct connection to camera URL.'
  });
});

// Catch-all route for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Broadcast camera list to all connected clients
async function broadcastCameraList() {
  try {
    const response = await axios.get(`${backendApiUrl}/cameras`);
    const cameraList = response.data;
    
    // Send to all connected clients
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'camera_list',
          cameras: cameraList
        }));
      }
    });
  } catch (error) {
    console.error('Error broadcasting camera list:', error);
  }
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 