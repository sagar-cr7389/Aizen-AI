document.addEventListener('DOMContentLoaded', () => {
    // ==========================================
    // DOM References
    // ==========================================
    const chatThread = document.getElementById('chat-thread');
    const chatInput = document.getElementById('chat-input');
    const btnSend = document.getElementById('btn-send');
    const btnNewChat = document.getElementById('btn-new-chat');
    const welcomeScreen = document.getElementById('welcome-screen');
    const chatScroll = document.getElementById('chat-scroll');
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebarClose = document.getElementById('sidebar-close');
    const toggleVoice = document.getElementById('toggle-voice');
    const voiceIcon = document.getElementById('voice-icon');
    const chatHistoryList = document.getElementById('chat-history-list');

    // Attachment
    const btnAttach = document.getElementById('btn-attach');
    const fileInput = document.getElementById('file-input');
    const attachmentPreview = document.getElementById('attachment-preview');
    const attachmentName = document.getElementById('attachment-name');
    const attachmentIcon = document.getElementById('attachment-icon');
    const attachmentRemove = document.getElementById('attachment-remove');

    // Camera
    const cameraViewport = document.getElementById('camera-viewport');
    const video = document.getElementById('video-feed');
    const canvas = document.getElementById('vision-canvas');
    const btnCapture = document.getElementById('btn-capture');
    const btnCamera = document.getElementById('btn-camera');
    const btnCloseCamera = document.getElementById('btn-close-camera');

    // Voice
    const btnVoice = document.getElementById('btn-voice');
    const voiceOverlay = document.getElementById('voice-overlay');
    const voiceStatus = document.getElementById('voice-status');
    const btnStopRec = document.getElementById('btn-stop-rec');

    // ==========================================
    // State
    // ==========================================
    let isAutoVoice = false;
    let isRecording = false;
    let mediaRecorder;
    let speechRecognition;
    let audioChunks = [];
    let cameraStream = null;
    let cocoModel = null;
    let activeDetections = [];
    let pendingFile = null; // { type: 'image' | 'pdf', data: ... }
    let userLocation = null;
    let currentChatId = Date.now().toString();

    // ==========================================
    // Geolocation
    // ==========================================
    if (navigator.geolocation) {
        navigator.geolocation.watchPosition(
            pos => { userLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude }; },
            err => { console.warn("Location error:", err); },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
    }

    // ==========================================
    // Chat History & Persistence
    // ==========================================
    async function loadChatHistory() {
        try {
            const res = await fetch('/chats');
            if (!res.ok) return;
            const chats = await res.json();
            chatHistoryList.innerHTML = '';
            
            if (!chats || chats.length === 0) {
                chatHistoryList.innerHTML = '<div class="no-history">No conversations yet</div>';
                return;
            }
            
            chats.forEach(chat => {
                const el = document.createElement('div');
                const isActive = chat.id === currentChatId;
                el.className = `history-item ${isActive ? 'active' : ''}`;
                el.dataset.chatId = chat.id;
                el.innerHTML = `
                    <div class="history-item-left">
                        <i data-lucide="message-square"></i>
                        <span title="${chat.title}">${chat.title}</span>
                    </div>
                    <button class="history-delete-btn" title="Delete chat">
                        <i data-lucide="trash-2"></i>
                    </button>
                `;
                
                // Select chat
                el.querySelector('.history-item-left').addEventListener('click', (e) => {
                    e.stopPropagation();
                    loadChat(chat.id);
                });
                el.addEventListener('click', () => loadChat(chat.id));
                
                // Delete chat
                const delBtn = el.querySelector('.history-delete-btn');
                delBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    try {
                        await fetch(`/chat/${chat.id}`, { method: 'DELETE' });
                        if (currentChatId === chat.id) {
                            btnNewChat.click();
                        }
                        loadChatHistory();
                    } catch (err) {
                        console.error("Failed to delete chat", err);
                    }
                });
                
                chatHistoryList.appendChild(el);
            });
            lucide.createIcons();
        } catch (e) { console.error("Failed to load chat history", e); }
    }

    function cleanDisplayMessage(role, content) {
        if (role === 'user' && typeof content === 'string') {
            if (content.includes("USER QUESTION:")) {
                return content.split("USER QUESTION:").pop().trim();
            }
            if (content.startsWith("SYSTEM:")) {
                return content.replace(/^SYSTEM:[^\n]*\n+/i, '').trim();
            }
        }
        return content;
    }

    async function loadChat(chatId) {
        try {
            const res = await fetch(`/chat/${chatId}`);
            if (!res.ok) return;
            const chat = await res.json();
            currentChatId = chatId;
            chatThread.innerHTML = '';
            if (welcomeScreen) welcomeScreen.classList.add('hidden');
            
            // Re-highlight active history item
            document.querySelectorAll('.history-item').forEach(item => {
                item.classList.toggle('active', item.dataset.chatId === chatId);
            });
            
            if (chat.messages && chat.messages.length > 0) {
                chat.messages.forEach(msg => {
                    if (msg.role !== 'system') {
                        appendMessage(msg.role, cleanDisplayMessage(msg.role, msg.content));
                    }
                });
            }
            
            if (window.innerWidth <= 768) {
                sidebar.classList.add('collapsed');
            }
        } catch (e) { console.error("Failed to load chat", e); }
    }

    loadChatHistory();

    const stopSpeakingVisuals = () => {
        toggleVoice.classList.remove('speaking');
        document.querySelectorAll('.msg-avatar.speaking-avatar').forEach(el => el.classList.remove('speaking-avatar'));
    };

    // ==========================================
    // Message Rendering
    // ==========================================
    function appendMessage(role, content) {
        if (welcomeScreen) welcomeScreen.classList.add('hidden');

        const row = document.createElement('div');
        row.className = `message-row ${role}`;

        const avatarLabel = role === 'user' ? 'S' : 'A';
        const senderName = role === 'user' ? 'You' : 'Aizen';

        row.innerHTML = `
            <div class="message-inner">
                <div class="msg-avatar">${avatarLabel}</div>
                <div class="msg-content">
                    <div class="msg-sender">${senderName}</div>
                    <div class="msg-body"></div>
                </div>
            </div>
        `;

        const msgBody = row.querySelector('.msg-body');
        const formattedContent = cleanDisplayMessage(role, content);
        msgBody.innerHTML = marked.parse(formattedContent);

        // Add copy buttons to code blocks
        row.querySelectorAll('pre').forEach(pre => {
            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-code-btn';
            copyBtn.innerHTML = '<i data-lucide="copy"></i>';
            pre.appendChild(copyBtn);
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const code = pre.querySelector('code')?.innerText || pre.innerText;
                navigator.clipboard.writeText(code);
                copyBtn.innerHTML = '<i data-lucide="check"></i>';
                setTimeout(() => {
                    copyBtn.innerHTML = '<i data-lucide="copy"></i>';
                    lucide.createIcons();
                }, 2000);
                lucide.createIcons();
            });
        });

        chatThread.appendChild(row);
        lucide.createIcons();
        chatScroll.scrollTop = chatScroll.scrollHeight;

        // Highlight code blocks
        row.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
    }

    function showThinking() {
        if (welcomeScreen) welcomeScreen.classList.add('hidden');

        const row = document.createElement('div');
        row.className = 'message-row assistant thinking';
        row.id = 'thinking-row';
        row.innerHTML = `
            <div class="message-inner">
                <div class="msg-avatar">A</div>
                <div class="msg-content">
                    <div class="msg-sender">Aizen</div>
                    <div class="msg-body">
                        <div class="thinking-dot"></div>
                        <div class="thinking-dot"></div>
                        <div class="thinking-dot"></div>
                    </div>
                </div>
            </div>
        `;
        chatThread.appendChild(row);
        lucide.createIcons();
        chatScroll.scrollTop = chatScroll.scrollHeight;
        return row;
    }

    // ==========================================
    // Core Chat Logic
    // ==========================================
    async function sendMessage(text, imageData = null) {
        if (!text && !imageData && !pendingFile) return;

        // Handle pending file
        if (pendingFile && pendingFile.type === 'pdf') {
            // Upload PDF first
            const formData = new FormData();
            formData.append('file', pendingFile.file);
            clearAttachment();
            if (text) appendMessage('user', text);
            const thinkingRow = showThinking();

            try {
                const uploadRes = await fetch('/upload-pdf', { method: 'POST', body: formData });
                const uploadData = await uploadRes.json();
                if (!uploadRes.ok) throw new Error(uploadData.error || 'The PDF could not be uploaded.');

                // Now send the chat with the question
                const payload = {
                    message: text || "Analyze this document in detail.",
                    location: userLocation,
                    chat_id: currentChatId
                };
                const res = await fetch('/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'The request could not be completed.');
                thinkingRow.remove();
                if (data.response) {
                    appendMessage('assistant', data.response);
                    if (isAutoVoice) playTTS(data.response);
                }
                loadChatHistory();
            } catch (err) {
                thinkingRow.remove();
                appendMessage('assistant', err.message || "I encountered an error processing your document. Please try again.");
            }
            return;
        }

        if (pendingFile && pendingFile.type === 'image') {
            imageData = pendingFile.data;
            clearAttachment();
        }

        if (text) appendMessage('user', text);
        chatInput.value = '';
        chatInput.style.height = 'auto';

        const thinkingRow = showThinking();

        const payload = {
            message: text || "Analyze this image in detail.",
            image: imageData,
            location: userLocation,
            chat_id: currentChatId
        };

        try {
            const res = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'The request could not be completed.');
            thinkingRow.remove();

            if (data.response) {
                appendMessage('assistant', data.response);
                if (isAutoVoice) playTTS(data.response);
            }
            loadChatHistory();
        } catch (err) {
            thinkingRow.remove();
            appendMessage('assistant', err.message || "I apologize, I encountered a connection issue. Please try again.");
        }
    }

    // ==========================================
    // Use the browser's built-in voice so playback does not depend on Edge TTS.
    // ==========================================
    function playTTS(text) {
        if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
            console.error('Speech synthesis is not supported by this browser.');
            return;
        }

        window.speechSynthesis.cancel();
        const plainText = text
            .replace(/```[\s\S]*?```/g, 'Code block.')
            .replace(/[`*_#>]/g, '')
            .trim();
        const utterance = new SpeechSynthesisUtterance(plainText);
        utterance.lang = 'en-US';
        const voices = window.speechSynthesis.getVoices();
        utterance.voice = voices.find(voice => voice.lang === 'en-US') || null;
        utterance.onstart = () => {
            toggleVoice.classList.add('speaking');
            const avatars = document.querySelectorAll('.message-row.assistant .msg-avatar');
            if (avatars.length > 0) avatars[avatars.length - 1].classList.add('speaking-avatar');
        };
        utterance.onend = stopSpeakingVisuals;
        utterance.onerror = stopSpeakingVisuals;
        window.speechSynthesis.speak(utterance);
    }

    // ==========================================
    // File Attachment (Images & PDFs)
    // ==========================================
    btnAttach.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.type === 'application/pdf') {
            pendingFile = { type: 'pdf', file: file };
            showAttachmentPreview(file.name, 'file-text');
        } else if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                pendingFile = { type: 'image', data: ev.target.result };
                showAttachmentPreview(file.name, 'image');
            };
            reader.readAsDataURL(file);
        }
        fileInput.value = '';
    });

    function showAttachmentPreview(name, iconName) {
        attachmentName.textContent = name;
        attachmentIcon.setAttribute('data-lucide', iconName);
        attachmentPreview.classList.remove('hidden');
        // Move preview inside input area
        const inputArea = document.querySelector('.input-container');
        inputArea.insertBefore(attachmentPreview, inputArea.firstChild);
        lucide.createIcons();
    }

    function clearAttachment() {
        pendingFile = null;
        attachmentPreview.classList.add('hidden');
    }

    attachmentRemove.addEventListener('click', clearAttachment);

    // ==========================================
    // Camera & Object Detection
    // ==========================================
    async function startCamera() {
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
            });
            video.srcObject = cameraStream;
            cameraViewport.classList.remove('hidden');
            video.onloadedmetadata = () => {
                video.play();
                requestAnimationFrame(detectFrame);
            };
        } catch (err) {
            alert("Unable to access camera. Please check permissions.");
        }
    }

    function stopCamera() {
        if (cameraStream) {
            cameraStream.getTracks().forEach(t => t.stop());
            cameraStream = null;
        }
        activeDetections = [];
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        cameraViewport.classList.add('hidden');
    }

    async function detectFrame() {
        if (cameraViewport.classList.contains('hidden') || !cameraStream) {
            return;
        }

        if (!cocoModel) {
            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 480;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#10a37f';
            ctx.font = 'bold 14px Inter, sans-serif';
            ctx.fillText("Loading object detector...", 16, 32);
        } else if (video.readyState === 4) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            try {
                const predictions = await cocoModel.detect(video);
                activeDetections = predictions;
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                predictions.forEach(p => {
                    const [x, y, w, h] = p.bbox;
                    ctx.strokeStyle = '#10a37f';
                    ctx.lineWidth = 2;
                    ctx.strokeRect(x, y, w, h);

                    const label = `${p.class} ${Math.round(p.score * 100)}%`;
                    ctx.font = 'bold 12px Inter, sans-serif';
                    const tw = ctx.measureText(label).width;
                    ctx.fillStyle = 'rgba(16, 163, 127, 0.85)';
                    ctx.fillRect(x, y - 22, tw + 12, 22);
                    ctx.fillStyle = '#fff';
                    ctx.fillText(label, x + 6, y - 6);
                });
            } catch (e) { /* ignore frame errors */ }
        }
        requestAnimationFrame(detectFrame);
    }

    btnCamera.addEventListener('click', () => {
        if (cameraViewport.classList.contains('hidden')) startCamera();
        else stopCamera();
    });

    btnCloseCamera.addEventListener('click', stopCamera);

    btnCapture.addEventListener('click', () => {
        const captureCanvas = document.createElement('canvas');
        captureCanvas.width = video.videoWidth || 640;
        captureCanvas.height = video.videoHeight || 480;
        captureCanvas.getContext('2d').drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
        const imageData = captureCanvas.toDataURL('image/jpeg', 0.85);

        let prompt = "Analyze this live camera image in detail. Describe everything you see — objects, people, environment, text, colors, and anything notable.";
        if (activeDetections.length > 0) {
            const items = activeDetections.map(p => `${p.class} (${Math.round(p.score * 100)}%)`).join(', ');
            prompt += ` Local detector identified: ${items}. Use this context to provide a richer analysis.`;
        }

        stopCamera();
        sendMessage(prompt, imageData);
    });

    // ==========================================
    // Voice Recording
    // ==========================================
    btnVoice.addEventListener('click', startRecording);
    btnStopRec.addEventListener('click', stopRecording);

    async function startRecording() {
        try {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (SpeechRecognition) {
                speechRecognition = new SpeechRecognition();
                speechRecognition.lang = 'en-US';
                speechRecognition.interimResults = false;
                speechRecognition.continuous = false;
                let receivedResult = false;
                voiceOverlay.classList.remove('hidden');
                voiceStatus.innerText = "Listening...";
                speechRecognition.onresult = (event) => {
                    const transcript = event.results[0][0].transcript.trim();
                    receivedResult = true;
                    speechRecognition = null;
                    voiceOverlay.classList.add('hidden');
                    if (transcript) sendMessage(transcript);
                };
                speechRecognition.onerror = (event) => {
                    voiceStatus.innerText = event.error === 'not-allowed'
                        ? "Microphone permission was denied."
                        : "Speech recognition failed. Please try again.";
                    setTimeout(() => voiceOverlay.classList.add('hidden'), 2500);
                };
                speechRecognition.onend = () => {
                    if (!receivedResult && voiceStatus.innerText === "Listening...") {
                        voiceStatus.innerText = "No speech detected. Please try again.";
                        setTimeout(() => voiceOverlay.classList.add('hidden'), 2000);
                    }
                    speechRecognition = null;
                };
                speechRecognition.start();
                return;
            }

            const micStream = await navigator.mediaDevices.getUserMedia({
                audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true }
            });
            const options = { mimeType: 'audio/webm;codecs=opus' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) delete options.mimeType;

            mediaRecorder = new MediaRecorder(micStream, options);
            audioChunks = [];
            mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
            mediaRecorder.onstop = uploadVoice;
            mediaRecorder.start();
            isRecording = true;

            voiceOverlay.classList.remove('hidden');
            voiceStatus.innerText = "Listening...";
        } catch (err) {
            alert("Could not access microphone. Please check your settings.");
        }
    }

    function stopRecording() {
        if (speechRecognition) {
            voiceStatus.innerText = "Processing...";
            try {
                speechRecognition.stop();
            } catch (err) {
                console.error('Could not stop speech recognition:', err);
            }
            return;
        }
        if (mediaRecorder && isRecording) {
            mediaRecorder.stop();
            isRecording = false;
            voiceStatus.innerText = "Processing...";
            mediaRecorder.stream.getTracks().forEach(t => t.stop());
        }
    }

    async function uploadVoice() {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('audio', blob);
        formData.append('chat_id', currentChatId);

        try {
            const res = await fetch('/voice-chat', { method: 'POST', body: formData });
            const data = await res.json();
            voiceOverlay.classList.add('hidden');
            if (!res.ok) throw new Error(data.error || 'Voice transcription failed.');

            if (data.user_text) appendMessage('user', data.user_text);
            if (data.response) {
                appendMessage('assistant', data.response);
                playTTS(data.response);
            }
            loadChatHistory();
        } catch (e) {
            voiceStatus.innerText = e.message || "Error. Try again.";
            appendMessage('assistant', voiceStatus.innerText);
            setTimeout(() => voiceOverlay.classList.add('hidden'), 2000);
        }
    }

    // ==========================================
    // UI Controls
    // ==========================================

    // Send
    btnSend.addEventListener('click', () => sendMessage(chatInput.value.trim()));
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(chatInput.value.trim());
        }
    });

    // Auto-resize textarea
    chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
    });

    // New Chat
    btnNewChat.addEventListener('click', async () => {
        await fetch('/clear', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: currentChatId })
        });
        currentChatId = Date.now().toString();
        chatThread.innerHTML = '';
        if (welcomeScreen) welcomeScreen.classList.remove('hidden');
        clearAttachment();
        document.querySelectorAll('.history-item').forEach(item => item.classList.remove('active'));
        if (window.innerWidth <= 768) {
            sidebar.classList.add('collapsed');
        }
    });

    // Sidebar toggle
    sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
    sidebarClose.addEventListener('click', () => sidebar.classList.add('collapsed'));

    // Voice toggle
    toggleVoice.addEventListener('click', () => {
        isAutoVoice = !isAutoVoice;
        if (isAutoVoice) {
            voiceIcon.setAttribute('data-lucide', 'volume-2');
            toggleVoice.classList.add('active');
        } else {
            voiceIcon.setAttribute('data-lucide', 'volume-x');
            toggleVoice.classList.remove('active');
        }
        lucide.createIcons();
    });

    // Suggestion cards
    document.querySelectorAll('.suggestion-chip').forEach(btn => {
        btn.addEventListener('click', () => sendMessage(btn.getAttribute('data-query')));
    });

    // Stop voice on keyboard press
    window.addEventListener('keydown', () => {
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        stopSpeakingVisuals();
    });

    // ==========================================
    // Load COCO-SSD Model
    // ==========================================
    if (typeof cocoSsd !== 'undefined') {
        cocoSsd.load().then(model => {
            cocoModel = model;
            console.log("Aizen Vision (COCO-SSD) loaded.");
        }).catch(err => {
            console.error("COCO-SSD load error:", err);
        });
    }

    // ==========================================
    // AIZEN Robot Controller
    // ==========================================
    const robotContainer = document.getElementById('aizen-robot');
    const welcomeSpline = document.getElementById('welcome-spline');
    let isConversationActive = false;

    // --- Position Management ---
    function moveRobotToCorner() {
        if (isConversationActive) return;
        isConversationActive = true;
        
        if (welcomeSpline) welcomeSpline.style.display = 'none';
        if (robotContainer) {
            robotContainer.classList.add('visible');
        }
    }

    function moveRobotToWelcome() {
        isConversationActive = false;
        
        if (welcomeSpline) welcomeSpline.style.display = 'block';
        if (robotContainer) {
            robotContainer.classList.remove('visible');
        }
    }

    // --- Event Hooks ---
    // Override sendMessage to move robot to corner
    const originalSendMessage = sendMessage;
    sendMessage = async function (text, imageData) {
        if (!text && !imageData && !pendingFile) return;
        moveRobotToCorner();
        return originalSendMessage.call(this, text, imageData);
    };

    // Override new chat to return robot to welcome
    const originalNewChatHandler = btnNewChat.onclick;
    btnNewChat.addEventListener('click', () => {
        setTimeout(() => {
            moveRobotToWelcome();
        }, 100);
    });

    // Suggestion cards also trigger conversation
    document.querySelectorAll('.suggestion-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            moveRobotToCorner();
        });
    });

    // --- Load Chat Hook (move robot when loading existing chat) ---
    const originalLoadChat = loadChat;
    loadChat = async function (chatId) {
        moveRobotToCorner();
        return originalLoadChat.call(this, chatId);
    };

    // ==========================================
    // Spline Watermark Remover
    // ==========================================
    function removeSplineWatermark() {
        const viewers = document.querySelectorAll('spline-viewer');
        viewers.forEach(viewer => {
            const cleanShadowRoot = () => {
                if (!viewer.shadowRoot) return;

                // 1. Inject hiding CSS into shadowRoot
                if (!viewer.shadowRoot.querySelector('#hide-spline-logo-style')) {
                    const style = document.createElement('style');
                    style.id = 'hide-spline-logo-style';
                    style.textContent = `
                        #logo, 
                        #watermark, 
                        a[href*="spline.design"], 
                        a[title*="Spline"], 
                        .spline-watermark,
                        [class*="logo"],
                        a {
                            display: none !important;
                            opacity: 0 !important;
                            visibility: hidden !important;
                            pointer-events: none !important;
                            position: absolute !important;
                            left: -9999px !important;
                            bottom: -9999px !important;
                            height: 0 !important;
                            width: 0 !important;
                        }
                    `;
                    viewer.shadowRoot.appendChild(style);
                }

                // 2. Directly remove the logo elements if present
                const targets = viewer.shadowRoot.querySelectorAll('#logo, #watermark, a[href*="spline"], a');
                targets.forEach(target => {
                    target.remove();
                });
            };

            cleanShadowRoot();
            viewer.addEventListener('load', cleanShadowRoot);
            viewer.addEventListener('ready', cleanShadowRoot);

            // Observe dynamic additions in shadowRoot
            if (viewer.shadowRoot && !viewer._watermarkObserver) {
                const observer = new MutationObserver(cleanShadowRoot);
                observer.observe(viewer.shadowRoot, { childList: true, subtree: true });
                viewer._watermarkObserver = observer;
            }
        });
    }

    // Call immediately and repeatedly to catch asynchronous loads
    removeSplineWatermark();
    const watermarkInterval = setInterval(removeSplineWatermark, 100);
    setTimeout(() => clearInterval(watermarkInterval), 6000);

    console.log("AIZEN Spline Robot initialized.");
});