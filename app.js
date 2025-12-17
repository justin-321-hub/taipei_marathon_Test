/**
 * app.js — 前端純 JS 聊天室邏輯（獨立錯誤計數器版本）
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
      bubble.innerHTML = escapeHtml(m.text).replace(/\n/g, '<br>');
    } else {
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
   呼叫後端邏輯 (獨立錯誤計數器)
========================= */
async function sendText(text, retryCounts = {}) {
  const content = (text ?? elInput?.value ?? "").trim();
  if (!content) return;

  const contentToSend = processQuestionMarks(content);

  // 初始化重試計數器
  if (!retryCounts.emptyResponse) retryCounts.emptyResponse = 0;
  if (!retryCounts.incompleteMarkers) retryCounts.incompleteMarkers = 0;
  if (!retryCounts.httpErrors) retryCounts.httpErrors = 0;
  if (!retryCounts.jsonParseError) retryCounts.jsonParseError = 0;

  // 判斷是否為第一次請求
  const isFirstRequest = 
    retryCounts.emptyResponse === 0 && 
    retryCounts.incompleteMarkers === 0 && 
    retryCounts.httpErrors === 0 &&
    retryCounts.jsonParseError === 0;

  // 只在第一次呼叫時顯示使用者訊息並清空輸入框
  if (isFirstRequest) {
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
    let jsonParseSuccess = true;
    
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      jsonParseSuccess = false;
      data = { errorRaw: raw };
    }

    // ★★★ 6. JSON 解析錯誤處理 ★★★
    if (!jsonParseSuccess && retryCounts.jsonParseError === 0) {
      retryCounts.jsonParseError++;
      setThinking(false);
      const retryMsg = {
        id: uid(),
        role: "assistant",
        text: "正在為您重新詢問。",
        ts: Date.now(),
      };
      messages.push(retryMsg);
      render();
      await new Promise(resolve => setTimeout(resolve, 1000));
      return sendText(content, retryCounts);
    }
    
    if (!jsonParseSuccess && retryCounts.jsonParseError >= 1) {
      throw new Error("抱歉，現在網路不穩定，請稍後再試一次。");
    }

    // ★★★ 3. HTTP 500/502/503/504/401/404 錯誤處理 ★★★
    const commonHttpErrors = [500, 502, 503, 504, 401, 404];
    if (commonHttpErrors.includes(res.status)) {
      if (retryCounts.httpErrors === 0) {
        retryCounts.httpErrors++;
        setThinking(false);
        const retryMsg = {
          id: uid(),
          role: "assistant",
          text: "網路不穩定，正在為您重新詢問。",
          ts: Date.now(),
        };
        messages.push(retryMsg);
        render();
        await new Promise(resolve => setTimeout(resolve, 1000));
        return sendText(content, retryCounts);
      } else {
        throw new Error("抱歉，現在網路不穩定，請稍後再試一次。");
      }
    }

    // ★★★ 4. 其他 HTTP 錯誤 ★★★
    if (!res.ok) {
      throw new Error("抱歉，現在網路不穩定，請稍後再試一次。");
    }

    // ★★★ 1. HTTP 200 空回應錯誤處理 ★★★
    if (res.status === 200) {
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

      if (isEmptyResponse && retryCounts.emptyResponse === 0) {
        retryCounts.emptyResponse++;
        setThinking(false);
        const retryMsg = {
          id: uid(),
          role: "assistant",
          text: "網路不穩定，正在為您重新詢問。",
          ts: Date.now(),
        };
        messages.push(retryMsg);
        render();
        await new Promise(resolve => setTimeout(resolve, 1000));
        return sendText(content, retryCounts);
      }
      
      if (isEmptyResponse && retryCounts.emptyResponse >= 1) {
        throw new Error("抱歉，現在網路不穩定，請稍後再試一次。");
      }
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

    // ★★★ 2. 後端未完成處理錯誤 ★★★
    if (containsIncompleteMarkers(replyText) && retryCounts.incompleteMarkers === 0) {
      retryCounts.incompleteMarkers++;
      setThinking(false);
      const thinkingMsg = {
        id: uid(),
        role: "assistant",
        text: "還在思考中，請稍等。",
        ts: Date.now(),
      };
      messages.push(thinkingMsg);
      render();
      await new Promise(resolve => setTimeout(resolve, 1000));
      return sendText(content, retryCounts);
    }

    if (containsIncompleteMarkers(replyText) && retryCounts.incompleteMarkers >= 1) {
      setThinking(false);
      const errorMsg = {
        id: uid(),
        role: "assistant",
        text: "抱歉，現在網路不穩定，請稍後再試一次。",
        ts: Date.now(),
      };
      messages.push(errorMsg);
      render();
      return;
    }

    // 推入機器人訊息
    const botMsg = { id: uid(), role: "assistant", text: replyText, ts: Date.now() };
    messages.push(botMsg);
    setThinking(false);
    render();

  } catch (err) {
    setThinking(false);
    
    // ★★★ 5. 離線狀態檢查 ★★★
    if (!navigator.onLine) {
      const offlineMsg = {
        id: uid(),
        role: "assistant",
        text: "目前處於離線狀態，請檢查網路連線後再試一次",
        ts: Date.now(),
      };
      messages.push(offlineMsg);
      render();
      return;
    }
    
    const friendly = `${err?.message || err}`;
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
