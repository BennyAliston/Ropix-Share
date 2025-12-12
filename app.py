import os
from pathlib import Path
import hashlib
import binascii
from flask import Flask, request, jsonify, Response, send_from_directory
import mimetypes
import re
from datetime import datetime
from flask_socketio import SocketIO, emit
import base64
import uuid
from metadata_utils import extract_metadata
import zipfile
import io

app = Flask(__name__)
app.secret_key = os.urandom(24)
socketio = SocketIO(app, cors_allowed_origins="*", ping_timeout=60, ping_interval=25)
BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIST = BASE_DIR / 'frontend' / 'dist'
app.config['UPLOAD_FOLDER'] = str(BASE_DIR)

# In-memory file storage for direct sharing
active_transfers = {}
file_metadata = {}

CHUNK_SIZE = 64 * 1024  # 64KB chunks strike a balance between latency and overhead

# Supported preview file types with MIME type validation
PREVIEW_TYPES = {
    'image': {
        'extensions': ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'],
        'mime_types': ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp', 'image/svg+xml', 'image/x-icon']
    },
    'video': {
        'extensions': ['.mp4', '.webm', '.ogg', '.avi', '.mov', '.mkv', '.flv', '.wmv'],
        'mime_types': ['video/mp4', 'video/webm', 'video/ogg', 'video/x-msvideo', 'video/quicktime', 'video/x-matroska', 'video/x-flv', 'video/x-ms-wmv']
    },
    'audio': {
        'extensions': ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'],
        'mime_types': ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/flac', 'audio/aac']
    },
    'document': {
        'extensions': ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'],
        'mime_types': ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                      'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation']
    },
    'code': {
        'extensions': ['.py', '.js', '.html', '.css', '.json', '.xml', '.java', '.cpp', '.c', '.cs', '.php', '.rb', '.go', '.ts', '.jsx', '.tsx'],
        'mime_types': ['text/x-python', 'text/javascript', 'text/html', 'text/css', 'application/json', 'text/xml', 
                      'text/x-java', 'text/x-c++', 'text/x-c', 'text/x-csharp', 'text/x-php', 'text/x-ruby', 'text/x-go', 'text/typescript']
    },
    'text': {
        'extensions': ['.txt', '.md', '.csv', '.log', '.ini', '.conf', '.yml', '.yaml'],
        'mime_types': ['text/plain', 'text/markdown', 'text/csv']
    },
    'archive': {
        'extensions': ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'],
        'mime_types': ['application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed', 
                      'application/x-tar', 'application/gzip', 'application/x-bzip2']
    },
    'executable': {
        'extensions': ['.exe', '.msi', '.app', '.dmg', '.deb', '.rpm'],
        'mime_types': ['application/x-msdownload', 'application/x-msi', 'application/x-executable']
    }
}

def get_file_type(filename):
    """Determine the type of file based on its extension"""
    if not filename:
        return 'other'
        
    ext = os.path.splitext(filename)[1].lower()
    
    # Check if it's a directory
    if not ext and os.path.isdir(os.path.join(app.config['UPLOAD_FOLDER'], filename)):
        return 'folder'
        
    # Check file extension against known types
    for file_type, info in PREVIEW_TYPES.items():
        if ext in info['extensions']:
            return file_type
            
    # Try to guess based on mime type
    mime_type = mimetypes.guess_type(filename)[0]
    if mime_type:
        for file_type, info in PREVIEW_TYPES.items():
            if mime_type in info['mime_types']:
                return file_type
                
    return 'other'

def get_file_icon(file_type):
    """Get the appropriate icon class for the file type"""
    icon_map = {
        'image': 'fa-image',
        'video': 'fa-video',
        'audio': 'fa-music',
        'document': 'fa-file-alt',
        'code': 'fa-code',
        'text': 'fa-file-text',
        'archive': 'fa-file-archive',
        'executable': 'fa-cog',
        'folder': 'fa-folder',
        'other': 'fa-file'
    }
    return icon_map.get(file_type, 'fa-file')


def format_file_size(size):
    """Format file size in human-readable format"""
    try:
        size = float(size)  # Ensure size is a number
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if size < 1024.0:
                return f"{size:.2f} {unit}"
            size /= 1024.0
        return f"{size:.2f} TB"
    except (ValueError, TypeError):
        return "0 B"  # Return a default value if size is invalid


def compute_manifest_signature(manifest):
    """
    Build a deterministic signature for the manifest so receivers can verify
    they got an untampered chunk list. We purposely rely on predictable strings
    instead of arbitrary JSON ordering to make client-side verification easy.
    """
    chunk_hashes = '|'.join(chunk['hash'] for chunk in manifest['chunks'])
    payload = f"{manifest['file_id']}:{manifest['total_size']}:{len(manifest['chunks'])}:{chunk_hashes}"
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def compute_chunk_manifest(file_id, file_bytes):
    """Split a file buffer into hashed chunks and return manifest + signature."""
    chunks = []
    offset = 0
    index = 0
    total_size = len(file_bytes)

    while offset < total_size:
        chunk_bytes = file_bytes[offset:offset + CHUNK_SIZE]
        chunk_hash = hashlib.sha256(chunk_bytes).hexdigest()
        chunks.append({
            'index': index,
            'offset': offset,
            'size': len(chunk_bytes),
            'hash': chunk_hash
        })
        index += 1
        offset += len(chunk_bytes)

    manifest = {
        'file_id': file_id,
        'chunk_size': CHUNK_SIZE,
        'total_size': total_size,
        'chunks': chunks
    }
    return manifest, compute_manifest_signature(manifest)


def sanitize_relative_path(path_value):
    """
    Ensure any relative path supplied by peers cannot break out of our controlled
    scope. We strip dangerous tokens and normalize separators so that the value
    can only ever describe a logical folder structure for display purposes.
    """
    if not path_value:
        return ''

    normalized = path_value.replace('\\', '/').strip()
    normalized = re.sub(r'/+', '/', normalized)
    safe_parts = [
        part for part in normalized.split('/')
        if part not in ('', '.', '..')
    ]
    return '/'.join(safe_parts)


def resolve_file_metadata(file_id):
    """
    Map the user-visible file ID to the safe metadata entry. This ensures peers
    cannot coerce us into reading arbitrary paths because all lookups go through
    server-generated IDs.
    """
    metadata = file_metadata.get(file_id)
    if not metadata:
        raise KeyError('File not found')
    if 'content' not in metadata:
        raise ValueError('Missing file content')
    if 'manifest' not in metadata or 'manifest_signature' not in metadata:
        raise ValueError('Missing manifest data')
    return metadata


@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path and (FRONTEND_DIST / path).exists():
        return send_from_directory(FRONTEND_DIST, path)
    
    # Check if it's an API route that wasn't caught (just in case, though Flask handles this)
    if path.startswith('api/'):
        return jsonify({'error': 'Not found'}), 404
        
    index_file = FRONTEND_DIST / 'index.html'
    if index_file.exists():
        return send_from_directory(FRONTEND_DIST, 'index.html')
    return jsonify({
        'message': 'React build not found. Run `npm install && npm run dev` inside the frontend/ directory for development, or build the project with `npm run build`.'
    })

@socketio.on('connect')
def handle_connect():
    print('Client connected')
    # Send current files to newly connected client
    for file_id, metadata in file_metadata.items():
        emit('file_available', {
            'file_id': file_id,
            'filename': metadata['filename'],
            'file_type': metadata['file_type'],
            'mime_type': metadata['mime_type'],
            'size': metadata['size'],
            'size_display': format_file_size(metadata['size']),
            'device_info': metadata['device_info'],
            'safe_path': metadata.get('safe_path', metadata['filename']),
            'chunks': len(metadata['manifest']['chunks']),
            'uploaded_at': metadata['created_at']
        })

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')

@socketio.on('request_file')
def handle_file_request(data):
    file_id = data.get('file_id')
    if not file_id:
        emit('file_error', {'error': 'Missing file_id'})
        return
    try:
        metadata = resolve_file_metadata(file_id)
    except (KeyError, ValueError) as exc:
        emit('file_error', {'error': str(exc)})
        return
    
    manifest = metadata['manifest']
    emit('file_manifest', {
        'file_id': file_id,
        'filename': metadata['filename'],
        'mime_type': metadata['mime_type'],
        'size': metadata['size'],
        'manifest': manifest,
        'manifest_signature': metadata['manifest_signature']
    })

    try:
        file_bytes = base64.b64decode(metadata['content'])
    except (ValueError, binascii.Error) as exc:  # need binascii import?
        emit('file_error', {'error': f'Corrupted file content: {exc}'})
        return

    for chunk in manifest['chunks']:
        start = chunk['offset']
        end = start + chunk['size']
        chunk_bytes = file_bytes[start:end]
        emit('file_chunk', {
            'file_id': file_id,
            'chunk_index': chunk['index'],
            'size': chunk['size'],
            'hash': chunk['hash'],
            'content': base64.b64encode(chunk_bytes).decode('utf-8')
        })

    emit('file_transfer_complete', {'file_id': file_id})


@app.route('/upload', methods=['POST'])
def upload_file():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        device_info = request.form.get('device_info', 'Unknown Device')
        requested_path = request.form.get('path', file.filename)
        safe_relative_path = sanitize_relative_path(requested_path) or os.path.basename(file.filename)
        
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400

        # Read file content into memory
        file_content = file.read()
        file_size = len(file_content)
        
        if file_size == 0:
            return jsonify({'error': 'Empty file'}), 400
        
        # Generate unique file ID
        file_id = str(uuid.uuid4())
        manifest, manifest_signature = compute_chunk_manifest(file_id, file_content)
        
        # Store file metadata
        file_type = get_file_type(file.filename)
        mime_type = mimetypes.guess_type(file.filename)[0] or 'application/octet-stream'
        
        file_metadata[file_id] = {
            'filename': file.filename,
            'file_type': file_type,
            'mime_type': mime_type,
            'size': file_size,
            'content': base64.b64encode(file_content).decode('utf-8'),
            'created_at': datetime.now().isoformat(),
            'device_info': device_info,
            'safe_path': safe_relative_path,
            'manifest': manifest,
            'manifest_signature': manifest_signature
        }
        metadata = file_metadata[file_id]
        
        # Broadcast to all connected clients
        socketio.emit('file_available', {
            'file_id': file_id,
            'filename': file.filename,
            'file_type': file_type,
            'mime_type': metadata['mime_type'],
            'size': metadata['size'],
            'size_display': format_file_size(metadata['size']),
            'device_info': metadata['device_info'],
            'safe_path': metadata.get('safe_path', metadata['filename']),
            'chunks': len(metadata['manifest']['chunks']),
            'uploaded_at': metadata['created_at']
        })
        
        return jsonify({
            'success': True,
            'file_id': file_id,
            'filename': file.filename,
            'type': file_type
        })
                
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/download/<file_id>')
def download_file(file_id):
    try:
        metadata = resolve_file_metadata(file_id)
        file_content = base64.b64decode(metadata['content'])
        
        return Response(
            file_content,
            mimetype=metadata['mime_type'],
            headers={
                'Content-Disposition': f'attachment; filename="{metadata["filename"]}"',
                'Content-Length': str(metadata['size'])
            }
        )
    except KeyError:
        return jsonify({'error': 'File not found'}), 404
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/file-info/<file_id>')
def file_info(file_id):
    try:
        if file_id not in file_metadata:
            return jsonify({'error': 'File not found'}), 404
            
        metadata = file_metadata[file_id]
        
        return jsonify({
            'name': metadata['filename'],
            'type': metadata['file_type'],
            'mime_type': metadata['mime_type'],
            'size': metadata['size'],
            'size_display': format_file_size(metadata['size']),
            'created': metadata['created_at'],
            'device_info': metadata['device_info'],
            'safe_path': metadata.get('safe_path', metadata['filename']),
            'integrity': {
                'chunks': len(metadata['manifest']['chunks']),
                'chunk_size': metadata['manifest']['chunk_size'],
                'manifest_signature': metadata['manifest_signature']
            }
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/files')
def api_files():
    try:
        files = []
        for file_id, metadata in file_metadata.items():
            files.append({
                'file_id': file_id,
                'filename': metadata['filename'],
                'file_type': metadata['file_type'],
                'mime_type': metadata['mime_type'],
                'size': metadata['size'],
                'size_display': format_file_size(metadata['size']),
                'device_info': metadata['device_info'],
                'safe_path': metadata.get('safe_path', metadata['filename']),
                'uploaded_at': metadata['created_at'],
                'chunks': len(metadata['manifest']['chunks'])
            })
        return jsonify({'files': files})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/metadata/<file_id>')
def get_metadata(file_id):
    try:
        metadata = resolve_file_metadata(file_id)
        
        # Decode content for extraction
        try:
            file_content = base64.b64decode(metadata['content'])
        except (ValueError, binascii.Error):
            return jsonify({'error': 'Corrupted file content'}), 500
            
        extracted = extract_metadata(file_content, metadata['file_type'], metadata['mime_type'])
        
        return jsonify({
            'filename': metadata['filename'],
            'base_info': {
                'type': metadata['file_type'],
                'mime_type': metadata['mime_type'], 
                'size': format_file_size(metadata['size']),
                'uploaded': metadata['created_at']
            },
            'details': extracted
        })
    except KeyError:
        return jsonify({'error': 'File not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/preview/<file_id>')
def preview_file(file_id):
    try:
        metadata = resolve_file_metadata(file_id)
        file_content = base64.b64decode(metadata['content'])
        
        if metadata['file_type'] == 'text' or metadata['file_type'] == 'code':
            try:
                content = file_content.decode('utf-8')
                return jsonify({
                    'content': content, 
                    'type': metadata['file_type'], 
                    'info': {
                        'name': metadata['filename'],
                        'type': metadata['file_type'],
                        'mime_type': metadata['mime_type'],
                        'size': metadata['size'],
                        'size_display': format_file_size(metadata['size']),
                        'created': metadata['created_at']
                    }
                })
            except UnicodeDecodeError:
                return jsonify({'error': 'File contains binary data and cannot be previewed as text'}), 400
        else:
            return Response(
                file_content,
                mimetype=metadata['mime_type'],
                headers={'Content-Disposition': f'inline; filename="{metadata["filename"]}"'}
            )
    except KeyError:
        return jsonify({'error': 'File not found'}), 404
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/delete/<file_id>', methods=['POST'])
def delete_file(file_id):
    try:
        metadata = resolve_file_metadata(file_id)
        device_info = request.form.get('device_info', 'Unknown Device')
        filename = metadata['filename']
        
        # Remove from memory
        del file_metadata[file_id]
        
        # Broadcast deletion to all clients
        socketio.emit('file_deleted', {
            'file_id': file_id,
            'filename': filename,
            'device_info': device_info
        })
        
        return jsonify({'success': True})
    except KeyError:
        return jsonify({'error': 'File not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/download-all')
def download_all():
    try:
        memory_file = io.BytesIO()
        with zipfile.ZipFile(memory_file, 'w') as zf:
            for file_id, metadata in file_metadata.items():
                content = base64.b64decode(metadata['content'])
                zf.writestr(metadata['filename'], content)
        memory_file.seek(0)
        return Response(
            memory_file,
            mimetype='application/zip',
            headers={
                'Content-Disposition': 'attachment; filename="ropix-files.zip"'
            }
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/delete-all', methods=['POST'])
def delete_all():
    try:
        file_metadata.clear()
        socketio.emit('files_cleared')
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000) 