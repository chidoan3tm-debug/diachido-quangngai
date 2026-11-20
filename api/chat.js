let cachedModel = null;

async function getActiveGroqModel(apiKey) {
  if (cachedModel) return cachedModel;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: "Bearer " + apiKey }
    });
    const json = await res.json();
    if (!json.data || json.data.length === 0) return "llama-3.3-70b-versatile";

    const chatModels = json.data
      .map(m => m.id)
      .filter(id => {
        const low = id.toLowerCase();
        return !low.includes("whisper") && !low.includes("tts") &&
               !low.includes("guard") && !low.includes("embed") &&
               !low.includes("safeguard");
      });

    // Ưu tiên chọn model lớn nói tiếng Việt cực chuẩn trước
    const priorities = ["qwen", "llama-4", "70b", "120b", "kimi", "gemma2", "versatile", "llama"];
    let chosen = chatModels[0] || "llama-3.1-8b-instant";

    for (const kw of priorities) {
      const found = chatModels.find(id => id.toLowerCase().includes(kw) && !id.toLowerCase().includes("8b"));
      if (found) {
        chosen = found;
        break;
      }
    }

    cachedModel = chosen;
    return chosen;
  } catch (e) {
    return "llama-3.1-8b-instant";
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, text: "Method Not Allowed" });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ ok: false, text: "Chưa cấu hình GROQ_API_KEY trên Vercel" });
  }

  const { question, history, context } = req.body || {};
  if (!question) {
    return res.status(200).json({ ok: false, text: "Thiếu câu hỏi" });
  }

  const systemText =
    "Bạn là Trợ lý ảo Du lịch & Về nguồn của Tuổi trẻ Công an tỉnh Quảng Ngãi.\n" +
    "Dữ liệu chính thức trên bản đồ số:\n" + (context || "") + "\n" +
    "Nguyên tắc bắt buộc:\n" +
    "1. Sử dụng tiếng Việt chuẩn xác, tự nhiên, lịch sự, không sai chính tả.\n" +
    "2. CHỈ giới thiệu các địa danh có thật tại Quảng Ngãi (ưu tiên đúng tên trong dữ liệu bản đồ). Tuyệt đối KHÔNG tự bịa tên địa danh hay đọc tọa độ số ra cho người dùng.\n" +
    "3. Trả lời đúng trọng tâm câu hỏi, ngắn gọn dưới 180 chữ. Chỉ chia buổi (Sáng - Chiều) khi người dùng hỏi lịch trình.";

  const messages = [{ role: "system", content: systemText }];
  if (Array.isArray(history)) {
    for (const h of history.slice(-4)) {
      messages.push({
        role: h.role === "model" ? "assistant" : "user",
        content: h.text
      });
    }
  }
  messages.push({ role: "user", content: question });

  try {
    const model = await getActiveGroqModel(apiKey);
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 450,
        temperature: 0.3
      })
    });

    if (groqRes.status === 429) {
      return res.status(200).json({ ok: false, text: "đang có nhiều người hỏi cùng lúc, bạn chờ 10 giây rồi gửi lại" });
    }

    const json = await groqRes.json();
    if (json.choices && json.choices[0] && json.choices[0].message) {
      // Lọc bỏ thẻ <think>...</think> nếu model thuộc dòng suy luận (như Qwen)
      let replyText = json.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      return res.status(200).json({ ok: true, text: replyText });
    }
    return res.status(200).json({ ok: false, text: json.error ? json.error.message : "máy chủ AI phản hồi chậm" });
  } catch (e) {
    return res.status(200).json({ ok: false, text: "lỗi kết nối mạng tạm thời" });
  }
};
