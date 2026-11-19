from groq import Groq
import speech_recognition as sr
import PyPDF2
import requests
import threading
import keyboard
import asyncio
import edge_tts
import pygame
import os
import time
from dotenv import load_dotenv

load_dotenv()

# ==================================================
# GROQ CLIENT
# ==================================================

groq_api_key = os.environ.get("GROQ_API_KEY")
if not groq_api_key:
    raise RuntimeError("GROQ_API_KEY is missing. Set it in your .env file.")
client = Groq(api_key=groq_api_key)

# ==================================================
# CHAT MEMORY
# ==================================================

messages = [
    {
        "role": "system",
        "content": """
You are an advanced AI assistant.
Help users clearly and professionally.
Keep conversations natural and continuous.
"""
    }
]

MAX_MEMORY = 10

# ==================================================
# SPEECH RECOGNITION
# ==================================================

recognizer = sr.Recognizer()

recognizer.energy_threshold = 300
recognizer.dynamic_energy_threshold = True
recognizer.pause_threshold = 1

# ==================================================
# GLOBAL SPEAK CONTROL
# ==================================================

is_speaking = False

# ==================================================
# STOP SPEAKING ON KEY PRESS
# ==================================================

def monitor_keyboard():

    global is_speaking

    while is_speaking:

        keyboard.read_event()

        if is_speaking:
            pygame.mixer.music.stop()
            is_speaking = False
            break

# ==================================================
# TEXT TO SPEECH (EDGE TTS - ONLY CHANGE)
# ==================================================

VOICE = "en-IN-PrabhatNeural"

pygame.mixer.init()

def speak(text):

    global is_speaking

    try:

        is_speaking = True

        listener_thread = threading.Thread(
            target=monitor_keyboard,
            daemon=True
        )

        listener_thread.start()

        async def generate_voice():

            output_file = "response.mp3"

            communicate = edge_tts.Communicate(
                text=text,
                voice=VOICE
            )

            await communicate.save(output_file)

            pygame.mixer.music.load(output_file)
            pygame.mixer.music.play()

            while pygame.mixer.music.get_busy():

                if not is_speaking:
                    pygame.mixer.music.stop()
                    break

                await asyncio.sleep(0.1)

            pygame.mixer.music.unload()

            if os.path.exists(output_file):
                os.remove(output_file)

        asyncio.run(generate_voice())

        is_speaking = False

    except Exception as e:

        is_speaking = False
        print("Voice Error:", e)

# ==================================================
# PDF READER
# ==================================================

def read_pdf(pdf_path):

    text = ""

    try:

        with open(pdf_path, "rb") as file:

            reader = PyPDF2.PdfReader(file)

            for i, page in enumerate(reader.pages):

                if i >= 3:
                    break

                extracted = page.extract_text()

                if extracted:
                    text += extracted

        text = text[:4000]

        return text

    except Exception as e:

        return f"PDF Error: {e}"

# ==================================================
# INTERNET SEARCH
# ==================================================

def internet_search(query):

    try:

        url = (
            "https://api.duckduckgo.com/?q="
            + query
            + "&format=json"
        )

        response = requests.get(url)

        data = response.json()

        if data.get("AbstractText"):

            return data["AbstractText"]

        elif data.get("RelatedTopics"):

            topics = data["RelatedTopics"]

            if len(topics) > 0:

                first = topics[0]

                if isinstance(first, dict):

                    if "Text" in first:
                        return first["Text"]

        return "No detailed internet result found."

    except Exception as e:

        return f"Internet Search Error: {e}"

# ==================================================
# START PROGRAM
# ==================================================

print("===================================")
print("      AI Assistant Started")
print("===================================")

print("""
Features:
1. Typing Chat
2. Voice Chat
3. PDF Analysis
4. Internet Search
5. Press ANY KEY to stop voice
""")

print("Type or say 'exit' to stop.\n")

# ==================================================
# MAIN LOOP
# ==================================================

while True:

    print("\nChoose Input Method")
    print("1. Type")
    print("2. Speak")

    choice = input("\nChoose option: ").strip()

    # ==================================================
    # TYPE INPUT
    # ==================================================

    if choice == "1":

        question = input("\nYou: ").strip()

    # ==================================================
    # VOICE INPUT
    # ==================================================

    elif choice == "2":

        try:

            print("\nAvailable Microphones:\n")

            mic_list = sr.Microphone.list_microphone_names()

            for index, name in enumerate(mic_list):

                print(f"{index}: {name}")

            mic_index = int(input("\nEnter microphone index: "))

            with sr.Microphone(device_index=mic_index) as source:

                print("\nAdjusting for background noise...")

                recognizer.adjust_for_ambient_noise(source, duration=2)

                print("Listening... Speak now.")

                audio = recognizer.listen(
                    source,
                    timeout=10,
                    phrase_time_limit=15
                )

                print("Recognizing speech...")

                question = recognizer.recognize_google(
                    audio,
                    language="en-IN"
                )

                print("\nYou:", question)

        except sr.WaitTimeoutError:
            print("No speech detected.")
            continue

        except sr.UnknownValueError:
            print("Could not understand audio.")
            continue

        except sr.RequestError as e:
            print("Speech API Error:", e)
            continue

        except Exception as e:
            print("Voice Error:", e)
            continue

    else:
        print("Invalid option.")
        continue

    # ==================================================
    # EXIT
    # ==================================================

    if question.lower() == "exit":
        pygame.mixer.music.stop()
        print("\nGoodbye!")
        break

    # ==================================================
    # STOP SPEAKING
    # ==================================================

    if question.lower() == "stop":
        pygame.mixer.music.stop()
        print("\nVoice stopped.")
        continue

    # ==================================================
    # PDF ANALYSIS
    # ==================================================

    if "pdf" in question.lower():

        pdf_path = input("\nEnter PDF file path: ").strip().replace('"', "")

        pdf_text = read_pdf(pdf_path)

        question = f"""
Analyze this PDF content and answer properly.

USER REQUEST:
{question}

PDF CONTENT:
{pdf_text}
"""

    # ==================================================
    # INTERNET SEARCH
    # ==================================================

    elif "search" in question.lower():

        search_result = internet_search(question)

        question = f"""
Use this internet information to answer properly.

SEARCH RESULT:
{search_result}

USER QUESTION:
{question}
"""

    # ==================================================
    # STORE USER MESSAGE
    # ==================================================

    messages.append(
        {
            "role": "user",
            "content": question
        }
    )

    # ==================================================
    # LIMIT MEMORY
    # ==================================================

    messages = [messages[0]] + messages[-MAX_MEMORY:]

    # ==================================================
    # AI RESPONSE
    # ==================================================

    try:

        response = client.chat.completions.create(
            model="qwen/qwen3.8-27b",
            messages=messages
        )

        reply = response.choices[0].message.content

    except Exception as e:

        print("AI Error:", e)
        continue

    # ==================================================
    # OUTPUT
    # ==================================================

    print("\n===================================")
    print("AI:\n")
    print(reply)
    print("===================================\n")

    speak(reply)

    # ==================================================
    # STORE AI RESPONSE
    # ==================================================

    messages.append(
        {
            "role": "assistant",
            "content": reply
        }
    )