/* ============================================================
   ai-chat.js — แชท AI ลอยมุมขวาล่าง (OpenAI GPT)
   ใช้งาน: วาง <script src="ai-chat.js" defer></script> ก่อน </body>
   จากนั้นเรียก window.initAIChat("YOUR_OPENAI_API_KEY")
============================================================ */

(function () {

    // ===== System Prompt — บุคลิก AI =====
    const SYSTEM_PROMPT = `
คุณคือ "พี่แปก" — พี่แนะแนวการศึกษาต่อที่เข้าใจน้องๆ ที่จบ ปวส. ดี
พูดภาษาไทยเป็นกันเอง ใช้คำว่า "พี่แปก" แทนตัวเอง และ "น้อง" แทนผู้ถาม
ตอบกระชับ ชัดเจน เป็นมิตร ไม่เป็นทางการจนเกินไป ใส่ emoji เล็กน้อยให้น่าอ่าน

คุณจะแสดงความเห็นใจและให้กำลังใจน้องๆ ที่กังวลเรื่องการเรียนต่อ และให้คำแนะนำที่เป็นประโยชน์และตรงประเด็นที่สุดเท่าที่จะทำได้ 
พี่แปกจะเป็นผู้ช่วยที่ดีและให้คำตอบที่ถูกต้องที่สุดเท่าที่จะทำได้
(ย้ำว่าคุณคือ"พี่แปก"ไม่ใช่ "พี่แปรก" หรือ "พี่แปลก" )

ความเชี่ยวชาญหลักของพี่:
- แนะนำมหาวิทยาลัยที่รับ ปวส. เทียบโอน ทั้งรัฐบาล ราชภัฏ ราชมงคล เอกชน
- อธิบายระบบ TCAS, เทียบโอนหน่วยกิต, ทุน กยศ.
- ช่วยเลือกสาขาที่เหมาะกับสายที่จบมา
- ให้กำลังใจน้องที่กังวลเรื่องการเรียนต่อ
- ตอบคำถามทั่วไปเกี่ยวกับชีวิตมหาวิทยาลัย ค่าใช้จ่าย ทุน

ถ้าถามเรื่องที่ไม่รู้จริงๆ ให้บอกตรงๆ ว่าไม่แน่ใจ 
และแนะนำให้ไปเช็คกับมหาวิทยาลัยโดยตรงครับ/ค่ะ

ห้ามตอบเรื่องการเมือง ศาสนา หรือเรื่องที่ไม่เกี่ยวกับการศึกษา
`;

    // ===== ประวัติการสนทนา (เก็บ context ข้ามหน้า จนกว่าจะปิดแท็บ) =====
    // SESSION KEY แยกตาม user email — คนละ user ไม่เห็นแชทของกัน
    let SESSION_KEY    = 'ai_chat_history';
    let SESSION_UI_KEY = 'ai_chat_ui';

    function setSessionKeys(email) {
        // ใช้ email เป็น suffix ของ key เพื่อแยกแชทแต่ละ user
        const safe = (email || 'guest').replace(/[^a-z0-9]/gi, '_');
        SESSION_KEY    = 'ai_chat_history_' + safe;
        SESSION_UI_KEY = 'ai_chat_ui_' + safe;
    }

    function loadHistory() {
        try {
            const saved = sessionStorage.getItem(SESSION_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch { return []; }
    }

    function saveHistory(history) {
        try {
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(history));
        } catch {}
    }

    function saveUI(html) {
        try { sessionStorage.setItem(SESSION_UI_KEY, html); } catch {}
    }

    function loadUI() {
        try { return sessionStorage.getItem(SESSION_UI_KEY) || null; } catch { return null; }
    }

    let chatHistory = [];
    let apiKey = '';
    let isOpen = false;
    let isTyping = false;
    let lastSentTime = 0;
    const COOLDOWN_MS = 6000; // รอ 6 วินาทีระหว่างแต่ละข้อความ

    // ===== สร้าง HTML =====
    function createChatUI() {
        if (document.getElementById('ai-chat-wrapper')) return;

        const wrapper = document.createElement('div');
        wrapper.id = 'ai-chat-wrapper';
        wrapper.innerHTML = `
            <!-- ปุ่มเปิด/ปิด -->
            <button class="ai-chat-toggle" id="aiChatToggle" onclick="toggleAIChat()" title="คุยกับพี่แปก">
                <span class="ai-chat-toggle-icon">💬</span>
                <span class="ai-chat-toggle-label">ถามพี่แปก</span>
                <span class="ai-chat-badge" id="aiChatBadge" style="display:none">1</span>
            </button>

            <!-- กล่องแชท -->
            <div class="ai-chat-box" id="aiChatBox">
                <!-- Header -->
                <div class="ai-chat-header">
                    <div class="ai-chat-header-info">
                        <div class="ai-chat-avatar">🤖</div>
                        <div>
                            <div class="ai-chat-name">พี่แปก</div>
                            <div class="ai-chat-status" id="aiChatStatus">● พร้อมตอบคำถาม</div>
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <button class="ai-chat-clear" onclick="clearAIChat()" title="ล้างประวัติแชท">🗑️</button>
                        <button class="ai-chat-close" onclick="toggleAIChat()">✕</button>
                    </div>
                </div>

                <!-- Messages -->
                <div class="ai-chat-messages" id="aiChatMessages">
                    <div class="ai-msg ai-msg--bot">
                        <div class="ai-msg-avatar">🤖</div>
                        <div class="ai-msg-bubble">
                            สวัสดีน้องๆ! 👋 พี่แปกพร้อมช่วยตอบคำถามเรื่องการเรียนต่อเลยนะ<br><br>
                            น้องอยากรู้เรื่องอะไรดี? เช่น
                            <div class="ai-quick-btns">
                                <button onclick="sendQuickMsg('มหาวิทยาลัยที่รับ ปวส. มีที่ไหนบ้าง')">มหาลัยรับ ปวส.</button>
                                <button onclick="sendQuickMsg('เทียบโอนหน่วยกิตคืออะไร')">เทียบโอนคืออะไร</button>
                                <button onclick="sendQuickMsg('ทุน กยศ. สมัครยังไง')">ทุน กยศ.</button>
                                <button onclick="sendQuickMsg('ค่าเรียนต่อปริญญาตรีแพงไหม')">ค่าเรียนแพงไหม</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Input -->
                <div class="ai-chat-input-area">
                    <input
                        type="text"
                        id="aiChatInput"
                        class="ai-chat-input"
                        placeholder="พิมพ์คำถามได้เลย..."
                        maxlength="300"
                        onkeydown="if(event.key==='Enter' && !event.shiftKey){ event.preventDefault(); sendAIMessage(); }"
                    >
                    <button class="ai-chat-send" id="aiChatSend" onclick="sendAIMessage()">
                        ส่ง ➤
                    </button>
                </div>
                <div class="ai-chat-footer">ขับเคลื่อนโดย google gemini · ข้อมูลอาจมีการเปลี่ยนแปลง</div>
            </div>
        `;

        document.body.appendChild(wrapper);
        injectAIChatStyles();
    }

    // ===== เปิด/ปิดกล่องแชท =====
    window.toggleAIChat = function () {
        isOpen = !isOpen;
        const box    = document.getElementById('aiChatBox');
        const toggle = document.getElementById('aiChatToggle');
        const badge  = document.getElementById('aiChatBadge');

        if (isOpen) {
            box.classList.add('open');
            toggle.classList.add('active');
            badge.style.display = 'none';
            // focus input
            setTimeout(() => {
                const input = document.getElementById('aiChatInput');
                if (input) input.focus();
            }, 300);
        } else {
            box.classList.remove('open');
            toggle.classList.remove('active');
        }
    };

    // ===== ส่งข้อความด่วน (quick buttons) =====
    window.sendQuickMsg = function (text) {
        const input = document.getElementById('aiChatInput');
        if (input) input.value = text;
        sendAIMessage();
    };

    // ===== เพิ่มข้อความในกล่องแชท =====
    function appendMessage(role, text) {
        const container = document.getElementById('aiChatMessages');
        if (!container) return;

        const div = document.createElement('div');
        div.className = `ai-msg ai-msg--${role === 'user' ? 'user' : 'bot'}`;

        if (role === 'assistant') {
            div.innerHTML = `
                <div class="ai-msg-avatar">🤖</div>
                <div class="ai-msg-bubble">${formatAIText(text)}</div>
            `;
        } else {
            div.innerHTML = `<div class="ai-msg-bubble">${escapeHtml(text)}</div>`;
        }

        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
        // บันทึก HTML ปัจจุบันไว้ restore ตอนเปลี่ยนหน้า
        saveUI(container.innerHTML);
        return div;
    }

    // ===== แสดง typing indicator =====
    function showTyping() {
        const container = document.getElementById('aiChatMessages');
        if (!container) return;
        const div = document.createElement('div');
        div.className = 'ai-msg ai-msg--bot';
        div.id = 'aiTypingIndicator';
        div.innerHTML = `
            <div class="ai-msg-avatar">🤖</div>
            <div class="ai-msg-bubble ai-typing">
                <span></span><span></span><span></span>
            </div>
        `;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    function hideTyping() {
        const el = document.getElementById('aiTypingIndicator');
        if (el) el.remove();
    }

    // ===== ส่งข้อความไป OpenAI =====
    window.sendAIMessage = async function () {
        if (isTyping) return;

        // cooldown ป้องกันส่งถี่เกินไป
        const now = Date.now();
        const elapsed = now - lastSentTime;
        if (elapsed < COOLDOWN_MS) {
            const wait = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
            appendMessage('assistant', `⏳ รออีก ${wait} วินาทีก่อนนะน้อง ไม่งั้น quota หมดได้`);
            return;
        }
        lastSentTime = now;

        const input  = document.getElementById('aiChatInput');
        const sendBtn = document.getElementById('aiChatSend');
        const text   = (input?.value || '').trim();
        if (!text) return;
        if (!apiKey) {
            appendMessage('assistant', '⚠️ ยังไม่ได้ตั้งค่า API Key น้องครับ กรุณาติดต่อผู้ดูแลเว็บ');
            return;
        }

        // แสดงข้อความของผู้ใช้
        appendMessage('user', text);
        input.value = '';

        // เพิ่มลง history และบันทึกลง sessionStorage
        chatHistory.push({ role: 'user', content: text });
        saveHistory(chatHistory);

        // UI สถานะ loading
        isTyping = true;
        sendBtn.disabled = true;
        showTyping();

        const statusEl = document.getElementById('aiChatStatus');
        if (statusEl) statusEl.textContent = '● กำลังพิมพ์...';

        try {
            // แปลง chatHistory ให้เป็นรูปแบบ Gemini (role: user/model)
            const geminiHistory = chatHistory.slice(-10).map(m => ({
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: m.content }]
            }));

            const fetchGemini = () => fetch(
                apiKey, // apiKey = Cloudflare Worker URL (ไม่ใช่ Gemini key โดยตรงอีกต่อไป)
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
                        contents: geminiHistory,
                        generationConfig: { maxOutputTokens: 3000, temperature: 0.7 }
                    })
                }
            );

            let response = await fetchGemini();

            // ถ้าโดน 429 แจ้งสั้นๆ ไม่ให้รอนาน
            if (response.status === 429) {
                throw new Error('quota_exceeded');
            }

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error?.message || `HTTP ${response.status}`);
            }

            const data  = await response.json();
            const reply = data.candidates?.[0]?.content?.parts?.[0]?.text
                || 'ขอโทษนะน้อง พี่ตอบไม่ได้ตอนนี้ ลองใหม่อีกครั้งนะ 🙏';

            chatHistory.push({ role: 'assistant', content: reply });
            saveHistory(chatHistory);

            hideTyping();
            appendMessage('assistant', reply);

            // แจ้งเตือนถ้ากล่องปิดอยู่
            if (!isOpen) {
                const badge = document.getElementById('aiChatBadge');
                if (badge) badge.style.display = 'flex';
            }

        } catch (err) {
            console.error('AI Chat error:', err);
            hideTyping();

            let errMsg = '❌ เกิดข้อผิดพลาด ลองใหม่อีกครั้งนะน้อง';
            if (err.message === 'quota_exceeded') errMsg = '😅 ขอโทษนะน้อง พี่แปกตอบได้ไม่ไหวในตอนนี้ ลองถามใหม่อีกครู่นะ';
            else if (err.message.includes('401'))  errMsg = '❌ API Key ไม่ถูกต้อง กรุณาติดต่อผู้ดูแลเว็บ';
            else if (err.message.includes('403'))  errMsg = '❌ API Key ถูกระงับ กรุณาติดต่อผู้ดูแลเว็บ';

            appendMessage('assistant', errMsg);
        } finally {
            isTyping = false;
            sendBtn.disabled = false;
            if (statusEl) statusEl.textContent = '● พร้อมตอบคำถาม';
        }
    };

    // ===== Utility: format ข้อความ AI (แปลง **bold** และ \n) =====
    function formatAIText(text) {
        return escapeHtml(text)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ===== Inject Styles =====
    function injectAIChatStyles() {
        if (document.getElementById('ai-chat-styles')) return;
        const style = document.createElement('style');
        style.id = 'ai-chat-styles';
        style.textContent = `
            /* ===== Wrapper ===== */
            #ai-chat-wrapper {
                position: fixed;
                bottom: 24px;
                right: 24px;
                z-index: 99999;
                font-family: 'Sarabun', sans-serif;
            }

            /* ===== Toggle Button ===== */
            .ai-chat-toggle {
                display: flex; align-items: center; gap: 8px;
                background: #111; color: #fff;
                border: none; border-radius: 30px;
                padding: 12px 20px; cursor: pointer;
                font-family: 'Sarabun', sans-serif; font-size: 14px; font-weight: 600;
                box-shadow: 0 4px 20px rgba(0,0,0,0.25);
                transition: all 0.2s;
                position: relative;
            }
            .ai-chat-toggle:hover      { background: #333; transform: translateY(-2px); box-shadow: 0 6px 24px rgba(0,0,0,0.3); }
            .ai-chat-toggle.active     { background: #444; }
            .ai-chat-toggle-icon       { font-size: 18px; }
            .ai-chat-badge {
                position: absolute; top: -6px; right: -6px;
                background: #ef4444; color: #fff;
                width: 20px; height: 20px; border-radius: 50%;
                font-size: 11px; font-weight: 700;
                align-items: center; justify-content: center;
            }

            /* ===== Chat Box ===== */
            .ai-chat-box {
                position: absolute; bottom: 60px; right: 0;
                width: 360px; max-height: 520px;
                background: #fff; border-radius: 20px;
                box-shadow: 0 8px 40px rgba(0,0,0,0.18);
                display: flex; flex-direction: column;
                overflow: hidden;
                opacity: 0; transform: translateY(12px) scale(0.97);
                pointer-events: none;
                transition: opacity 0.25s ease, transform 0.25s ease;
            }
            .ai-chat-box.open {
                opacity: 1; transform: translateY(0) scale(1);
                pointer-events: all;
            }

            /* ===== Header ===== */
            .ai-chat-header {
                display: flex; align-items: center; justify-content: space-between;
                background: #111; color: #fff;
                padding: 14px 16px; flex-shrink: 0;
            }
            .ai-chat-header-info  { display: flex; align-items: center; gap: 10px; }
            .ai-chat-avatar       { font-size: 26px; }
            .ai-chat-name         { font-size: 15px; font-weight: 700; }
            .ai-chat-status       { font-size: 11px; color: #aaa; margin-top: 1px; }
            .ai-chat-close {
                background: transparent; border: none; color: #aaa;
                font-size: 18px; cursor: pointer; padding: 4px 8px;
                border-radius: 6px; transition: background 0.15s;
            }
            .ai-chat-close:hover  { background: rgba(255,255,255,0.1); color: #fff; }
            .ai-chat-clear {
                background: transparent; border: none; color: #aaa;
                font-size: 16px; cursor: pointer; padding: 4px 8px;
                border-radius: 6px; transition: background 0.15s;
            }
            .ai-chat-clear:hover  { background: rgba(255,255,255,0.1); color: #fff; }

            /* ===== Messages ===== */
            .ai-chat-messages {
                flex: 1; overflow-y: auto; padding: 16px 12px;
                display: flex; flex-direction: column; gap: 12px;
                scrollbar-width: thin; scrollbar-color: #e0e0e0 transparent;
            }
            .ai-chat-messages::-webkit-scrollbar       { width: 4px; }
            .ai-chat-messages::-webkit-scrollbar-thumb { background: #ddd; border-radius: 4px; }

            .ai-msg {
                display: flex; align-items: flex-end; gap: 8px;
            }
            .ai-msg--user {
                flex-direction: row-reverse;
            }
            .ai-msg-avatar { font-size: 20px; flex-shrink: 0; }
            .ai-msg-bubble {
                max-width: 80%; padding: 10px 14px;
                border-radius: 18px; font-size: 13.5px; line-height: 1.6;
            }
            .ai-msg--bot  .ai-msg-bubble {
                background: #f4f4f5; color: #111;
                border-bottom-left-radius: 4px;
            }
            .ai-msg--user .ai-msg-bubble {
                background: #111; color: #fff;
                border-bottom-right-radius: 4px;
            }

            /* ปุ่ม quick reply */
            .ai-quick-btns {
                display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px;
            }
            .ai-quick-btns button {
                background: #fff; border: 1px solid #ddd; border-radius: 20px;
                padding: 5px 12px; font-family: 'Sarabun', sans-serif;
                font-size: 12px; color: #333; cursor: pointer;
                transition: all 0.15s;
            }
            .ai-quick-btns button:hover { background: #111; color: #fff; border-color: #111; }

            /* Typing indicator */
            .ai-typing {
                display: flex; align-items: center; gap: 4px; padding: 10px 14px;
            }
            .ai-typing span {
                width: 8px; height: 8px; border-radius: 50%;
                background: #aaa; display: inline-block;
                animation: aiTypingBounce 1.2s infinite;
            }
            .ai-typing span:nth-child(2) { animation-delay: 0.2s; }
            .ai-typing span:nth-child(3) { animation-delay: 0.4s; }
            @keyframes aiTypingBounce {
                0%, 60%, 100% { transform: translateY(0); }
                30%            { transform: translateY(-6px); }
            }

            /* ===== Input Area ===== */
            .ai-chat-input-area {
                display: flex; gap: 8px; align-items: center;
                padding: 10px 12px;
                border-top: 1px solid #f0f0f0; flex-shrink: 0;
            }
            .ai-chat-input {
                flex: 1; border: 1.5px solid #e8e8e8; border-radius: 12px;
                padding: 9px 14px; font-family: 'Sarabun', sans-serif;
                font-size: 13.5px; outline: none; color: #222;
                transition: border-color 0.2s;
            }
            .ai-chat-input:focus { border-color: #111; }
            .ai-chat-input::placeholder { color: #ccc; }
            .ai-chat-send {
                background: #111; color: #fff; border: none; border-radius: 10px;
                padding: 9px 14px; font-family: 'Sarabun', sans-serif;
                font-size: 13px; font-weight: 600; cursor: pointer;
                transition: background 0.2s; flex-shrink: 0;
                white-space: nowrap;
            }
            .ai-chat-send:hover    { background: #333; }
            .ai-chat-send:disabled { background: #ccc; cursor: not-allowed; }

            /* ===== Footer ===== */
            .ai-chat-footer {
                text-align: center; font-size: 10px; color: #ccc;
                padding: 6px 12px 10px; flex-shrink: 0;
            }

            /* ===== Mobile ===== */
            @media (max-width: 420px) {
                #ai-chat-wrapper { bottom: 16px; right: 12px; }
                .ai-chat-box     { width: calc(100vw - 24px); right: 0; }
                .ai-chat-toggle-label { display: none; }
            }
        `;
        document.head.appendChild(style);
    }

    // ===== initAIChat — เรียกจากหน้าเว็บ =====
    // key = OpenAI API Key
    // รับ email ของ user ปัจจุบัน (ส่งมาจากหน้าเว็บตอนเรียก initAIChat)
    window.initAIChat = function (key, userEmail) {
        if (!key) {
            console.warn('ai-chat.js: ต้องระบุ API Key');
            return;
        }
        apiKey = key;

        // ตั้ง session key ตาม email ก่อน loadHistory เสมอ
        setSessionKeys(userEmail || 'guest');
        chatHistory = loadHistory();

        createChatUI();

        // restore UI แชทเดิมของ user นี้ถ้ามี
        const savedUI = loadUI();
        const container = document.getElementById('aiChatMessages');
        if (savedUI && container && chatHistory.length > 0) {
            container.innerHTML = savedUI;
            container.scrollTop = container.scrollHeight;
        }
    };

    // ล้างประวัติแชท (เรียกจากภายนอกได้ เช่น ปุ่มล้างแชท)
    window.clearAIChat = function () {
        chatHistory = [];
        sessionStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_UI_KEY);
        const container = document.getElementById('aiChatMessages');
        if (container) {
            container.innerHTML = `
                <div class="ai-msg ai-msg--bot">
                    <div class="ai-msg-avatar">🤖</div>
                    <div class="ai-msg-bubble">
                        สวัสดีครับ! 👋 เริ่มต้นการสนทนาใหม่แล้ว น้องอยากถามเรื่องอะไรดีครับ?
                        <div class="ai-quick-btns">
                            <button onclick="sendQuickMsg('มหาวิทยาลัยที่รับ ปวส. มีที่ไหนบ้าง')">มหาลัยรับ ปวส.</button>
                            <button onclick="sendQuickMsg('เทียบโอนหน่วยกิตคืออะไร')">เทียบโอนคืออะไร</button>
                            <button onclick="sendQuickMsg('ทุน กยศ. สมัครยังไง')">ทุน กยศ.</button>
                            <button onclick="sendQuickMsg('ค่าเรียนต่อปริญญาตรีแพงไหม')">ค่าเรียนแพงไหม</button>
                        </div>
                    </div>
                </div>`;
        }
    };

})();
