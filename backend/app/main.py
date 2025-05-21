from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
import base64
import json
import os
import time
from deepface import DeepFace
from .db_manager import DBManager

app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database connection
db_manager = DBManager()

# Store active connections
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict = {}
    
    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket
    
    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]
    
    async def send_message(self, message: str, client_id: str):
        if client_id in self.active_connections:
            await self.active_connections[client_id].send_text(message)

manager = ConnectionManager()

@app.get("/")
def read_root():
    return {"message": "Facial Emotion Recognition API"}

@app.websocket("/ws/{client_id}/{camera_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str, camera_id: str):
    await manager.connect(websocket, client_id)
    try:
        while True:
            data = await websocket.receive_text()
            # Decode the base64 image
            try:
                # Expecting format: "data:image/jpeg;base64,<actual_base64>"
                image_data = data.split(",")[1] if "," in data else data
                frame_bytes = base64.b64decode(image_data)
                frame_np = np.frombuffer(frame_bytes, dtype=np.uint8)
                frame = cv2.imdecode(frame_np, cv2.IMREAD_COLOR)
                
                # Process the frame with DeepFace
                results = process_frame(frame, camera_id)
                
                # Send back the results
                await manager.send_message(json.dumps(results), client_id)
            except Exception as e:
                print(f"Error processing frame: {str(e)}")
                await manager.send_message(json.dumps({"error": str(e)}), client_id)
    except WebSocketDisconnect:
        manager.disconnect(client_id)

@app.post("/upload-frame/{camera_id}")
async def upload_frame(camera_id: str, file: UploadFile = File(...)):
    try:
        contents = await file.read()
        frame_np = np.frombuffer(contents, dtype=np.uint8)
        frame = cv2.imdecode(frame_np, cv2.IMREAD_COLOR)
        
        # Process the frame with DeepFace
        results = process_frame(frame, camera_id)
        return results
    except Exception as e:
        return {"error": str(e)}

def process_frame(frame, camera_id):
    try:
        # Analyze emotions with DeepFace
        analysis = DeepFace.analyze(frame, actions=['emotion'], enforce_detection=False)
        
        # Extract emotion results
        if isinstance(analysis, list):
            results = []
            for face in analysis:
                emotion = face["emotion"]
                dominant_emotion = max(emotion, key=emotion.get)
                
                # Extract face region
                region = face.get("region", {})
                x = region.get("x", 0)
                y = region.get("y", 0)
                w = region.get("w", 0)
                h = region.get("h", 0)
                
                results.append({
                    "emotion": dominant_emotion,
                    "confidence": emotion[dominant_emotion],
                    "all_emotions": emotion,
                    "face_location": {"x": x, "y": y, "width": w, "height": h}
                })
        else:
            emotion = analysis["emotion"]
            dominant_emotion = max(emotion, key=emotion.get)
            
            # Extract face region
            region = analysis.get("region", {})
            x = region.get("x", 0)
            y = region.get("y", 0)
            w = region.get("w", 0)
            h = region.get("h", 0)
            
            results = [{
                "emotion": dominant_emotion,
                "confidence": emotion[dominant_emotion],
                "all_emotions": emotion,
                "face_location": {"x": x, "y": y, "width": w, "height": h}
            }]
        
        # Store results in database
        timestamp = time.time()
        for face_result in results:
            db_manager.store_detection(
                camera_id=camera_id,
                timestamp=timestamp,
                emotion=face_result["emotion"],
                confidence=face_result["confidence"],
                face_location=face_result["face_location"]
            )
        
        return {
            "timestamp": timestamp,
            "camera_id": camera_id,
            "results": results
        }
    except Exception as e:
        print(f"Error in processing: {str(e)}")
        return {"error": str(e)}

@app.get("/cameras")
def get_cameras():
    return db_manager.get_cameras()

@app.post("/cameras")
def add_camera(camera: dict):
    camera_id = camera.get("id") or f"cam_{str(int(time.time()))}"
    name = camera.get("name", "New Camera")
    url = camera.get("url", "")
    camera_type = camera.get("type", "webcam")
    
    result = db_manager.add_camera(camera_id, name, url, camera_type)
    if result:
        return {"success": True, "camera_id": camera_id}
    else:
        return {"success": False, "error": "Failed to add camera"}

@app.get("/detections")
def get_detections(camera_id: str = None, from_time: float = None, to_time: float = None, limit: int = 100):
    return db_manager.get_detections(camera_id, from_time, to_time, limit)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True) 