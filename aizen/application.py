import os
import uuid
import re
from pathlib import Path

from flask import Flask, request, jsonify, render_template
from groq import Groq
from openai import OpenAI
import PyPDF2
import requests
import json
import time
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

# Missing credentials should disable their features, not prevent the app from starting.
groq_api_key = os.environ.get("GROQ_API_KEY")
client = Groq(api_key=groq_api_key) if groq_api_key else None

nvidia_api_key = os.environ.get("NVIDIA_API_KEY")
nvidia_client = (
    OpenAI(base_url="https://integrate.api.nvidia.com/v1", api_key=nvidia_api_key)
    if nvidia_api_key
    else None
)

app = Flask(__name__, template_folder="templates", static_folder="static")
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024
app.config["HOST"] = os.environ.get("HOST", "127.0.0.1")
app.config["PORT"] = int(os.environ.get("PORT", "5000"))
app.config["DEBUG"] = os.environ.get("FLASK_DEBUG", "").lower() == "true"
INSTANCE_DIR = PROJECT_ROOT / "instance"
INSTANCE_DIR.mkdir(exist_ok=True)
CHATS_FILE = os.environ.get("AIZEN_CHATS_FILE", str(INSTANCE_DIR / "chats.json"))

MAX_MEMORY = 20
MAX_OUTPUT_TOKENS = 700
# Aizen Persona Prompt
SYSTEM_PROMPT = """You are Aizen, a highly sophisticated, professional, and intelligent AI assistant.
Your characteristics:
1. Wisdom and Clarity: Provide deep, well-structured, and clear responses.
2. Professionalism: Maintain a calm, helpful, and polite tone at all times.
3. Efficiency: Be direct when needed, but thorough when the topic is complex.
4. Versatility: You are an expert in various fields, from coding to creative writing and data analysis.

Identity: Your name is Aizen. You are a next-generation AI designed to assist with precision and intelligence.
Always aim to exceed user expectations with the quality of your insights.

User Recognition: The user you are speaking with is named Sagar. ONLY use their name in the very first greeting of a new conversation. DO NOT say their name again in subsequent queries to keep responses concise.
"""

def load_chats():
    if not os.path.exists(CHATS_FILE):
        return {}
    try:
        with open(CHATS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        app.logger.exception("Failed to load chat history from %s", CHATS_FILE)
        raise

def save_chats(chats):
    temporary_path = f"{CHATS_FILE}.{uuid.uuid4().hex}.tmp"
    try:
        with open(temporary_path, "w", encoding="utf-8") as f:
            json.dump(chats, f, indent=2)
        os.replace(temporary_path, CHATS_FILE)
    finally:
        if os.path.exists(temporary_path):
            os.remove(temporary_path)

context_info = ""

def internet_search(query):
    try:
        # Structured search for live data
        response = requests.get(
            "https://api.duckduckgo.com/",
            params={"q": query, "format": "json"},
            timeout=5.0,
        )
        data = response.json()
        
        abstract = data.get("AbstractText")
        if abstract:
            return abstract
            
        related = data.get("RelatedTopics", [])
        if related and len(related) > 0:
            first = related[0]
            if isinstance(first, dict) and "Text" in first:
                return first["Text"]
                
        return f"I searched for '{query}' but couldn't find specific live details. I will provide my best general knowledge instead."
    except Exception as e:
        return f"Search Error: {e}"

def strip_markdown(text: str) -> str:
    text = re.sub(r'[*_]{1,3}([^*_]+)[*_]{1,3}', r'\1', text)
    text = re.sub(r'```.*?```', 'code block provided', text, flags=re.DOTALL)
    text = re.sub(r'`([^`]+)`', r'\1', text)
    text = re.sub(r'#+\s+', '', text)
    return text

@app.route("/")
def index():
    return render_template("index.html")

def get_city_from_coords(lat, lon):
    try:
        url = f"https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lon}"
        headers = {'User-Agent': 'AizenAI/1.0'}
        r = requests.get(url, headers=headers, timeout=5.0).json()
        address = r.get("address", {})
        return address.get("city", address.get("town", address.get("village", address.get("county", address.get("state", "")))))
    except:
        return ""

def process_chat(question, image_data=None, location=None, chat_id="default"):
    global context_info
    
    chats = load_chats()
    raw_question = question
    
    if chat_id not in chats:
        clean_title = raw_question.strip()
        if "USER QUESTION:" in clean_title:
            clean_title = clean_title.split("USER QUESTION:")[-1].strip()
        if clean_title.startswith("SYSTEM:"):
            clean_title = re.sub(r'SYSTEM:[^\n]*\n?', '', clean_title).strip()
        display_title = (clean_title[:32] + "...") if len(clean_title) > 32 else (clean_title or "New Chat")
        chats[chat_id] = {
            "title": display_title,
            "messages": [
                {
                    "role": "system",
                    "content": SYSTEM_PROMPT
                }
            ],
            "updated_at": time.time()
        }
    
    chat_thread = chats[chat_id]
    messages = chat_thread["messages"]
    
    city = ""
    if location and location.get("lat") and location.get("lon"):
        city = get_city_from_coords(location["lat"], location["lon"])
        loc_str = f"{city} " if city else ""
        question = f"SYSTEM: User's current location is {loc_str}(Lat: {location.get('lat')}, Lon: {location.get('lon')}).\n" + question

    # --- Real-Time Triggers ---
    lower_q = question.lower()
    live_keywords = ["weather", "emergency", "police", "hospital", "news", "stock", "price of"]
    if any(k in lower_q for k in live_keywords):
        search_query = question
        if city and "weather" in lower_q and city.lower() not in lower_q:
            search_query += f" in {city}"
        
        search_result = internet_search(search_query)
        if search_result and not search_result.startswith("Search Error"):
            question = f"SYSTEM LIVE DATA: {search_result}\n\nUSER QUESTION: {question}"

    if context_info:
        question = f"SYSTEM: The user has uploaded a document. Here is its content:\n{context_info}\n\nUSER QUESTION: {question}"

    messages.append({"role": "user", "content": question})

    if image_data:
        if nvidia_client is None:
            return {"error": "Image analysis is unavailable. Add NVIDIA_API_KEY to .env and restart the app."}
        try:
            # Ensure proper Base64 prefixing if missing
            if not image_data.startswith("data:image"):
                image_url = f"data:image/jpeg;base64,{image_data}"
            else:
                image_url = image_data

            # Use NVIDIA's Llama 3.2 Vision model for reliable image understanding
            completion = nvidia_client.chat.completions.create(
                model="meta/llama-3.2-11b-vision-instruct",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": f"You are Aizen, a highly intelligent AI assistant with vision capabilities. Analyze this image in detail. Identify all objects, their positions, text, colors, and the overall scene. Question to answer: {question}. Describe what you see clearly and comprehensively."
                            },
                            {
                                "type": "image_url",
                                "image_url": {"url": image_url}
                            }
                        ]
                    }
                ],
                temperature=0.7,
                max_tokens=1024,
            )
            reply = completion.choices[0].message.content
        except Exception as e:
            reply = f"I apologize, I encountered an issue analyzing the image: {str(e)}. Please ensure the image is clear and try again."
        messages.append({"role": "assistant", "content": reply})
    else:
        try:
            response = client.chat.completions.create(
                model="qwen/qwen3.8-27b",
                messages=messages,
                max_tokens=MAX_OUTPUT_TOKENS,
            )
            reply = response.choices[0].message.content
            messages.append({"role": "assistant", "content": reply})
        except Exception as e:
            # Fallback to groq/compound or openai/gpt-oss-120b
            try:
                response = client.chat.completions.create(
                    model="groq/compound",
                    messages=messages,
                    max_tokens=MAX_OUTPUT_TOKENS,
                )
                reply = response.choices[0].message.content
                messages.append({"role": "assistant", "content": reply})
            except Exception as e2:
                if "rate_limit" in str(e).lower() or "rate_limit" in str(e2).lower():
                    reply = "The AI provider's output limit is temporarily reached. Please try again in a minute or ask for a shorter answer."
                else:
                    app.logger.exception("Chat completion failed")
                    reply = "I couldn't reach the AI service just now. Please try again shortly."
                messages.append({"role": "assistant", "content": reply})

    # Enforce memory limit for user/assistant messages (keep system prompt)
    if len(messages) > MAX_MEMORY + 1:
        messages = [messages[0]] + messages[-(MAX_MEMORY):]
        
    chat_thread["messages"] = messages
    chat_thread["updated_at"] = time.time()
    save_chats(chats)

    return {"response": reply}

@app.route("/chat", methods=["POST"])
def chat():
    data = request.json or {}
    question = data.get("message", "")
    image_data = data.get("image", None)
    location = data.get("location", None)
    chat_id = data.get("chat_id", "default")
    if image_data and nvidia_client is None:
        return jsonify({"error": "Image analysis is not configured. Add NVIDIA_API_KEY to .env and restart the app."}), 503
    if not image_data and client is None:
        return jsonify({"error": "Chat is not configured. Add GROQ_API_KEY to .env and restart the app."}), 503
    result = process_chat(question, image_data, location, chat_id)
    if "error" in result:
        return jsonify(result), 503
    return jsonify(result)

@app.route("/upload-pdf", methods=["POST"])
def upload_pdf():
    global context_info
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400
    
    if file and file.filename.lower().endswith('.pdf'):
        try:
            pdf_reader = PyPDF2.PdfReader(file)
            text = ""
            for page in pdf_reader.pages:
                extracted = page.extract_text()
                if extracted: text += extracted
            context_info = text[:200000]
            return jsonify({"message": "Document analyzed successfully. You can now ask questions about it."})
        except Exception as e:
            return jsonify({"error": f"Failed to process PDF: {str(e)}"}), 500
    return jsonify({"error": "Invalid file type. Only PDF is supported."}), 400

@app.route("/chats", methods=["GET"])
def get_chats():
    chats = load_chats()
    result = []
    for cid, data in chats.items():
        if cid == "default" and len(data.get("messages", [])) <= 1:
            continue
        result.append({
            "id": cid,
            "title": data.get("title", "Conversation"),
            "updated_at": data.get("updated_at", 0),
            "message_count": len(data.get("messages", []))
        })
    result.sort(key=lambda x: x.get("updated_at", 0), reverse=True)
    return jsonify(result)

@app.route("/chat/<chat_id>", methods=["GET"])
def get_chat(chat_id):
    chats = load_chats()
    if chat_id in chats:
        return jsonify({
            "id": chat_id,
            "title": chats[chat_id].get("title", "Conversation"),
            "messages": chats[chat_id].get("messages", []),
            "updated_at": chats[chat_id].get("updated_at", 0)
        })
    return jsonify({"error": "Chat not found"}), 404

@app.route("/chat/<chat_id>", methods=["DELETE"])
def delete_chat(chat_id):
    chats = load_chats()
    if chat_id in chats:
        del chats[chat_id]
        save_chats(chats)
        return jsonify({"message": "Chat deleted successfully"})
    return jsonify({"error": "Chat not found"}), 404

@app.route("/list-chats", methods=["GET"])
def list_chats():
    return jsonify(list(load_chats().keys()))

@app.route("/voice-chat", methods=["POST"])
def voice_chat():
    if client is None:
        return jsonify({"error": "Voice transcription is not configured. Add GROQ_API_KEY to .env and restart the app."}), 503
    if "audio" not in request.files:
        return jsonify({"error": "No audio"}), 400
    audio = request.files["audio"]
    chat_id = request.form.get("chat_id", "default")
    path = f"temp_{uuid.uuid4().hex}.webm"
    audio.save(path)
    try:
        with open(path, "rb") as f:
            transcription = client.audio.transcriptions.create(
                file=(os.path.basename(path), f.read(), "audio/webm"),
                model="whisper-large-v3",
                language="en", # Skip language auto-detection for speed
                response_format="text"
            )
        os.remove(path)
        user_text = transcription
        if not user_text:
            return jsonify({"response": "I'm sorry, I couldn't hear you clearly.", "user_text": "", "chat_id": chat_id})
        result = process_chat(user_text, chat_id=chat_id)
        result["user_text"] = user_text
        result["chat_id"] = chat_id
        return jsonify(result)
    except Exception as e:
        if os.path.exists(path): os.remove(path)
        return jsonify({"error": str(e)}), 500

@app.route("/clear", methods=["POST"])
def clear_chat():
    global messages, context_info
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    context_info = ""
    return jsonify({"message": "Context cleared. How can I help you from a fresh perspective?"})

if __name__ == "__main__":
    app.run(host=app.config["HOST"], port=app.config["PORT"], debug=app.config["DEBUG"])
