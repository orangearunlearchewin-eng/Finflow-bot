const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const app = express();
app.use(express.json());

const LINE_API = "https://api.line.me/v2/bot/message/reply";
const CLAUDE_API = "https://api.anthropic.com/v1/messages";
const LINE_CONTENT = "https://api-data.line.me/v2/bot/message";

const LINE_TOKEN = process.env.LINE_TOKEN;
const CLAUDE_KEY = process.env.CLAUDE_KEY;
const SHEET_URL = process.env.SHEET_URL;

app.get("/", (req, res) => res.send("FinFlow Bot ✅"));

app.get("/dashboard", (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, "public", "dashboard.html"), "utf-8");
  res.send(html.replace("__SHEET_URL__", SHEET_URL || ""));
});

app.post("/", async (req, res) => {
  res.sendStatus(200);
  const events = req.body.events || [];
  for (const event of events) {
    if (event.type !== "message") continue;
    const replyToken = event.replyToken;
    const msg = event.message;
    if (msg.type === "image") {
      await handleSlip(msg.id, replyToken);
    } else if (msg.type === "text") {
      const text = msg.text.trim();
      const deleteMatch = text.match(/^ลบ\s+(\S+)$/);
      const editMatch = text.match(/^แก้ไข\s+(\S+)\s+(จำนวน|หมวด|หมายเหตุ|วันที่|ประเภท)\s+(.+)$/);
      if (text === "สรุป") {
        await handleSummary(replyToken);
      } else if (text === "รายการล่าสุด" || text === "ลิสต์" || text === "ดูรายการ") {
        await handleList(replyToken);
      } else if (deleteMatch) {
        await handleDelete(replyToken, deleteMatch[1]);
      } else if (editMatch) {
        await handleEdit(replyToken, editMatch[1], editMatch[2], editMatch[3].trim());
      } else {
        await replyLine(replyToken,
          "📷 ส่งรูปสลิปมาเลยครับ\n\n" +
          "พิมพ์ 'สรุป' ดูยอดเดือนนี้\n" +
          "พิมพ์ 'รายการล่าสุด' ดูรายการที่บันทึกไว้พร้อมรหัส\n" +
          "พิมพ์ 'แก้ไข <รหัส> <จำนวน/หมวด/หมายเหตุ/วันที่/ประเภท> <ค่าใหม่>' เพื่อแก้ไข\n" +
          "พิมพ์ 'ลบ <รหัส>' เพื่อลบรายการ"
        );
      }
    }
  }
});

async function handleSlip(messageId, replyToken) {
  try {
    console.log("TOKEN:", LINE_TOKEN ? LINE_TOKEN.substring(0,20)+"..." : "MISSING");
    const imgResp = await axios.get(
      `${LINE_CONTENT}/${messageId}/content`,
      { headers: { Authorization: `Bearer ${LINE_TOKEN}` }, responseType: "arraybuffer" }
    );
    const b64 = Buffer.from(imgResp.data).toString("base64");
    const mime = imgResp.headers["content-type"] || "image/jpeg";

    const claudeResp = await axios.post(CLAUDE_API, {
      model: "claude-haiku-4-5",
      max_tokens: 256,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mime, data: b64 } },
          { type: "text", text: `อ่านสลิปการเงินนี้แล้วตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่น:
{"date":"YYYY-MM-DD","amount":0,"note":"ชื่อแอป/บริการ/ร้านที่จ่ายเงิน","type":"expense","category":"อาหาร"}

กฎการระบุ note และ category:
1. ถ้าสลิปเป็นของ TrueMoney Wallet (มีโลโก้หรือชื่อ TrueMoney) → note = "TrueMoney Wallet", category = "บิล/ค่าใช้จ่าย" เสมอ ไม่ว่าปลายทางจะเป็นธนาคารใดก็ตาม
2. ถ้าจ่ายค่าบิล/ค่าบริการ (ไฟ, น้ำ, โทรศัพท์, อินเทอร์เน็ต) → category = "บิล/ค่าใช้จ่าย"
3. กรณีอื่น → ดูชื่อร้านหรือบริการที่จ่ายเงินไปจริงๆ แล้วเลือก category ให้เหมาะสม

type: expense=จ่ายเงิน, income=รับเงิน
category เลือกจาก: อาหาร, บิล/ค่าใช้จ่าย, ใช้จ่ายทั่วไป, ดูแลหมา, ให้แม่, อื่นๆ
ถ้าอ่านไม่ได้: {"error":"อ่านไม่ได้"}` }
        ]
      }]
    }, {
      headers: { "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }
    });

    const rawText = claudeResp.data.content?.[0]?.text || "";
    const cleaned = rawText.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    if (parsed.error) {
      await replyLine(replyToken, `⚠️ ${parsed.error}`);
      return;
    }

    const id = Date.now().toString(36);
    await axios.post(SHEET_URL, { action: "add", id, ...parsed });

    const typeLabel = parsed.type === "income" ? "💚 รายรับ" : "❤️ รายจ่าย";
    await replyLine(replyToken,
      `✅ บันทึกแล้ว!\n\n${typeLabel}\n📅 ${parsed.date}\n💰 ${Number(parsed.amount).toLocaleString("th-TH")} บาท\n🏷️ ${parsed.category}\n📝 ${parsed.note || "-"}`
    );
  } catch (err) {
     console.log("ERROR STATUS:", err.response?.status);
     console.log("ERROR DATA:", JSON.stringify(err.response?.data));
    await replyLine(replyToken, `❌ เกิดข้อผิดพลาด: ${err.message}`);
  }
}

async function handleSummary(replyToken) {
  try {
    const resp = await axios.get(SHEET_URL);
    const rows = Array.isArray(resp.data) ? resp.data : [];
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
    const monthRows = rows.filter(r => String(r.date).startsWith(thisMonth));
    const income = monthRows.filter(r => r.type === "income").reduce((s,r) => s+Number(r.amount), 0);
    const expense = monthRows.filter(r => r.type === "expense").reduce((s,r) => s+Number(r.amount), 0);
    const cats = {};
    monthRows.filter(r => r.type === "expense").forEach(r => {
      cats[r.category] = (cats[r.category]||0) + Number(r.amount);
    });
    const catLines = Object.entries(cats).sort((a,b) => b[1]-a[1])
      .map(([k,v]) => `  • ${k}: ${v.toLocaleString("th-TH")} บาท`).join("\n");
    await replyLine(replyToken,
      `📊 สรุปเดือนนี้\n\n💚 รายรับ: ${income.toLocaleString("th-TH")} บาท\n❤️ รายจ่าย: ${expense.toLocaleString("th-TH")} บาท\n💙 คงเหลือ: ${(income-expense).toLocaleString("th-TH")} บาท\n\n📂 แยกหมวด:\n${catLines||"  ยังไม่มีรายการ"}\n\n📋 ${monthRows.length} รายการ`
    );
  } catch (err) {
    await replyLine(replyToken, `❌ ดึงข้อมูลไม่ได้: ${err.message}`);
  }
}

async function handleList(replyToken) {
  try {
    const resp = await axios.get(SHEET_URL);
    const rows = Array.isArray(resp.data) ? resp.data : [];
    const recent = rows.slice(-5).reverse();
    if (!recent.length) {
      await replyLine(replyToken, "ยังไม่มีรายการที่บันทึกไว้ครับ");
      return;
    }
    const lines = recent.map(r => {
      const typeLabel = r.type === "income" ? "💚" : "❤️";
      return `🆔 ${r.id}\n${typeLabel} ${Number(r.amount).toLocaleString("th-TH")} บาท | 🏷️ ${r.category}\n📅 ${r.date}  📝 ${r.note || "-"}`;
    }).join("\n\n");
    await replyLine(replyToken,
      `📋 รายการล่าสุด\n\n${lines}\n\n` +
      `✏️ แก้ไข: พิมพ์ "แก้ไข <รหัส> <จำนวน/หมวด/หมายเหตุ/วันที่/ประเภท> <ค่าใหม่>"\n` +
      `🗑️ ลบ: พิมพ์ "ลบ <รหัส>"`
    );
  } catch (err) {
    await replyLine(replyToken, `❌ ดึงข้อมูลไม่ได้: ${err.message}`);
  }
}

async function handleDelete(replyToken, id) {
  try {
    const resp = await axios.post(SHEET_URL, { action: "delete", id });
    if (resp.data?.status === "error") {
      await replyLine(replyToken, `⚠️ ${resp.data.message || "ลบไม่สำเร็จ"}`);
      return;
    }
    await replyLine(replyToken, `🗑️ ลบรายการรหัส ${id} แล้วครับ`);
  } catch (err) {
    await replyLine(replyToken, `❌ ลบไม่สำเร็จ: ${err.message}`);
  }
}

const EDIT_FIELD_MAP = {
  "จำนวน": "amount",
  "หมวด": "category",
  "หมายเหตุ": "note",
  "วันที่": "date",
  "ประเภท": "type"
};

async function handleEdit(replyToken, id, fieldLabel, value) {
  try {
    const field = EDIT_FIELD_MAP[fieldLabel];
    const payload = { action: "edit", id, [field]: field === "amount" ? Number(value) : value };
    const resp = await axios.post(SHEET_URL, payload);
    if (resp.data?.status === "error") {
      await replyLine(replyToken, `⚠️ ${resp.data.message || "แก้ไขไม่สำเร็จ"}`);
      return;
    }
    await replyLine(replyToken, `✏️ แก้ไขรายการรหัส ${id} แล้วครับ\n${fieldLabel}: ${value}`);
  } catch (err) {
    await replyLine(replyToken, `❌ แก้ไขไม่สำเร็จ: ${err.message}`);
  }
}

async function replyLine(replyToken, text) {
  await axios.post(LINE_API,
    { replyToken, messages: [{ type: "text", text }] },
    { headers: { Authorization: `Bearer ${LINE_TOKEN}`, "Content-Type": "application/json" } }
  );
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FinFlow Bot running on port ${PORT}`));
