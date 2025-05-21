from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
import base64
import json
import os
import time
import datetime
from pathlib import Path
from deepface import DeepFace
from .db_manager import DBManager
import traceback

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

@app.post("/process_frame")
async def process_frame_endpoint(request: Request):
    try:
        # Get request body
        payload = await request.json()
        
        # Get data from payload
        client_id = payload.get('client_id')
        camera_id = payload.get('camera_id')
        camera_name = payload.get('camera_name')
        timestamp = payload.get('timestamp', time.time())
        frame_data = payload.get('frame')
        metadata = payload.get('metadata', {})
        
        # Log processing request for debugging
        camera_type = metadata.get('cameraType', 'unknown')
        print(f"Nhận yêu cầu xử lý khung hình từ {camera_type} camera: {camera_id}")
        
        # Further debug for IP camera images
        if camera_type == 'ip_camera':
            print(f"IP camera image metadata: {metadata}")
            print(f"Frame data length: {len(frame_data) if frame_data else 'None'}")
        
        # Expecting format: "data:image/jpeg;base64,<actual_base64>"
        try:
            image_data = frame_data.split(",")[1] if "," in frame_data else frame_data
            frame_bytes = base64.b64decode(image_data)
            frame_np = np.frombuffer(frame_bytes, dtype=np.uint8)
            frame = cv2.imdecode(frame_np, cv2.IMREAD_COLOR)
        except Exception as decode_error:
            print(f"Lỗi giải mã ảnh: {str(decode_error)}")
            return {"error": f"Không thể giải mã ảnh: {str(decode_error)}"}
        
        if frame is None or frame.size == 0:
            print(f"Lỗi: Dữ liệu ảnh rỗng hoặc không hợp lệ từ camera {camera_id}")
            
            # For debugging - save the invalid image data
            try:
                debug_dir = Path("debug_images")
                os.makedirs(debug_dir, exist_ok=True)
                with open(debug_dir / f"invalid_image_{camera_id}_{int(time.time())}.txt", "w") as f:
                    f.write(f"Camera: {camera_id}\n")
                    f.write(f"Type: {camera_type}\n")
                    f.write(f"Frame data length: {len(frame_data) if frame_data else 'None'}\n")
                    f.write(f"Frame bytes length: {len(frame_bytes) if frame_bytes is not None else 'None'}\n")
                    # Save a small sample of the base64 data for debugging
                    if frame_data and len(frame_data) > 100:
                        f.write(f"Frame data sample: {frame_data[:100]}...\n")
            except Exception as debug_error:
                print(f"Error saving debug info: {debug_error}")
                
            return {"error": "Dữ liệu ảnh không hợp lệ hoặc rỗng"}
        
        # Ghi lại kích thước ảnh để debug
        print(f"Ảnh đã nhận: {frame.shape[1]}x{frame.shape[0]} pixels")
        
        # For IP camera images, check if the image is mostly black
        if camera_type == 'ip_camera':
            is_black = check_if_black_image(frame)
            if is_black:
                print(f"Warning: Received mostly black image from IP camera {camera_id}")
                # Still continue processing - the image might have usable data
        
        # Process the frame
        start_time = time.time()
        results = process_frame(frame, camera_id)
        processing_time = time.time() - start_time
        
        # Add processing time to results
        results["processing_time"] = processing_time
        
        # Thêm thông tin về camera
        results["camera_type"] = camera_type
        results["camera_name"] = camera_name
        
        print(f"Đã xử lý khung hình từ camera {camera_id} trong {processing_time:.2f}s")
        if "results" in results:
            print(f"Phát hiện {len(results['results'])} khuôn mặt với cảm xúc: " +
                  ", ".join([r.get("dominant_emotion", "unknown") for r in results["results"]]))
        
        return results
    except Exception as e:
        print(f"Lỗi trong process_frame_endpoint: {str(e)}")
        traceback.print_exc()
        return {"error": f"Xử lý khung hình thất bại: {str(e)}"}

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
        
        # Create a copy of the original frame for drawing
        result_frame = frame.copy()
        
        # Get current timestamp and format it
        timestamp = time.time()
        time_str = datetime.datetime.fromtimestamp(timestamp).strftime('%d/%m/%Y %H:%M:%S')
        
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
                
                # Draw rectangle around face
                cv2.rectangle(result_frame, (x, y), (x+w, y+h), (0, 255, 0), 2)
                
                # Add date and time at the bottom of the frame
                cv2.putText(result_frame, time_str, (10, result_frame.shape[0] - 10), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2, cv2.LINE_AA)
                
                # Draw semi-transparent overlay inside the face rectangle for emotion data
                overlay = result_frame.copy()
                cv2.rectangle(overlay, (x, y + h - 80), (x + w, y + h), (0, 0, 0), -1)
                cv2.addWeighted(overlay, 0.6, result_frame, 0.4, 0, result_frame)
                
                # Add emotion text and percentage inside the rectangle
                confidence = emotion[dominant_emotion] * 100
                emotion_text = f"{dominant_emotion}: {confidence:.1f}%"
                cv2.putText(result_frame, emotion_text, (x + 5, y + h - 45), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA)
                
                # Add top 3 emotions
                sorted_emotions = sorted(emotion.items(), key=lambda x: x[1], reverse=True)[:3]
                y_offset = y + h - 25
                for i, (emo, score) in enumerate(sorted_emotions):
                    if i > 0:  # Skip dominant emotion as it's already displayed
                        percentage = score * 100
                        emotion_detail = f"{emo}: {percentage:.1f}%"
                        cv2.putText(result_frame, emotion_detail, (x + 5, y_offset), 
                                   cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
                        y_offset += 20
                
                results.append({
                    "dominant_emotion": dominant_emotion,
                    "emotions": emotion,
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
            
            # Draw rectangle around face
            cv2.rectangle(result_frame, (x, y), (x+w, y+h), (0, 255, 0), 2)
            
            # Add date and time at the bottom of the frame
            cv2.putText(result_frame, time_str, (10, result_frame.shape[0] - 10), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2, cv2.LINE_AA)
            
            # Draw semi-transparent overlay inside the face rectangle for emotion data
            overlay = result_frame.copy()
            cv2.rectangle(overlay, (x, y + h - 80), (x + w, y + h), (0, 0, 0), -1)
            cv2.addWeighted(overlay, 0.6, result_frame, 0.4, 0, result_frame)
            
            # Add emotion text and percentage inside the rectangle
            confidence = emotion[dominant_emotion] * 100
            emotion_text = f"{dominant_emotion}: {confidence:.1f}%"
            cv2.putText(result_frame, emotion_text, (x + 5, y + h - 45), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA)
            
            # Add top 3 emotions
            sorted_emotions = sorted(emotion.items(), key=lambda x: x[1], reverse=True)[:3]
            y_offset = y + h - 25
            for i, (emo, score) in enumerate(sorted_emotions):
                if i > 0:  # Skip dominant emotion as it's already displayed
                    percentage = score * 100
                    emotion_detail = f"{emo}: {percentage:.1f}%"
                    cv2.putText(result_frame, emotion_detail, (x + 5, y_offset), 
                               cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
                    y_offset += 20
            
            results = [{
                "dominant_emotion": dominant_emotion,
                "emotions": emotion,
                "face_location": {"x": x, "y": y, "width": w, "height": h}
            }]
        
        # Store results in database
        for face_result in results:
            db_manager.store_detection(
                camera_id=camera_id,
                timestamp=timestamp,
                emotion=face_result["dominant_emotion"],
                confidence=face_result["emotions"][face_result["dominant_emotion"]],
                face_location=face_result["face_location"]
            )
        
        # Save the image with emotion detection
        if len(results) > 0:  # Only save if faces were detected
            try:
                # Tạo thư mục gốc nếu chưa tồn tại
                root_images_dir = Path("detected_images")
                if not root_images_dir.exists():
                    os.makedirs(root_images_dir, exist_ok=True)
                    print(f"Tạo thư mục gốc lưu ảnh: {root_images_dir.absolute()}")
                
                # Làm sạch ID camera để đảm bảo tên thư mục hợp lệ
                safe_camera_id = ''.join(c if c.isalnum() or c in ['-', '_'] else '_' for c in camera_id)
                
                # Tạo cấu trúc thư mục phân cấp theo camera/năm/tháng
                current_date = datetime.datetime.fromtimestamp(timestamp)
                year_month = current_date.strftime('%Y-%m')
                
                # Đường dẫn đầy đủ: detected_images/camera_id/năm-tháng/
                camera_dir = root_images_dir / safe_camera_id / year_month
                os.makedirs(camera_dir, exist_ok=True)
                
                # Generate filename with timestamp
                filename_time_str = current_date.strftime('%Y%m%d_%H%M%S')
                filename = f"{filename_time_str}_{dominant_emotion}.jpg"
                file_path = camera_dir / filename
                
                # Make sure the result_frame is a valid image
                if result_frame is None or result_frame.size == 0:
                    print(f"Error: Result frame is invalid for {camera_id}")
                    # Use the original frame as fallback
                    cv2.imwrite(str(file_path), frame)
                else:
                    # Save the image with detection rectangles
                    cv2.imwrite(str(file_path), result_frame)
                
                print(f"Đã lưu ảnh nhận diện tại: {file_path}")
                
                # Get absolute URL path
                relative_path = f"/images/{safe_camera_id}/{year_month}/{filename}"
                
                return {
                    "timestamp": timestamp,
                    "camera_id": camera_id,
                    "results": results,
                    "saved_image": {
                        "path": relative_path,
                        "filename": filename,
                        "full_path": str(file_path)
                    }
                }
            except Exception as save_error:
                print(f"Lỗi lưu ảnh: {str(save_error)}")
                traceback.print_exc()  # Print the full stack trace for debugging
                # Tiếp tục xử lý bình thường ngay cả khi không thể lưu ảnh
        
        return {
            "timestamp": timestamp,
            "camera_id": camera_id,
            "results": results
        }
    except Exception as e:
        print(f"Error in processing: {str(e)}")
        traceback.print_exc()  # Add full stack trace for better debugging
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

@app.get("/saved-images")
def get_saved_images(camera_id: str = None):
    """Get list of saved images with emotion detection"""
    try:
        root_dir = Path("detected_images")
        if not root_dir.exists():
            return []
        
        # Làm sạch camera_id nếu được cung cấp
        safe_camera_id = None
        if camera_id:
            safe_camera_id = ''.join(c if c.isalnum() or c in ['-', '_'] else '_' for c in camera_id)
        
        # Nếu không có camera_id, lấy tất cả ảnh từ tất cả camera
        if not safe_camera_id:
            all_images = []
            # Lặp qua từng thư mục camera
            for cam_dir in root_dir.iterdir():
                if cam_dir.is_dir():
                    cam_id = cam_dir.name
                    # Lặp qua từng thư mục tháng
                    for month_dir in cam_dir.iterdir():
                        if month_dir.is_dir():
                            month = month_dir.name
                            # Lặp qua từng ảnh trong thư mục
                            for img_file in month_dir.iterdir():
                                if img_file.suffix.lower() in ['.jpg', '.jpeg', '.png']:
                                    # Phân tích tên tệp để lấy thông tin thời gian và cảm xúc
                                    file_info = parse_image_filename(img_file.name)
                                    all_images.append({
                                        "camera_id": cam_id,
                                        "filename": img_file.name,
                                        "path": f"/images/{cam_id}/{month}/{img_file.name}",
                                        "date": file_info.get("date"),
                                        "emotion": file_info.get("emotion")
                                    })
            
            # Sắp xếp theo thời gian, mới nhất trước
            all_images.sort(key=lambda x: x.get("date", ""), reverse=True)
            return all_images
        else:
            # Lấy ảnh cho camera cụ thể
            cam_dir = root_dir / safe_camera_id
            if not cam_dir.exists():
                return []
            
            images = []
            # Lặp qua từng thư mục tháng
            for month_dir in cam_dir.iterdir():
                if month_dir.is_dir():
                    month = month_dir.name
                    # Lặp qua từng ảnh trong thư mục
                    for img_file in month_dir.iterdir():
                        if img_file.suffix.lower() in ['.jpg', '.jpeg', '.png']:
                            # Phân tích tên tệp để lấy thông tin thời gian và cảm xúc
                            file_info = parse_image_filename(img_file.name)
                            images.append({
                                "camera_id": safe_camera_id,
                                "filename": img_file.name,
                                "path": f"/images/{safe_camera_id}/{month}/{img_file.name}",
                                "date": file_info.get("date"),
                                "emotion": file_info.get("emotion")
                            })
            
            # Sắp xếp theo thời gian, mới nhất trước
            images.sort(key=lambda x: x.get("date", ""), reverse=True)
            return images
    except Exception as e:
        print(f"Lỗi khi lấy danh sách ảnh đã lưu: {str(e)}")
        return {"error": str(e)}

# Hàm phụ trợ để phân tích tên tệp ảnh đã lưu
def parse_image_filename(filename):
    """Parse image filename to extract date and emotion"""
    try:
        parts = filename.split('_')
        if len(parts) >= 3:
            date_str = parts[0]
            time_str = parts[1]
            # Trích xuất cảm xúc từ phần còn lại (loại bỏ phần mở rộng)
            emotion = parts[2].split('.')[0]
            
            # Định dạng ngày tháng thành dạng hiển thị
            formatted_date = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]} {time_str[:2]}:{time_str[2:4]}:{time_str[4:6]}"
            
            return {
                "date": formatted_date,
                "emotion": emotion
            }
        return {}
    except Exception:
        return {}

@app.get("/images/{camera_id}/{year_month}/{image_name}")
async def get_image(camera_id: str, year_month: str, image_name: str):
    """Get a specific saved image"""
    from fastapi.responses import FileResponse
    try:
        # Làm sạch tham số để tránh path traversal
        safe_camera_id = ''.join(c if c.isalnum() or c in ['-', '_'] else '_' for c in camera_id)
        safe_year_month = ''.join(c if c.isalnum() or c in ['-', '_'] else '_' for c in year_month)
        safe_image_name = os.path.basename(image_name)
        
        image_path = Path(f"detected_images/{safe_camera_id}/{safe_year_month}/{safe_image_name}")
        if not image_path.exists():
            return {"error": "Không tìm thấy ảnh"}
        
        return FileResponse(image_path)
    except Exception as e:
        print(f"Lỗi khi lấy ảnh: {str(e)}")
        return {"error": str(e)}

def check_if_black_image(image):
    """Check if an image is mostly black (which might indicate a problem with the camera feed)"""
    if image is None:
        return True
        
    # Convert to grayscale
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # Calculate mean brightness
    mean_brightness = np.mean(gray)
    
    # Check if mean brightness is very low (suggesting black image)
    return mean_brightness < 5.0  # Threshold value

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True) 