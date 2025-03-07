from flask import Flask, request, jsonify, session, send_file
from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin, login_user, LoginManager, login_required, logout_user, current_user
from flask_wtf import FlaskForm
from flask_bcrypt import Bcrypt
from flask_cors import CORS
# from flask_session import Session
import pandas as pd
import subprocess
import json
import os

app = Flask(__name__)
CORS(app, supports_credentials=True)
bcrypt = Bcrypt(app)

CSV_FILE_PATH = "successful_applications.csv"
# EXCEL_FILE_PATH = "submitted_applications.xlsx"


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

@app.route('/api/apply-internships', methods=["POST"])
def apply_internships():
    try:
        data = request.get_json()
        if not data or 'profile' not in data or 'cover' not in data:
            return jsonify({"success": False, "message": "Profile and cover letter required"}), 400

        puppeteer_script = os.path.abspath(os.path.join(os.path.dirname(__file__), "puppeteer", "apply_internships.js"))

        process = subprocess.Popen(["node", puppeteer_script, json.dumps(data)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        output, error = process.communicate()

        if process.returncode == 0:
            return jsonify({"success": True, "message": "Applications submitted!", "result": output.decode().strip()})
        else:
            return jsonify({"success": False, "message": "Failed to apply", "error": error.decode().strip()}), 500
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500
    
@app.route('/api/submitted-applications', methods=["GET"])
def get_submitted_applications():
    csv_path = os.path.join(os.path.dirname(__file__), "successful_applications.csv")

    if not os.path.exists(csv_path):
        return jsonify({"error": "CSV file not found"}), 404
    
    df = pd.read_csv(csv_path)

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
        
        # Update the Excel file after adding new data
        # update_excel()
        
        return jsonify({"message": "Application submitted successfully"}), 200
    except Exception as e:
        print("Error:", e)
        return jsonify({"error": "Failed to submit application"}), 500

# Route to download the Excel file
# @app.route("/download-excel", methods=["GET"])
# def download_excel():
#     # Check if the Excel file exists
#     if os.path.exists(EXCEL_FILE_PATH):
#         return send_file(EXCEL_FILE_PATH, as_attachment=True)
#     else:
#         return jsonify({"error": "No data available"}), 404


# def update_excel():
#     if os.path.exists(CSV_FILE_PATH):
#         df = pd.read_csv(CSV_FILE_PATH)

#         if len(df) > 1:
#             header = df.columns.tolist()
#             data = df.iloc[1:]

#             data.reset_index(drop=True, inplace=True)

#             data.to_excel(EXCEL_FILE_PATH, index=False, header=header)

#         else:
#             pd.DataFrame(columns=df.columns).to_excel(EXCEL_FILE_PATH, index=False)

    
if __name__ == '__main__':
    app.run(debug=True)
