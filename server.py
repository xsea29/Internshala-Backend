from flask import Flask, request, jsonify, session, send_file, Response
from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin, login_user, LoginManager, login_required, logout_user, current_user
from flask_wtf import FlaskForm
from flask_bcrypt import Bcrypt
from flask_cors import CORS
import pandas as pd
import subprocess
import json
import os
import time
import uuid
from threading import Thread

app = Flask(__name__)
CORS(app, origins=[
    "https://internshala-automation-tool.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173"
], supports_credentials=True)
bcrypt = Bcrypt(app)

# Create data directories
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
SESSIONS_DIR = os.path.join(os.path.dirname(__file__), "sessions")
AUTH_DIR = os.path.join(os.path.dirname(__file__), "auth")

for directory in [DATA_DIR, SESSIONS_DIR, AUTH_DIR]:
    os.makedirs(directory, exist_ok=True)

CSV_FILE_PATH = os.path.join(DATA_DIR, "successful_applications.csv")
RESULT_CSV_PATH = os.path.join(DATA_DIR, "result.csv")


# Clear the CSV but keep the header when the app starts
def clear_csv_keep_header():
    if os.path.exists(CSV_FILE_PATH):
        with open(CSV_FILE_PATH, 'r') as file:
            lines = file.readlines()
        
        if lines:
            header = lines[0]
            with open(CSV_FILE_PATH, 'w') as file:
                file.write(header)  

clear_csv_keep_header()

basedir = os.path.abspath(os.path.dirname(__file__))

app.config['SQLALCHEMY_DATABASE_URI'] = f"sqlite:///{os.path.join(basedir, 'database.db')}"
app.config['SECRET_KEY'] = 'supersecretkey'
app.config['SESSION_TYPE'] = 'filesystem'

# Session(app)

db = SQLAlchemy(app)

login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = "login"

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(20), nullable=True, unique=True)
    password = db.Column(db.String(100), nullable=True)

with app.app_context():
    db.create_all()

@app.route('/api/login', methods=["GET", "POST"])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')

    user = User.query.filter_by(username=username).first()

    if user and bcrypt.check_password_hash(user.password, password):
        login_user(user)
        session['user_id'] = user.id
        return jsonify({"success": True, "message": "Login successfully"})
    return jsonify({"success": False, "message": "Invalid username or password"}), 401


@app.route('/api/register', methods=["POST"])
def register():
    if request.content_type != 'application/json':
        return jsonify({"error": "Invalid content type, must be application/json"}), 415
    
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')

    existing_user = User.query.filter_by(username=username).first()

    if existing_user:
        return jsonify({"success": False, "message": "Username already exists!"}), 400
    
    hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
    new_user = User(username=username, password=hashed_password)
    db.session.add(new_user)
    db.session.commit()

    return jsonify({"success": True, "message": "Registration successful!"})

@app.route('/logout', methods=["POST"])
# @login_required
def logout():
    if request.method == "POST":
        logout_user()
        session.clear() 
        return jsonify({"success": True, "message": "Logged out successfully!"}), 200
    return jsonify({"error": "Invalid request method"}), 405

# @app.route('/api/apply-internships', methods=["POST"])
# def apply_internships():
#     try:
#         data = request.get_json()
#         if not data or 'profile' not in data or 'cover' not in data:
#             return jsonify({"success": False, "message": "Profile and cover letter required"}), 400

#         puppeteer_script = os.path.abspath(os.path.join(os.path.dirname(__file__), "puppeteer", "apply_internships.js"))

#         process = subprocess.Popen(["node", puppeteer_script, json.dumps(data)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
#         output, error = process.communicate()

#         if process.returncode == 0:
#             return jsonify({"success": True, "message": "Applications submitted!", "result": output.decode().strip()})
#         else:
#             return jsonify({"success": False, "message": "Failed to apply", "error": error.decode().strip()}), 500
#     except Exception as e:
#         return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/apply-internships', methods=["POST"])
def apply_internships():
    try:
        data = request.get_json()
        if not data or 'profile' not in data or 'cover' not in data:
            return jsonify({"success": False, "message": "Profile and cover letter required"}), 400

        # Generate unique session ID
        session_id = str(uuid.uuid4())
        
        # Run automation in background thread
        def run_automation():
            puppeteer_script = os.path.abspath(os.path.join(os.path.dirname(__file__), "puppeteer", "apply_internships.js"))
            process = subprocess.Popen(
                ["node", puppeteer_script, json.dumps(data), session_id],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            output, error = process.communicate()
            print("Puppeteer Output:", output.decode().strip())
            print("Puppeteer Error:", error.decode().strip())
        
        thread = Thread(target=run_automation)
        thread.daemon = True
        thread.start()
        
        return jsonify({"success": True, "session_id": session_id})
    except Exception as e:
        print("Exception in Puppeteer:", str(e))
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/apply-internships-stream', methods=["GET"])
def apply_internships_stream():
    """SSE endpoint for real-time progress tracking"""
    session_id = request.args.get('session')
    
    if not session_id:
        return jsonify({"error": "Session ID required"}), 400
    
    def generate():
        progress_file = os.path.join(SESSIONS_DIR, f"progress_{session_id}.json")
        last_data = None
        
        try:
            # Wait for file to be created and stream progress
            while True:
                if os.path.exists(progress_file):
                    try:
                        with open(progress_file, 'r') as f:
                            progress_data = json.load(f)
                            
                            # Only send if data changed
                            if progress_data != last_data:
                                yield f"data: {json.dumps(progress_data)}\n\n"
                                last_data = progress_data.copy()
                            
                            # Check if complete or stopped
                            if progress_data.get('complete') or progress_data.get('stop'):
                                # Cleanup file
                                try:
                                    os.remove(progress_file)
                                except:
                                    pass
                                break
                    except (json.JSONDecodeError, IOError):
                        pass  # Ignore incomplete JSON writes or file read errors
                
                time.sleep(0.5)  # Poll every 500ms
        except Exception as e:
            yield f"data: {{\"error\": \"{str(e)}\"}}\n\n"
    
    return Response(generate(), mimetype='text/event-stream')


@app.route('/api/stop-automation', methods=["POST"])
def stop_automation():
    try:
        data = request.get_json()
        session_id = data.get('session_id')
        
        if not session_id:
            return jsonify({"success": False, "message": "Session ID required"}), 400
        
        progress_file = os.path.join(SESSIONS_DIR, f"progress_{session_id}.json")
        
        if not os.path.exists(progress_file):
            return jsonify({"success": False, "message": "Session not found"}), 404
        
        # Read file, set stop: true, write back
        with open(progress_file, 'r') as f:
            progress_data = json.load(f)
        
        progress_data['stop'] = True
        progress_data['status'] = 'Stopped by user'
        
        with open(progress_file, 'w') as f:
            json.dump(progress_data, f)
        
        return jsonify({"success": True, "message": "Automation stopped"})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500
    
@app.route('/api/submitted-applications', methods=["GET"])
def get_submitted_applications():
    if not os.path.exists(CSV_FILE_PATH):
        return jsonify({"error": "CSV file not found"}), 404
    
    df = pd.read_csv(CSV_FILE_PATH)

    result = df.to_dict(orient="records")

    return jsonify(result)

@app.route("/submit-application", methods=["POST"])
def submit_application():
    data = request.json  # Assume JSON data is sent from the frontend
    try:
        # Append new application to the CSV file
        new_df = pd.DataFrame([data])
        if os.path.exists(CSV_FILE_PATH):
            new_df.to_csv(CSV_FILE_PATH, mode='a', header=False, index=False)
        else:
            new_df.to_csv(CSV_FILE_PATH, index=False)
                
        return jsonify({"message": "Application submitted successfully"}), 200
    except Exception as e:
        print("Error:", e)
        return jsonify({"error": "Failed to submit application"}), 500
    
if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
