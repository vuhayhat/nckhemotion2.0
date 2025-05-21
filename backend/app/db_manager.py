import psycopg2
import json
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

class DBManager:
    def __init__(self):
        self.conn = None
        self.connect()
        self.create_tables()
        
    def connect(self):
        try:
            # Get PostgreSQL connection parameters from environment variables
            # with fallbacks to defaults
            db_host = os.getenv("DB_HOST", "localhost")
            db_port = os.getenv("DB_PORT", "5432")
            db_name = os.getenv("DB_NAME", "emotion_recognition")
            db_user = os.getenv("DB_USER", "postgres")
            db_password = os.getenv("DB_PASSWORD", "postgres")
            
            self.conn = psycopg2.connect(
                host=db_host,
                port=db_port,
                dbname=db_name,
                user=db_user,
                password=db_password
            )
            
            print("Database connection established")
        except Exception as e:
            print(f"Error connecting to database: {str(e)}")
    
    def create_tables(self):
        try:
            cursor = self.conn.cursor()
            
            # Create users table
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                is_admin BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            ''')
            
            # Create cameras table
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS cameras (
                id VARCHAR(100) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                url VARCHAR(255) NOT NULL,
                type VARCHAR(50) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            ''')
            
            # Create detections table
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS detections (
                id SERIAL PRIMARY KEY,
                camera_id VARCHAR(100) REFERENCES cameras(id),
                timestamp DOUBLE PRECISION NOT NULL,
                emotion VARCHAR(50) NOT NULL,
                confidence FLOAT NOT NULL,
                face_location JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            ''')
            
            # Insert default admin user if none exists
            cursor.execute('''
            INSERT INTO users (username, password, is_admin)
            SELECT 'admin', 'admin', TRUE
            WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin')
            ''')
            
            self.conn.commit()
            cursor.close()
            print("Tables created successfully")
        except Exception as e:
            print(f"Error creating tables: {str(e)}")
    
    def store_detection(self, camera_id, timestamp, emotion, confidence, face_location):
        try:
            # Check if camera exists, if not create a default
            cursor = self.conn.cursor()
            cursor.execute("SELECT 1 FROM cameras WHERE id = %s", (camera_id,))
            if cursor.fetchone() is None:
                cursor.execute(
                    "INSERT INTO cameras (id, name, url, type) VALUES (%s, %s, %s, %s)",
                    (camera_id, f"Camera {camera_id}", "http://unknown", "unknown")
                )
            
            # Insert detection record
            cursor.execute(
                "INSERT INTO detections (camera_id, timestamp, emotion, confidence, face_location) VALUES (%s, %s, %s, %s, %s)",
                (camera_id, timestamp, emotion, confidence, json.dumps(face_location))
            )
            
            self.conn.commit()
            cursor.close()
            return True
        except Exception as e:
            print(f"Error storing detection: {str(e)}")
            return False
            
    def get_cameras(self):
        try:
            cursor = self.conn.cursor()
            cursor.execute("SELECT id, name, url, type, created_at FROM cameras")
            
            cameras = []
            for row in cursor.fetchall():
                cameras.append({
                    "id": row[0],
                    "name": row[1],
                    "url": row[2],
                    "type": row[3],
                    "created_at": row[4].isoformat() if row[4] else None
                })
            
            cursor.close()
            return cameras
        except Exception as e:
            print(f"Error getting cameras: {str(e)}")
            return []
    
    def get_detections(self, camera_id=None, from_time=None, to_time=None, limit=100):
        try:
            cursor = self.conn.cursor()
            
            query = "SELECT id, camera_id, timestamp, emotion, confidence, face_location, created_at FROM detections"
            params = []
            
            # Add filters
            conditions = []
            if camera_id:
                conditions.append("camera_id = %s")
                params.append(camera_id)
            
            if from_time:
                conditions.append("timestamp >= %s")
                params.append(from_time)
                
            if to_time:
                conditions.append("timestamp <= %s")
                params.append(to_time)
                
            if conditions:
                query += " WHERE " + " AND ".join(conditions)
            
            # Add order and limit
            query += " ORDER BY timestamp DESC LIMIT %s"
            params.append(limit)
            
            cursor.execute(query, params)
            
            detections = []
            for row in cursor.fetchall():
                detections.append({
                    "id": row[0],
                    "camera_id": row[1],
                    "timestamp": row[2],
                    "emotion": row[3],
                    "confidence": row[4],
                    "face_location": row[5],
                    "created_at": row[6].isoformat() if row[6] else None
                })
            
            cursor.close()
            return detections
        except Exception as e:
            print(f"Error getting detections: {str(e)}")
            return []
    
    def add_camera(self, camera_id, name, url, camera_type):
        try:
            cursor = self.conn.cursor()
            cursor.execute(
                "INSERT INTO cameras (id, name, url, type) VALUES (%s, %s, %s, %s)",
                (camera_id, name, url, camera_type)
            )
            self.conn.commit()
            cursor.close()
            return True
        except Exception as e:
            print(f"Error adding camera: {str(e)}")
            return False 