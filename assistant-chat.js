document.addEventListener("DOMContentLoaded", () => {
  const widget = document.getElementById("assistantChat");
  if (!widget) return;

  let endpointUrl = null;
  try {
    endpointUrl = new URL("https://happyflap1.app.n8n.cloud/webhook/psinput");
  } catch (error) {
    console.error("Assistant chat: invalid endpoint URL", error);
  }
  const SESSION_KEY = "assistantChatSessionId";

  const trigger = widget.querySelector(".assistant-chat__trigger");
  const panel = widget.querySelector(".assistant-chat__panel");
  const closeButton = widget.querySelector(".assistant-chat__close");
  const fullscreenToggle = widget.querySelector(".assistant-chat__fullscreen-toggle");
  const chatBody = widget.querySelector(".assistant-chat__body");
  const placeholder = widget.querySelector(".assistant-chat__placeholder");
  const form = widget.querySelector(".assistant-chat__form");
  const input = form?.querySelector("input");
  const submitButton = form?.querySelector(".assistant-chat__submit");

  let isSending = false;
  let isFullscreen = false;

  const requestAssistant = async (message, sessionId) => {
    if (!endpointUrl) {
      throw new Error("Assistant endpoint is not configured");
    }

    const payload = JSON.stringify({ chatInput: message, sessionId });

    const tryFetch = async () => {
      const response = await fetch(endpointUrl.toString(), {
        method: "POST",
        mode: "cors",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: payload,
      });

      let assistantReply = "";
      if (response.ok) {
        const contentType = (response.headers.get("content-type") || "").toLowerCase();
        if (contentType.includes("application/json")) {
          const data = await response.json();
          if (data && typeof data === "object") {
            if ("text" in data) {
              assistantReply = String(data.text ?? "").trim();
            } else if ("message" in data) {
              assistantReply = String(data.message ?? "").trim();
            }
          }
        } else {
          assistantReply = (await response.text()).trim();
        }
      } else {
        throw new Error(`Assistant webhook responded with status ${response.status}`);
      }

      return assistantReply;
    };

    try {
      return await tryFetch();
    } catch (error) {
      const messageText = (error && typeof error.message === "string") ? error.message : "";
      const isPatternError = /did not match the expected pattern/i.test(messageText);

      if (!isPatternError) {
        throw error;
      }

      // Fallback to XHR for browsers where fetch rejects due to URL parsing bug
      console.warn("Assistant chat: fetch failed with pattern error, retrying via XHR fallback");

      return await new Promise((resolve, reject) => {
        try {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", endpointUrl.toString(), true);
          xhr.setRequestHeader("Content-Type", "application/json");
          xhr.timeout = 15000;
          xhr.onreadystatechange = () => {
            if (xhr.readyState !== XMLHttpRequest.DONE) return;
            if (xhr.status >= 200 && xhr.status < 300) {
              const contentType = (xhr.getResponseHeader("Content-Type") || "").toLowerCase();
              if (contentType.includes("application/json")) {
                try {
                  const data = JSON.parse(xhr.responseText || "{}");
                  if (data && typeof data === "object") {
                    if ("text" in data) {
                      resolve(String(data.text ?? "").trim());
                    } else if ("message" in data) {
                      resolve(String(data.message ?? "").trim());
                    } else {
                      resolve("");
                    }
                  } else {
                    resolve("");
                  }
                } catch (parseError) {
                  reject(parseError);
                }
              } else {
                resolve((xhr.responseText || "").trim());
              }
            } else {
              reject(new Error(`Assistant webhook responded with status ${xhr.status}`));
            }
          };
          xhr.onerror = () => reject(new Error("Network error while contacting assistant"));
          xhr.ontimeout = () => reject(new Error("Превышено время ожидания ответа ассистента"));
          xhr.send(payload);
        } catch (xhrError) {
          reject(xhrError);
        }
      });
    }
  };

  const ensureSessionId = () => {
    try {
      const stored = localStorage.getItem(SESSION_KEY);
      if (stored) return stored;
      const generated = `ps-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
      localStorage.setItem(SESSION_KEY, generated);
      return generated;
    } catch (error) {
      console.warn("Assistant chat: unable to use storage", error);
      return `ps-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
    }
  };

  const scrollToBottom = () => {
    if (!chatBody) return;
    requestAnimationFrame(() => {
      chatBody.scrollTop = chatBody.scrollHeight;
    });
  };

  const hidePlaceholder = () => {
    if (!placeholder) return;
    placeholder.hidden = true;
  };

  const createAvatarContent = (role) => {
    if (role === "user") return "Вы";
    if (role === "assistant") return "AI";
    return "•";
  };

  const appendMessage = (role, text, extraClasses = []) => {
    if (!chatBody) return null;

    const messageEl = document.createElement("div");
    messageEl.classList.add("assistant-chat__message", `assistant-chat__message--${role}`);
    extraClasses.forEach(cls => messageEl.classList.add(cls));

    const avatarEl = document.createElement("div");
    avatarEl.classList.add("assistant-chat__avatar");
    avatarEl.textContent = createAvatarContent(role);

    const bubbleEl = document.createElement("div");
    bubbleEl.classList.add("assistant-chat__bubble");
    bubbleEl.textContent = text;

    messageEl.appendChild(avatarEl);
    messageEl.appendChild(bubbleEl);
    chatBody.appendChild(messageEl);

    if (role === "user") hidePlaceholder();

    scrollToBottom();
    return messageEl;
  };

  const updateSubmitState = () => {
    if (!submitButton || !input) return;
    const hasText = input.value.trim().length > 0;
    submitButton.disabled = isSending || !hasText;
    submitButton.classList.toggle("is-loading", isSending);
  };

  const setState = (isOpen) => {
    widget.classList.toggle("widget-open", isOpen);
    widget.classList.toggle("widget-closed", !isOpen);

    trigger?.setAttribute("aria-expanded", String(isOpen));
    panel?.setAttribute("aria-hidden", String(!isOpen));

    if (isOpen) {
      requestAnimationFrame(() => {
        input?.focus();
      });
    }
  };

  const setFullscreen = (shouldEnable) => {
    if (shouldEnable) {
      if (!widget.classList.contains("widget-open")) {
        setState(true);
      }
      isFullscreen = true;
      widget.classList.add("assistant-chat--fullscreen");
      fullscreenToggle?.classList.add("is-active");
      fullscreenToggle?.setAttribute("aria-label", "Свернуть чат с полного экрана");
      document.body.classList.add("assistant-chat-scroll-lock");
      requestAnimationFrame(() => {
        input?.focus();
      });
      return;
    }

    if (!isFullscreen && !widget.classList.contains("assistant-chat--fullscreen")) {
      fullscreenToggle?.classList.remove("is-active");
      fullscreenToggle?.setAttribute("aria-label", "Развернуть чат на весь экран");
      document.body.classList.remove("assistant-chat-scroll-lock");
      return;
    }

    isFullscreen = false;
    widget.classList.remove("assistant-chat--fullscreen");
    fullscreenToggle?.classList.remove("is-active");
    fullscreenToggle?.setAttribute("aria-label", "Развернуть чат на весь экран");
    document.body.classList.remove("assistant-chat-scroll-lock");
  };

  const disableChat = (reasonText) => {
    if (!form || !input) return;
    input.disabled = true;
    input.placeholder = reasonText;
    submitButton?.setAttribute("disabled", "disabled");
    submitButton?.classList.remove("is-loading");
  };

  const openChat = () => setState(true);
  const closeChat = () => {
    setFullscreen(false);
    setState(false);
  };

  trigger?.addEventListener("click", () => {
    openChat();
  });

  closeButton?.addEventListener("click", () => {
    closeChat();
  });

  fullscreenToggle?.addEventListener("click", () => {
    const shouldEnable = !widget.classList.contains("assistant-chat--fullscreen");
    setFullscreen(shouldEnable);
  });

  input?.addEventListener("input", () => {
    updateSubmitState();
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!input || !endpointUrl || isSending) return;

    const message = input.value.trim();
    if (!message) return;

    let pendingMessage = null;

    try {
      const sessionId = ensureSessionId();
      isSending = true;
      updateSubmitState();

      appendMessage("user", message);
      input.value = "";

      pendingMessage = appendMessage("assistant", "Ассистент думает…", ["assistant-chat__message--pending"]);
      const assistantReply = await requestAssistant(message, sessionId);

      const bubble = pendingMessage ? pendingMessage.querySelector(".assistant-chat__bubble") : null;
      if (pendingMessage) {
        pendingMessage.classList.remove(
          "assistant-chat__message--pending",
          "assistant-chat__message--error",
          "assistant-chat__message--system"
        );
      }

      if (!assistantReply) {
        if (pendingMessage) {
          pendingMessage.classList.add("assistant-chat__message--system");
        }
        if (bubble) {
          bubble.textContent = "Ответ не получен. Попробуйте задать вопрос иначе.";
        }
      } else if (bubble) {
        bubble.textContent = assistantReply;
      }
    } catch (error) {
      const bubble = pendingMessage ? pendingMessage.querySelector(".assistant-chat__bubble") : null;
      if (pendingMessage) {
        pendingMessage.classList.remove("assistant-chat__message--pending", "assistant-chat__message--system");
        pendingMessage.classList.add("assistant-chat__message--error");
      }
      if (bubble) {
        bubble.textContent = "Ошибка соединения. Проверьте интернет и попробуйте снова.";
      }
      console.error("Assistant chat error:", error);
    } finally {
      isSending = false;
      updateSubmitState();
      scrollToBottom();
      input?.focus();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && widget.classList.contains("widget-open")) {
      if (widget.classList.contains("assistant-chat--fullscreen")) {
        setFullscreen(false);
      } else {
        closeChat();
      }
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (!widget.classList.contains("widget-open")) return;
    if (widget.contains(event.target)) return;
    closeChat();
  });

  // Initialize defaults
  setState(false);
  updateSubmitState();

  if (!endpointUrl) {
    appendMessage("system", "Чат временно недоступен — неверный адрес сервиса.", ["assistant-chat__message--system"]);
    disableChat("Чат временно недоступен");
  }
});
