/**
 * app.js — 前端純 JS 聊天室邏輯（已修改支援 n8n HTML 回傳 + 重試機制 + 檢測未完成回應）
 */

"use strict";

/* =========================
   後端 API 網域
========================= */
const API_BASE = "https://taipei-marathon-server.onrender.com";
const api = (p) => `${API_BASE}${p}`;

/* =========================
   免登入多使用者：clientId
========================= */
const CID_KEY = "fourleaf_client_id";
let clientId = localStorage.getItem(CID_KEY);
if (!clientId) {
  clientId =
    (crypto.randomUUID && crypto.randomUUID()) ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(CID_KEY, clientId);
}

/* =========================
   DOM 參照
========================= */
const elMessages = document.getElementById("messages");
const elInput = document.getElementById("txtInput");
const elBtnSend = document.getElementById("btnSend");
const elThinking = document.getElementById("thinking");

/* =========================
   訊息狀態
========================= */
const messages = [];

/* =========================
   小工具
========================= */
const uid = () => Math.random().toString(36).slice(2);

function scrollToBottom() {
  elMessages?.scrollTo({ top: elMessages.scrollHeight, behavior: "smooth" });
}

/**
 * 切換「思考中」動畫
 */
function setThinking(on) {
  if (!elThinking) return;
  if (on) {
    elThinking.classList.remove("hidden");
    if (elBtnSend) elBtnSend.disabled = true;
    if (elInput) elInput.disabled = true;
  } else {
    elThinking.classList.add("hidden");
    if (elBtnSend) elBtnSend.disabled = false;
    if (elInput) elInput.disabled = false;
    elInput?.focus();
  }
}

/**
 * 智能處理問號 (針對使用者輸入)
 */
function processQuestionMarks(text) {
  let result = text;
  result = result.replace(/[?？]\s*$/g, '');
  result = result.replace(/[?？](?=.)/g, '\n');
  result = result.replace(/\n\s*\n/g, '\n');
  return result.trim();
}

/**
 * HTML 轉義 (防止 XSS)
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 檢查回應是否包含未完成的處理標記
 */
function containsIncompleteMarkers(text) {
  if (typeof text !== 'string') return false;
  const lowerText = text.toLowerCase();
  return lowerText.includes('search results') && lowerText.includes('html');
}

/* =========================
   將 messages 渲染到畫面
========================= */
function render() {
  if (!elMessages) return;
  elMessages.innerHTML = "";
  for (const m of messages) {
    const isUser = m.role === "user";
    // 外層一列
    const row = document.createElement("div");
    row.className = `msg ${isUser ? "user" : "bot"}`;

    // 頭像
    const avatar = document.createElement("img");
    avatar.className = "avatar";
    avatar.src = isUser
      ? 'https://raw.githubusercontent.com/justin-321-hub/taipei_marathon/refs/heads/main/assets/user-avatar.png'
      : 'https://raw.githubusercontent.com/justin-321-hub/taipei_marathon/refs/heads/main/assets/logo.png';
    avatar.alt = isUser ? "you" : "bot";

    // 對話泡泡
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    if (isUser) {
      // ★ 使用者訊息：為了安全，必須轉義 HTML，並將換行轉為 <br>
      bubble.innerHTML = escapeHtml(m.text).replace(/\n/g, '<br>');
    } else {
      // ★★★ 機器人訊息關鍵修改 ★★★
      // 直接渲染後端回傳的 HTML，不進行轉義。
      bubble.innerHTML = m.text;
    }

    // 組合
    row.appendChild(avatar);
    row.appendChild(bubble);
    elMessages.appendChild(row);
  }
  scrollToBottom();
}

/* =========================
   呼叫後端邏輯 (含重試機制)
========================= */
async function sendText(text, retryCount = 0) {
  const content = (text ?? elInput?.value ?? "").trim();
  if (!content) return;

  const contentToSend = processQuestionMarks(content);

  // 只在第一次呼叫時顯示使用者訊息並清空輸入框
  if (retryCount === 0) {
    const userMsg = { id: uid(), role: "user", text: content, ts: Date.now() };
    messages.push(userMsg);
    if (elInput) elInput.value = "";
    render();
  }

  setThinking(true);

  try {
    const res = await fetch(api("/api/chat"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": clientId,
      },
      body: JSON.stringify({
        text: contentToSend,
        clientId,
        language: "繁體中文",
        role: "user"
      }),
    });

    const raw = await res.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { errorRaw: raw };
    }

    // ★★★ 處理狀態碼 200 但回應異常的情況 ★★★
    if (res.status === 200) {
      // 檢查是否為空物件或無效回應
      let isEmptyResponse = false;
      
      if (typeof data === "object" && data !== null) {
        const isPlainEmptyObject =
          !Array.isArray(data) &&
          Object.keys(data).filter(k => k !== 'clientId').length === 0;
        
        const hasTextField = 'text' in data || 'message' in data;
        if (hasTextField) {
          const textValue = data.text !== undefined ? data.text : data.message;
          if (textValue === "" || textValue === null || textValue === undefined) {
            isEmptyResponse = true;
          }
        } else if (isPlainEmptyObject) {
          isEmptyResponse = true;
        }
      }

      // 如果偵測到空回應且尚未重試過
      if (isEmptyResponse && retryCount === 0) {
        setThinking(false);
        const retryMsg = {
          id: uid(),
          role: "assistant",
          text: "網路不穩定，正在為您重新詢問。",
          ts: Date.now(),
        };
        messages.push(retryMsg);
        render();
        
        // 延遲 500ms 後重試
        await new Promise(resolve => setTimeout(resolve, 500));
        return sendText(content, retryCount + 1);
      }
      
      // 如果是第二次失敗
      if (isEmptyResponse && retryCount === 1) {
        throw new Error("抱歉，現在網路不穩定，請稍後再試一次。");
      }
    }

    if (!res.ok) {
      if (res.status === 502 || res.status === 404) {
        throw new Error("網路不穩定，請再試一次!");
      }
      const serverMsg = (data && (data.error || data.body || data.message)) ?? raw ?? "unknown error";
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${serverMsg}`);
    }

    // 整理回覆文字 (HTML)
    let replyText;
    if (typeof data === "string") {
      replyText = data.trim() || "請換個說法，謝謝您";
    } else if (data && typeof data === "object") {
      const hasTextField = 'text' in data || 'message' in data;
      if (hasTextField) {
        const textValue = data.text !== undefined ? data.text : data.message;
        if (textValue === "" || textValue === null || textValue === undefined) {
          replyText = "請換個說法，謝謝您";
        } else {
          replyText = String(textValue).trim() || "請換個說法，謝謝您";
        }
      } else {
        const isPlainEmptyObject =
          !Array.isArray(data) &&
          Object.keys(data).filter(k => k !== 'clientId').length === 0;
        if (isPlainEmptyObject) {
          replyText = "網路不穩定，請再試一次";
        } else {
          replyText = JSON.stringify(data, null, 2);
        }
      }
    } else {
      replyText = "請換個說法，謝謝您";
    }

    // ★★★ 新增：檢查回應中是否包含 "Search Results" 和 "Html" ★★★
    if (containsIncompleteMarkers(replyText) && retryCount === 0) {
      setThinking(false);
      const thinkingMsg = {
        id: uid(),
        role: "assistant",
        text: "還在思考中，請稍等。",
        ts: Date.now(),
      };
      messages.push(thinkingMsg);
      render();
      
      // 延遲 1000ms 後重試
      await new Promise(resolve => setTimeout(resolve, 1000));
      return sendText(content, retryCount + 1);
    }

    // 如果第二次仍然包含未完成標記，還是顯示回應（避免無限等待）
    // 但這裡不額外處理，直接顯示收到的內容

    // 推入機器人訊息
    const botMsg = { id: uid(), role: "assistant", text: replyText, ts: Date.now() };
    messages.push(botMsg);
    setThinking(false);
    render();

  } catch (err) {
    setThinking(false);
    const friendly = (!navigator.onLine && "目前處於離線狀態，請檢查網路連線後再試一次") || `${err?.message || err}`;
    const botErr = {
      id: uid(),
      role: "assistant",
      text: friendly,
      ts: Date.now(),
    };
    messages.push(botErr);
    render();
  }
}

// 事件綁定
elBtnSend?.addEventListener("click", () => sendText());
elInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendText();
  }
});

window.addEventListener("load", () => elInput?.focus());

// 歡迎訊息
messages.push({
  id: uid(),
  role: "assistant",
  text: "歡迎來到臺北馬拉松智慧客服！<br>我是小幫手，隨時為您解答~ 有什麼問題可以為您解答的嗎?",
  ts: Date.now(),
});
render();
