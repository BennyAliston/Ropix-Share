# P2P-Sharing

**P2P-Sharing** is a lightweight, real-time, peer-to-peer file sharing web application built using Flask and Socket.IO. It enables devices on the same network (or across networks, if hosted) to instantly share files with each other without storing them on the server. All transfers are direct, ephemeral, and streamed in real time.

The goal of this project is to create an accessible, browser-based alternative to tools like SHAREit or AirDrop simple, fast, and requiring no installation.

## ✨ Features

- Real-time device discovery  
- Direct file sharing (no permanent storage)  
- Live updates via WebSockets  
- Chunk-based streaming  
- File metadata preview  
- Simple, responsive frontend  

## 📁 Project Structure

```
P2P-Sharing/
│
├── app.py
├── frontend/
├── scripts/
├── requirements.txt
└── vienv/
```

## 🛠️ Installation & Setup

### 1. Clone the Repository
```
git clone https://github.com/your-username/P2P-Sharing.git
cd P2P-Sharing
```

### 2. Create and Activate a Virtual Environment
```
python3 -m venv venv
source venv/bin/activate   # Linux/macOS
venv\Scripts\activate    # Windows
```

### 3. Install Dependencies
```
pip install -r requirements.txt
```

### 4. Run the Server
```
python app.py
```

Access the app at:
```
http://localhost:5000
```

## 📡 How It Works

1. Devices connect and register with the server.  
2. The backend broadcasts device presence to all clients.  
3. Users select files to share.  
4. Files are stored temporarily in memory (metadata + streaming).  
5. Other devices instantly see shared files.  
6. Downloads stream in chunks.  
7. Files disappear once the sender deletes them.

## 🧩 Technologies Used

- Flask  
- Flask-SocketIO  
- HTML, CSS, JavaScript  
- Base64 previews  
- Python 3.x  

## 🚀 Future Improvements

- Neubrutalism + terminal-inspired UI  
- Offline/LAN auto device detection  
- Password-protected sharing rooms  
- QR-based quick connect  

## 📜 License

MIT License
