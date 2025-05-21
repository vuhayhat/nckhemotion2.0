const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const WebSocket = require('ws');
const axios = require('axios');
const { Pool } = require('pg');
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
          // Forward frame to backend
          await sendFrameToBackend(clientId, data.cameraId, data.frame);
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

// Send frame to backend for processing
async function sendFrameToBackend(clientId, cameraId, frameData) {
  try {
    // Connect to backend WebSocket if not already connected
    let wsConnection = activeStreams.get(`${clientId}-${cameraId}`);
    
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
      const ws = new WebSocket(`${backendWsUrl}/${clientId}/${cameraId}`);
      
      ws.on('open', () => {
        console.log(`Backend WebSocket connected for camera: ${cameraId}`);
        // Send the current frame once connected
        ws.send(frameData);
      });
      
      ws.on('message', (data) => {
        // Forward results to client
        const client = clients.get(clientId);
        if (client && client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      });
      
      ws.on('error', (error) => {
        console.error(`Backend WebSocket error for camera ${cameraId}:`, error);
      });
      
      ws.on('close', () => {
        console.log(`Backend WebSocket closed for camera: ${cameraId}`);
        activeStreams.delete(`${clientId}-${cameraId}`);
      });
      
      activeStreams.set(`${clientId}-${cameraId}`, ws);
    } else {
      // Send frame data to backend
      wsConnection.send(frameData);
    }
  } catch (error) {
    console.error('Error sending frame to backend:', error);
  }
}

// Start streaming from a camera
function startCameraStream(clientId, cameraId, url) {
  // Store the camera information
  console.log(`Started stream for camera ${cameraId} with URL ${url}`);
  
  // For IP cameras, we need to create a proxy to handle CORS issues
  if (url && url.includes('http')) {
    // Create an endpoint to proxy the camera feed
    const proxyPath = `/camera-proxy/${cameraId}`;
    
    app.get(proxyPath, async (req, res) => {
      try {
        // Forward the request to the camera URL
        const response = await axios({
          method: 'get',
          url: url,
          responseType: 'stream',
          timeout: 5000,
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        
        // Set headers
        res.set({
          'Content-Type': response.headers['content-type'] || 'image/jpeg',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        
        // Pipe the camera feed to the response
        response.data.pipe(res);
      } catch (error) {
        console.error(`Error proxying camera feed (${cameraId}):`, error.message);
        res.status(500).send('Error connecting to camera feed');
      }
    });
    
    // Notify the client about the proxy URL
    const client = clients.get(clientId);
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'camera_proxy',
        cameraId: cameraId,
        proxyUrl: proxyPath
      }));
    }
  }
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

// Catch-all route for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 