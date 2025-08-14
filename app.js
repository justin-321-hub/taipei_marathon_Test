// ✅ 後端 API 網域
const API_BASE = 'https://standard-chartered-taipei-charity.onrender.com';
const api = (p) => `${API_BASE}${p}`;

/* =========================
   免登入多使用者：clientId
   ========================= */
const CID_KEY = 'fourleaf_client_id';
let clientId = localStorage.getItem(CID_KEY);
if (!clientId) {
  clientId = (crypto.randomUUID && crypto.randomUUID())
    || (Date.now() + '-' + Math.random().toString(36).slice(2));
  localStorage.setItem(CID_KEY, clientId);
}

// ---- DOM 參照 ----
const elMessages = document.getElementById('messages');
const elInput = document.getElementById('txtInput');
const elBtnSend = document.getElementById('btnSend');
const elThinking = document.getElementById('thinking'); // ★ 思考動畫

// ---- 訊息狀態 ----
/** @type {{id:string, role:'user'|'assistant', text:string, ts:number}[]} */
const messages = [];

// ---- 工具 ----
const uid = () => Math.random().toString(36).slice(2);
function scrollToBottom() {
  elMessages.scrollTo({ top: elMessages.scrollHeight, behavior: 'smooth' });
}

// ★ 思考動畫 on/off + 禁用輸入（已移除語音相關控制）
function setThinking(on) {
  if (!elThinking) return;
  if (on) {
    elThinking.classList.remove('hidden');
    elBtnSend.disabled = true;
    elInput.disabled = true;
  } else {
    elThinking.classList.add('hidden');
    elBtnSend.disabled = false;
    elInput.disabled = false;
  }
}

/* =========================
   將訊息渲染到畫面（移除語音播放按鈕）
   ========================= */
function render() {
  elMessages.innerHTML = '';

  for (const m of messages) {
    const isUser = m.role === 'user';
    const row = document.createElement('div');
    row.className = `msg ${isUser ? 'user' : 'bot'}`;

    // 頭像
    const avatar = document.createElement('img');
    avatar.className = 'avatar';
    avatar.src = isUser
      ? 'https://raw.githubusercontent.com/justin-321-hub/fourleaf/refs/heads/main/assets/user-avatar.png'
      : 'https://raw.githubusercontent.com/justin-321-hub/fourleaf/refs/heads/main/assets/bot-avatar.png';
    avatar.alt = isUser ? 'you' : 'bot';

    // 泡泡
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerText = m.text;

    // 組合
    row.appendChild(avatar);
    row.appendChild(bubble);
    elMessages.appendChild(row);
  }

  scrollToBottom();
}

/* =========================
   將文字送到 n8n，並顯示雙方訊息（移除自動語音播放）
   ========================= */
async function sendText(text) {
  const content = (text ?? elInput.value).trim();
  if (!content) return;

  // 先加上使用者訊息
  const userMsg = { id: uid(), role: 'user', text: content, ts: Date.now() };
  messages.push(userMsg);
  elInput.value = '';
  render();

  // 思考中（直到收到回覆才關閉）
  setThinking(true);

  try {
    // 呼叫後端 /api/chat
    const res = await fetch(api('/api/chat'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Id': clientId
      },
      body: JSON.stringify({ text: content, clientId })
    });

    const raw = await res.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { errorRaw: raw }; }

    if (!res.ok) {
      throw new Error(
        `HTTP ${res.status} ${res.statusText} — ${data.error || data.body || data.errorRaw || raw || 'unknown error'}`
      );
    }

    const replyText =
      typeof data === 'string'
        ? data
        : (data && (data.text || data.message)) || JSON.stringify(data);

    const botMsg = { id: uid(), role: 'assistant', text: replyText, ts: Date.now() };
    messages.push(botMsg);

    // 關閉思考中 → 再渲染
    setThinking(false);
    render();
  } catch (err) {
    setThinking(false);
    const botErr = {
      id: uid(),
      role: 'assistant',
      text: `取得回覆時發生錯誤：${err?.message || err}`,
      ts: Date.now()
    };
    messages.push(botErr);
    render();
  }
}

// ---- 事件綁定（移除語音錄製事件）----
elBtnSend.addEventListener('click', () => sendText());
elInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) sendText();
});

// ---- 初始化歡迎訊息（移除語音提示） ----
messages.push({
  id: uid(),
  role: 'assistant',
  text: `歡迎來到渣打馬拉松智慧客服！
無論您是第一次參賽的新手，還是追求突破的資深跑者，這裡都有您需要的資訊與貼心建議。
從報名、訓練、裝備選擇，到比賽當天的實用小貼士與恢復方法，我們都會用最專業的知識，陪伴您一路向前，衝向終點！`,
  ts: Date.now()
});
render();


