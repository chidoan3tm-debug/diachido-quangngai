let cachedModel = null;

async function getActiveGroqModel(apiKey) {
  if (cachedModel) return cachedModel;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: "Bearer " + apiKey }
    });
    const json = await res.json();
    if (!json.data || json.data.length === 0) return "llama-3.1-8b-instant";

    const chatModels = json.data
      .map(m => m.id)
      .filter(id => {
        const low = id.toLowerCase();
        return !low.includes("whisper") && !low.includes("tts") &&
               !low.includes("guard") && !low.includes("embed");
      });

    const chosen = chatModels.find(id => id.toLowerCase().includes("llama")) || chatModels[0] || "llama-3.1-8b-instant";
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
    "Bạn là Trợ lý ảo Du lịch & Về nguồn thông minh của Tuổi trẻ Công an tỉnh Quảng Ngãi.\n" +
    "Dữ liệu thực tế trên bản đồ số hiện có:\n" + (context || "") + "\n" +
    "Nguyên tắc trả lời:\n" +
    "1. Trả lời tự nhiên, linh hoạt, đúng trọng tâm câu hỏi của người dùng.\n" +
    "2. CHỈ chia buổi (Sáng - Chiều) khi người dùng hỏi lịch trình, ưu tiên ghép các điểm gần nhau theo tọa độ.\n" +
    "3. Ngắn gọn, thân thiện, dễ đọc trên điện thoại (dưới 180 chữ).";

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
        temperature: 0.7
      })
    });

    if (groqRes.status === 429) {
      return res.status(200).json({ ok: false, text: "đang có nhiều người hỏi cùng lúc, bạn chờ 10 giây rồi gửi lại" });
    }

    const json = await groqRes.json();
    if (json.choices && json.choices[0] && json.choices[0].message) {
      return res.status(200).json({ ok: true, text: json.choices[0].message.content });
    }
    return res.status(200).json({ ok: false, text: json.error ? json.error.message : "máy chủ AI phản hồi chậm" });
  } catch (e) {
    return res.status(200).json({ ok: false, text: "lỗi kết nối mạng tạm thời" });
  }
};
