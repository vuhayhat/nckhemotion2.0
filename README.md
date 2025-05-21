# Real-time Facial Emotion Recognition System

This project implements a real-time facial emotion recognition system with separate frontend and backend components.

## Overview

The system uses:
- **Frontend**: Node.js with Express.js, WebSockets for real-time communication
- **Backend**: Python with FastAPI, DeepFace for emotion recognition
- **Database**: PostgreSQL for storing detection results

## Features

- Real-time face detection and emotion recognition
- Support for both webcam and IP cameras
- Emotion statistics and detection history
- Admin panel for camera management

## Project Structure

```
project/
├── backend/            # Python backend
│   ├── app/            # FastAPI application
│   │   ├── __init__.py
│   │   ├── main.py     # Main API endpoints
│   │   └── db_manager.py # Database operations
│   ├── config.env      # Environment variables
│   ├── requirements.txt # Python dependencies
│   └── run.py          # Entry point
│
└── frontend/           # Node.js frontend
    ├── public/         # Static files
    │   ├── css/        # Stylesheets
    │   ├── js/         # Client-side JavaScript
    │   └── index.html  # Main HTML page
    ├── config.env      # Environment variables
    ├── package.json    # Node.js dependencies
    └── server.js       # Express server
```

## Setup Instructions

### Prerequisites

- Node.js (v14+)
- Python (v3.8+)
- PostgreSQL (v12+)

### Backend Setup

1. Create a PostgreSQL database:
   ```sql
   CREATE DATABASE emotion_recognition;
   ```

2. Install Python dependencies:
   ```bash
   cd project/backend
   pip install -r requirements.txt
   ```

3. Configure environment variables in `config.env`

4. Run the backend server:
   ```bash
   python run.py
   ```

### Frontend Setup

1. Install Node.js dependencies:
   ```bash
   cd project/frontend
   npm install
   ```

2. Configure environment variables in `config.env`

3. Run the frontend server:
   ```bash
   npm run dev
   ```

4. Open your browser and navigate to `http://localhost:3000`

## Usage

1. Login with default credentials (username: admin, password: admin)
2. Add cameras (webcam or IP camera)
3. Select a camera from the sidebar
4. Click "Start" to begin emotion recognition
5. View real-time results and statistics

## License

MIT 