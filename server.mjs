// server.mjs
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// index.html 캐시 방지
app.get("/", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.sendFile(path.join(__dirname, "index.html"));
});

// 정적 파일 (이미지, CSS 등은 캐시 허용)
app.use("/public", express.static(path.join(__dirname, "public"), {
  maxAge: "7d",
  etag: true
}));

// 건강 체크
app.get("/health", (req, res) => res.json({ ok: true }));

// =========================
// 간단 퀴즈 데이터 (예시용)
// 실제로는 constellations, solarBank 등 로직 확장 가능
// =========================

const sampleQuiz = {
  season: {
    question: "Q) 오리온자리는 북반구 기준 어떤 계절의 별자리일까요?",
    choices: ["봄", "여름", "가을", "겨울"],
    answerIndex: 3,
    explanation: "오리온자리는 겨울철 별자리입니다."
  },
  star: {
    question: "Q) ‘베텔게우스’ 별은 어느 별자리에 속해 있을까요?",
    choices: ["오리온자리", "사자자리", "페르세우스자리", "큰곰자리"],
    answerIndex: 0,
    explanation: "베텔게우스는 오리온자리에 속합니다."
  },
  hemisphere: {
    question: "Q) 남십자자리는 주로 어느 반구에서 잘 보일까요?",
    choices: ["북반구", "남반구"],
    answerIndex: 1,
    explanation: "남십자자리는 남반구 별자리입니다."
  },
  solar: {
    question: "Q) 태양은 무엇인가요?",
    choices: ["항성", "행성", "위성", "왜소행성"],
    answerIndex: 0,
    explanation: "태양은 태양계의 중심 항성입니다."
  },
  image: {
    question: "Q) 다음 성도 이미지는 어떤 별자리일까요?",
    choices: ["안드로메다자리", "카시오페이아자리", "오리온자리", "페르세우스자리"],
    answerIndex: 0,
    explanation: "이 성도는 안드로메다자리입니다.",
    image: "/public/images/constellations_iau/andromeda.svg"
  }
};

function getQuiz(mode) {
  return sampleQuiz[mode] || sampleQuiz.solar;
}

// =========================
// API
// =========================
app.post("/chat", (req, res) => {
  try {
    let mode = req.body?.mode || "random";
    if (mode === "lunar") mode = "solar"; // 달 → 태양계 통합
    let quiz = getQuiz(mode);
    if (!quiz) quiz = getQuiz("solar");
    return res.json({ type: "quiz", data: quiz });
  } catch (e) {
    console.error("[/chat] error:", e);
    return res.status(500).json({ error: "QUIZ_SERVER_ERROR", message: String(e) });
  }
});

// 서버 시작
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Quiz server running on port ${PORT}`);
});
