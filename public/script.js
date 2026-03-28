const chatBox = document.getElementById("chat-box");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");

sendBtn.addEventListener("click", sendMessage);
userInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendMessage();
});

async function sendMessage() {
  const question = userInput.value.trim();
  if (!question) return;

  appendMessage(question, "user");
  userInput.value = "";

  appendMessage("Typing...", "bot");
  const botTyping = chatBox.lastChild;

  try {
    const res = await fetch("http://localhost:5000/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const data = await res.json();

    chatBox.removeChild(botTyping);
    appendMessage(data.reply, "bot");
    // show source/intent metadata if available
    if (data.source) {
      const metaParts = [];
      metaParts.push(data.source === "nlp" ? "NLP" : data.source);
      if (data.intent) metaParts.push(`intent: ${data.intent}`);
      if (typeof data.confidence !== 'undefined') metaParts.push(`conf: ${data.confidence}`);
      appendMeta(metaParts.join(" | "));
    }
  } catch (err) {
    chatBox.removeChild(botTyping);
    appendMessage("⚠️ Server error. Try again later.", "bot");
  }
}

function appendMessage(text, sender) {
  const msg = document.createElement("div");
  msg.classList.add("message", sender);
  msg.textContent = text;
  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function appendMeta(text) {
  const meta = document.createElement("div");
  meta.classList.add("message", "meta");
  meta.textContent = text;
  meta.style.fontSize = "0.8em";
  meta.style.opacity = "0.8";
  meta.style.marginTop = "4px";
  chatBox.appendChild(meta);
  chatBox.scrollTop = chatBox.scrollHeight;
}
