/* ============================================================
   ai-chat.js — พี่แปก AI Chat (Gemini + Firestore history)
   ใช้งาน: <script src="ai-chat.js" defer></script>
   เรียก: window.initAIChat("WORKER_URL", user.email, db, firestoreFns)
============================================================ */

(function () {

    // ===== System Prompt =====
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


    // ===== State =====
    let apiKey       = '';
    let currentUser  = null;
    let db           = null;
    let fns          = null;
    let isOpen       = false;
    let isTyping     = false;
    let lastSentTime = 0;
    const COOLDOWN_MS = 6000;

    // ประวัติการสนทนาปัจจุบัน
    let chatHistory   = [];
    let currentSessId = null; // Firestore session doc ID

    // ===== Firestore helpers =====
    function sessionsCol() {
        const safe = (currentUser?.email || 'guest').replace(/[^a-z0-9]/gi, '_');
        return fns.collection(db, 'chat-sessions', safe, 'sessions');
    }

    async function createNewSession(firstMsg) {
        const title = firstMsg.slice(0, 40) + (firstMsg.length > 40 ? '...' : '');
        const ref = await fns.addDoc(sessionsCol(), {
            title,
            createdAt: fns.serverTimestamp(),
            messages: []
        });
        currentSessId = ref.id;
        loadSessionList();
        return ref.id;
    }

    async function saveSessionMessages() {
        if (!currentSessId || !db) return;
        try {
            await fns.updateDoc(
                fns.doc(db, 'chat-sessions',
                    (currentUser?.email || 'guest').replace(/[^a-z0-9]/gi, '_'),
                    'sessions', currentSessId),
                { messages: chatHistory }
            );
        } catch (e) { console.warn('saveSessionMessages:', e); }
    }

    async function loadSessionList() {
        if (!db || !fns) return;
        const listEl = document.getElementById('aiHistoryList');
        if (!listEl) return;

        try {
            const q = fns.query(sessionsCol(),
                fns.orderBy('createdAt', 'desc'),
                fns.limit(30));
            const snap = await fns.getDocs(q);

            listEl.innerHTML = '';
            if (snap.empty) {
                listEl.innerHTML = '<div class="ai-history-empty">ยังไม่มีประวัติแชท</div>';
                return;
            }

            snap.forEach(doc => {
                const data = doc.data();
                const item = document.createElement('div');
                item.className = 'ai-history-item' + (doc.id === currentSessId ? ' active' : '');
                item.dataset.id = doc.id;
                item.innerHTML = `
                    <span class="ai-history-icon">💬</span>
                    <span class="ai-history-title">${escapeHtml(data.title || 'แชท')}</span>
                    <button class="ai-history-delete" onclick="deleteSession('${doc.id}', event)" title="ลบ">🗑️</button>
                `;
                item.addEventListener('click', () => loadSession(doc.id, data));
                listEl.appendChild(item);
            });
        } catch (e) { console.warn('loadSessionList:', e); }
    }

    async function loadSession(sessId, data) {
        currentSessId = sessId;
        chatHistory   = data.messages || [];

        // อัพเดท active state
        document.querySelectorAll('.ai-history-item').forEach(el => {
            el.classList.toggle('active', el.dataset.id === sessId);
        });

        // render ข้อความ
        const container = document.getElementById('aiChatMessages');
        if (!container) return;
        container.innerHTML = '';
        chatHistory.forEach(m => renderMessage(m.role, m.content));

        // ปิด sidebar บน mobile
        closeSidebar();
    }

    window.deleteSession = async function (sessId, e) {
        e.stopPropagation();
        if (!confirm('ลบประวัติแชทนี้?')) return;
        try {
            await fns.deleteDoc(fns.doc(db,
                'chat-sessions',
                (currentUser?.email || 'guest').replace(/[^a-z0-9]/gi, '_'),
                'sessions', sessId));
            if (sessId === currentSessId) startNewChat();
            loadSessionList();
        } catch (e) { console.warn('deleteSession:', e); }
    };

    // ===== สร้าง HTML =====
    function createChatUI() {
        if (document.getElementById('ai-chat-wrapper')) return;

        const wrapper = document.createElement('div');
        wrapper.id = 'ai-chat-wrapper';
        wrapper.innerHTML = `
            <!-- ปุ่มเปิด/ปิด -->
            <button class="ai-chat-toggle" id="aiChatToggle" onclick="toggleAIChat()" title="ถามพี่แปก">
                <span class="ai-chat-toggle-icon">💬</span>
                <span class="ai-chat-toggle-label">ถามพี่แปก</span>
                <span class="ai-chat-badge" id="aiChatBadge" style="display:none">1</span>
            </button>

            <!-- กล่องแชทเต็มจอ -->
            <div class="ai-chat-box" id="aiChatBox">

                <!-- Header -->
                <div class="ai-chat-header">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <button class="ai-sidebar-toggle" onclick="toggleSidebar()" title="ประวัติแชท">☰</button>
                        <div class="ai-chat-avatar">🤖</div>
                        <div>
                            <div class="ai-chat-name">พี่แปก</div>
                            <div class="ai-chat-status" id="aiChatStatus">● พร้อมตอบคำถาม</div>
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <button class="ai-chat-clear" onclick="startNewChat()" title="แชทใหม่">✏️</button>
                        <button class="ai-chat-close" onclick="toggleAIChat()" title="พับลง">
                            <span style="font-size:12px;margin-right:4px;">พับลง</span>⌄
                        </button>
                    </div>
                </div>

                <!-- Body (sidebar + messages) -->
                <div class="ai-chat-body">

                    <!-- Sidebar ประวัติ -->
                    <div class="ai-sidebar" id="aiSidebar">
                        <div class="ai-sidebar-header">
                            <span>ประวัติแชท</span>
                            <button onclick="startNewChat()" class="ai-new-chat-btn">+ แชทใหม่</button>
                        </div>
                        <div class="ai-history-list" id="aiHistoryList">
                            <div class="ai-history-empty">กำลังโหลด...</div>
                        </div>
                    </div>

                    <!-- Overlay สำหรับปิด sidebar (mobile) -->
                    <div class="ai-sidebar-overlay" id="aiSidebarOverlay" onclick="closeSidebar()"></div>

                    <!-- Messages -->
                    <div class="ai-chat-main">
                        <div class="ai-chat-messages" id="aiChatMessages"></div>

                        <!-- Input -->
                        <div class="ai-chat-input-area">
                            <input
                                type="text"
                                id="aiChatInput"
                                class="ai-chat-input"
                                placeholder="พิมพ์คำถามได้เลย..."
                                maxlength="300"
                                onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendAIMessage();}"
                            >
                            <button class="ai-chat-send" id="aiChatSend" onclick="sendAIMessage()">ส่ง ➤</button>
                        </div>
                        <div class="ai-chat-footer">ขับเคลื่อนโดย Gemini · ข้อมูลอาจมีการเปลี่ยนแปลง</div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(wrapper);
        injectAIChatStyles();
    }

    // ===== Sidebar toggle =====
    window.toggleSidebar = function () {
        const sidebar  = document.getElementById('aiSidebar');
        const overlay  = document.getElementById('aiSidebarOverlay');
        const isActive = sidebar.classList.contains('open');
        sidebar.classList.toggle('open', !isActive);
        overlay.classList.toggle('show', !isActive);
    };
    window.closeSidebar = function () {
        document.getElementById('aiSidebar')?.classList.remove('open');
        document.getElementById('aiSidebarOverlay')?.classList.remove('show');
    };

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
            setTimeout(() => document.getElementById('aiChatInput')?.focus(), 300);
        } else {
            box.classList.remove('open');
            toggle.classList.remove('active');
            closeSidebar();
        }
    };

    // ===== แชทใหม่ =====
    window.startNewChat = function () {
        currentSessId = null;
        chatHistory   = [];
        const container = document.getElementById('aiChatMessages');
        if (container) container.innerHTML = '';
        renderWelcome();
        closeSidebar();
        document.getElementById('aiChatInput')?.focus();
    };

    // ===== render ข้อความต้อนรับ =====
    function renderWelcome() {
        const container = document.getElementById('aiChatMessages');
        if (!container) return;
        const div = document.createElement('div');
        div.className = 'ai-msg ai-msg--bot';
        div.innerHTML = `
            <div class="ai-msg-avatar">🤖</div>
            <div class="ai-msg-bubble">
                สวัสดีน้องๆ! 👋 พี่แปกพร้อมช่วยตอบคำถามเรื่องการเรียนต่อเลยนะ<br><br>
                น้องอยากรู้เรื่องอะไรดี?
                <div class="ai-quick-btns">
                    <button onclick="sendQuickMsg('มหาวิทยาลัยที่รับ ปวส. มีที่ไหนบ้าง')">มหาลัยรับ ปวส.</button>
                    <button onclick="sendQuickMsg('เทียบโอนหน่วยกิตคืออะไร')">เทียบโอนคืออะไร</button>
                    <button onclick="sendQuickMsg('ทุน กยศ. สมัครยังไง')">ทุน กยศ.</button>
                    <button onclick="sendQuickMsg('ค่าเรียนต่อปริญญาตรีแพงไหม')">ค่าเรียนแพงไหม</button>
                </div>
            </div>
        `;
        container.appendChild(div);
    }

    // ===== render ข้อความ =====
    function renderMessage(role, text) {
        const container = document.getElementById('aiChatMessages');
        if (!container) return;
        const div = document.createElement('div');
        div.className = `ai-msg ai-msg--${role === 'user' ? 'user' : 'bot'}`;
        if (role === 'assistant') {
            div.innerHTML = `<div class="ai-msg-avatar">🤖</div><div class="ai-msg-bubble">${formatAIText(text)}</div>`;
        } else {
            div.innerHTML = `<div class="ai-msg-bubble">${escapeHtml(text)}</div>`;
        }
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
        return div;
    }

    // alias เพื่อ backward compat
    function appendMessage(role, text) { return renderMessage(role, text); }

    // ===== Typing indicator =====
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
            </div>`;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }
    function hideTyping() {
        document.getElementById('aiTypingIndicator')?.remove();
    }

    // ===== Quick reply =====
    window.sendQuickMsg = function (text) {
        const input = document.getElementById('aiChatInput');
        if (input) input.value = text;
        sendAIMessage();
    };

    // ===== ส่งข้อความ =====
    window.sendAIMessage = async function () {
        if (isTyping) return;

        const now = Date.now();
        if (now - lastSentTime < COOLDOWN_MS) {
            const wait = Math.ceil((COOLDOWN_MS - (now - lastSentTime)) / 1000);
            appendMessage('assistant', `⏳ รออีก ${wait} วินาทีก่อนนะน้อง`);
            return;
        }

        const input = document.getElementById('aiChatInput');
        const btn   = document.getElementById('aiChatSend');
        const text  = (input?.value || '').trim();
        if (!text) return;
        if (!apiKey) { appendMessage('assistant', '⚠️ ยังไม่ได้ตั้งค่า API ครับ'); return; }

        lastSentTime = now;
        appendMessage('user', text);
        input.value = '';

        // สร้าง session ถ้ายังไม่มี
        const isFirstMsg = chatHistory.length === 0;
        chatHistory.push({ role: 'user', content: text });
        if (isFirstMsg && db && fns) await createNewSession(text);

        isTyping = true;
        btn.disabled = true;
        showTyping();
        const statusEl = document.getElementById('aiChatStatus');
        if (statusEl) statusEl.textContent = '● กำลังพิมพ์...';

        try {
            const geminiHistory = chatHistory.slice(-10).map(m => ({
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: m.content }]
            }));

            const fetchGemini = () => fetch(apiKey, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
                    contents: geminiHistory,
                    generationConfig: { maxOutputTokens: 3000, temperature: 0.7 }
                })
            });

            let response = await fetchGemini();
            if (response.status === 429) throw new Error('quota_exceeded');
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error?.message || `HTTP ${response.status}`);
            }

            const data  = await response.json();
            const reply = data.candidates?.[0]?.content?.parts?.[0]?.text
                || 'ขอโทษนะน้อง พี่แปกตอบไม่ได้ตอนนี้ ลองใหม่อีกครั้งนะ 🙏';

            chatHistory.push({ role: 'assistant', content: reply });
            hideTyping();
            appendMessage('assistant', reply);

            // บันทึกลง Firestore
            if (db && fns) await saveSessionMessages();

            if (!isOpen) {
                const badge = document.getElementById('aiChatBadge');
                if (badge) badge.style.display = 'flex';
            }

        } catch (err) {
            console.error('AI Chat error:', err);
            hideTyping();
            let errMsg = '❌ เกิดข้อผิดพลาด ลองใหม่อีกครั้งนะน้อง';
            if (err.message === 'quota_exceeded') errMsg = '😅 ขอโทษนะน้อง พี่แปกตอบได้ไม่ไหวในตอนนี้ ลองถามใหม่อีกครู่นะ';
            else if (err.message.includes('401')) errMsg = '❌ API Key ไม่ถูกต้อง กรุณาติดต่อผู้ดูแลเว็บ';
            else if (err.message.includes('403')) errMsg = '❌ API Key ถูกระงับ กรุณาติดต่อผู้ดูแลเว็บ';
            appendMessage('assistant', errMsg);
        } finally {
            isTyping = false;
            btn.disabled = false;
            if (statusEl) statusEl.textContent = '● พร้อมตอบคำถาม';
        }
    };

    // ===== ล้างแชท =====
    window.clearAIChat = function () { startNewChat(); };

    // ===== Utility =====
    function formatAIText(text) {
        return escapeHtml(text)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
    }
    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ===== Toast =====
    function showToast(msg, duration = 2500) {
        let toast = document.getElementById('aiChatToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'aiChatToast';
            toast.className = 'ai-chat-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), duration);
    }

    // ===== Styles =====
    function injectAIChatStyles() {
        if (document.getElementById('ai-chat-styles')) return;
        const style = document.createElement('style');
        style.id = 'ai-chat-styles';
        style.textContent = `
            /* ===== Wrapper ===== */
            #ai-chat-wrapper {
                position: fixed; bottom: 24px; right: 24px;
                z-index: 99999; font-family: 'Sarabun', sans-serif;
            }

            /* ===== Toggle Button ===== */
            .ai-chat-toggle {
                display: flex; align-items: center; gap: 8px;
                background: #111; color: #fff;
                border: none; border-radius: 30px;
                padding: 12px 20px; cursor: pointer;
                font-family: 'Sarabun', sans-serif; font-size: 14px; font-weight: 600;
                box-shadow: 0 4px 20px rgba(0,0,0,0.25);
                transition: all 0.2s; position: relative;
            }
            .ai-chat-toggle:hover { background: #333; transform: translateY(-2px); }
            .ai-chat-toggle.active { background: #444; }
            .ai-chat-toggle-icon { font-size: 18px; }
            .ai-chat-badge {
                position: absolute; top: -6px; right: -6px;
                background: #ef4444; color: #fff;
                width: 20px; height: 20px; border-radius: 50%;
                font-size: 11px; font-weight: 700;
                align-items: center; justify-content: center;
            }

            /* ===== Chat Box เต็มจอ ===== */
            .ai-chat-box {
                position: fixed; bottom: 0; right: 0;
                width: 100vw; height: 100vh;
                background: rgba(255,255,255,0.82);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                display: flex; flex-direction: column;
                opacity: 0; transform: translateY(100%);
                pointer-events: none;
                transition: opacity 0.3s ease, transform 0.3s ease;
                z-index: 99998;
            }
            .ai-chat-box.open { opacity: 1; transform: translateY(0); pointer-events: all; }

            /* ===== Header ===== */
            .ai-chat-header {
                display: flex; align-items: center; justify-content: space-between;
                background: #111; color: #fff;
                padding: 14px 20px; flex-shrink: 0;
            }
            .ai-chat-avatar { font-size: 26px; }
            .ai-chat-name   { font-size: 15px; font-weight: 700; }
            .ai-chat-status { font-size: 11px; color: #aaa; margin-top: 1px; }

            .ai-sidebar-toggle, .ai-chat-clear, .ai-chat-close {
                background: transparent; border: none; color: #aaa;
                font-size: 18px; cursor: pointer; padding: 4px 8px;
                border-radius: 6px; transition: background 0.15s;
                font-family: 'Sarabun', sans-serif;
            }
            .ai-sidebar-toggle:hover, .ai-chat-clear:hover, .ai-chat-close:hover {
                background: rgba(255,255,255,0.1); color: #fff;
            }
            .ai-chat-close { font-size: 13px; }

            /* ===== Body layout ===== */
            .ai-chat-body {
                display: flex; flex: 1; overflow: hidden; position: relative;
            }

            /* ===== Sidebar ===== */
            .ai-sidebar {
                width: 260px; flex-shrink: 0;
                background: rgba(245,245,245,0.9);
                border-right: 1px solid #e8e8e8;
                display: flex; flex-direction: column;
                transition: transform 0.3s ease;
            }
            .ai-sidebar-header {
                display: flex; align-items: center; justify-content: space-between;
                padding: 14px 16px; border-bottom: 1px solid #e8e8e8;
                font-family: 'Sarabun', sans-serif; font-size: 14px; font-weight: 600; color: #333;
            }
            .ai-new-chat-btn {
                background: #111; color: #fff; border: none; border-radius: 20px;
                padding: 5px 12px; font-family: 'Sarabun', sans-serif; font-size: 12px;
                cursor: pointer; transition: background 0.2s;
            }
            .ai-new-chat-btn:hover { background: #333; }

            .ai-history-list {
                flex: 1; overflow-y: auto; padding: 8px;
                scrollbar-width: thin; scrollbar-color: #ddd transparent;
            }
            .ai-history-empty {
                text-align: center; color: #bbb;
                font-family: 'Sarabun', sans-serif; font-size: 13px; padding: 20px;
            }
            .ai-history-item {
                display: flex; align-items: center; gap: 8px;
                padding: 10px 12px; border-radius: 10px;
                cursor: pointer; margin-bottom: 4px;
                transition: background 0.15s;
                font-family: 'Sarabun', sans-serif; font-size: 13px; color: #333;
            }
            .ai-history-item:hover  { background: rgba(0,0,0,0.06); }
            .ai-history-item.active { background: rgba(0,0,0,0.1); font-weight: 600; }
            .ai-history-icon  { font-size: 14px; flex-shrink: 0; }
            .ai-history-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .ai-history-delete {
                background: transparent; border: none; cursor: pointer;
                font-size: 13px; opacity: 0; transition: opacity 0.15s; padding: 2px;
            }
            .ai-history-item:hover .ai-history-delete { opacity: 1; }

            /* Mobile sidebar overlay */
            .ai-sidebar-overlay {
                display: none; position: absolute; inset: 0;
                background: rgba(0,0,0,0.3); z-index: 10;
            }
            .ai-sidebar-overlay.show { display: block; }

            /* ===== Main (messages + input) ===== */
            .ai-chat-main {
                flex: 1; display: flex; flex-direction: column; overflow: hidden;
            }
            .ai-chat-messages {
                flex: 1; overflow-y: auto; padding: 20px;
                display: flex; flex-direction: column; gap: 16px;
                scrollbar-width: thin; scrollbar-color: #e0e0e0 transparent;
                max-width: 800px; width: 100%; margin: 0 auto; box-sizing: border-box;
            }
            .ai-chat-messages::-webkit-scrollbar       { width: 4px; }
            .ai-chat-messages::-webkit-scrollbar-thumb { background: #ddd; border-radius: 4px; }

            /* ===== Messages ===== */
            .ai-msg { display: flex; align-items: flex-end; gap: 8px; }
            .ai-msg--user { flex-direction: row-reverse; }
            .ai-msg-avatar { font-size: 20px; flex-shrink: 0; }
            .ai-msg-bubble {
                max-width: 80%; padding: 10px 14px;
                border-radius: 18px; font-size: 13.5px; line-height: 1.6;
                font-family: 'Sarabun', sans-serif;
            }
            .ai-msg--bot  .ai-msg-bubble { background: rgba(244,244,245,0.9); color: #111; border-bottom-left-radius: 4px; }
            .ai-msg--user .ai-msg-bubble { background: #111; color: #fff; border-bottom-right-radius: 4px; }

            .ai-quick-btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
            .ai-quick-btns button {
                background: #fff; border: 1px solid #ddd; border-radius: 20px;
                padding: 5px 12px; font-family: 'Sarabun', sans-serif;
                font-size: 12px; color: #333; cursor: pointer; transition: all 0.15s;
            }
            .ai-quick-btns button:hover { background: #111; color: #fff; border-color: #111; }

            /* Typing */
            .ai-typing { display: flex; align-items: center; gap: 4px; padding: 10px 14px; }
            .ai-typing span {
                width: 8px; height: 8px; border-radius: 50%;
                background: #aaa; display: inline-block;
                animation: aiTypingBounce 1.2s infinite;
            }
            .ai-typing span:nth-child(2) { animation-delay: 0.2s; }
            .ai-typing span:nth-child(3) { animation-delay: 0.4s; }
            @keyframes aiTypingBounce {
                0%,60%,100% { transform: translateY(0); }
                30%          { transform: translateY(-6px); }
            }

            /* ===== Input ===== */
            .ai-chat-input-area {
                display: flex; gap: 10px; align-items: center;
                padding: 14px 20px; border-top: 1px solid rgba(0,0,0,0.08);
                flex-shrink: 0; max-width: 800px; width: 100%; margin: 0 auto; box-sizing: border-box;
            }
            .ai-chat-input {
                flex: 1; border: 1.5px solid #e8e8e8; border-radius: 12px;
                padding: 10px 14px; font-family: 'Sarabun', sans-serif;
                font-size: 14px; outline: none; color: #222; background: rgba(255,255,255,0.8);
                transition: border-color 0.2s;
            }
            .ai-chat-input:focus { border-color: #111; }
            .ai-chat-input::placeholder { color: #ccc; }
            .ai-chat-send {
                background: #111; color: #fff; border: none; border-radius: 10px;
                padding: 10px 16px; font-family: 'Sarabun', sans-serif;
                font-size: 13px; font-weight: 600; cursor: pointer;
                transition: background 0.2s; flex-shrink: 0;
            }
            .ai-chat-send:hover    { background: #333; }
            .ai-chat-send:disabled { background: #ccc; cursor: not-allowed; }

            /* ===== Footer ===== */
            .ai-chat-footer {
                text-align: center; font-size: 11px; color: #bbb;
                padding: 6px 12px 12px; flex-shrink: 0;
            }

            /* ===== Toast ===== */
            .ai-chat-toast {
                position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
                background: #1a1a1a; color: #fff;
                font-family: 'Sarabun', sans-serif; font-size: 14px;
                padding: 10px 24px; border-radius: 30px;
                z-index: 999999; opacity: 0; transition: opacity 0.3s; pointer-events: none;
            }
            .ai-chat-toast.show { opacity: 1; }

            /* ===== Mobile ===== */
            @media (max-width: 640px) {
                .ai-sidebar {
                    position: absolute; top: 0; left: 0; height: 100%;
                    transform: translateX(-100%); z-index: 11;
                }
                .ai-sidebar.open { transform: translateX(0); }
                #ai-chat-wrapper { bottom: 16px; right: 12px; }
                .ai-chat-toggle-label { display: none; }
            }
        `;
        document.head.appendChild(style);
    }

// 1. นำเข้า Firebase (ถ้าใช้แบบ Module) หรือเรียกใช้งานผ่าน CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.x.x/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.x.x/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.x.x/firebase-functions.js";

// 2. ใส่ค่าคอนฟิกที่คุณมี
const firebaseConfig = {
    apiKey: "AIzaSyB_ucVfdd-BpTRbtHWZ9LyiETduVIYKCqE",
    authDomain: "myuniversityguide-c083c.firebaseapp.com",
    projectId: "myuniversityguide-c083c",
    storageBucket: "myuniversityguide-c083c.firebasestorage.app",
    messagingSenderId: "649652214412",
    appId: "1:649652214412:web:06937089fc7bbe111579a9"
};

// 3. เริ่มต้นระบบ Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const fns = getFunctions(app);
    // ===== initAIChat =====
    window.initAIChat = function (key, userEmail, firestoreDb, firestoreFns) {
        if (!key) { console.warn('ai-chat.js: ต้องระบุ API Key/Worker URL'); return; }

        apiKey      = key;
        currentUser = { email: userEmail };
        db          = firestoreDb  || null;
        fns         = firestoreFns || null;

        createChatUI();
        renderWelcome();

        // โหลดประวัติแชท
        if (db && fns) loadSessionList();

        // เปิดแชทอัตโนมัติ
        setTimeout(() => toggleAIChat(), 800);
    };

})();
