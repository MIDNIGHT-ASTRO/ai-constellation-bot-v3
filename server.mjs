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

// ===== 데이터 로드 =====
const constellations = JSON.parse(
  fs.readFileSync(path.join(__dirname, "constellations_88_ko_named.json"), "utf-8")
);
const solarSystem = JSON.parse(
  fs.readFileSync(path.join(__dirname, "solar_system.json"), "utf-8")
);

// ===== 퀴즈 생성기 =====

// 계절 퀴즈
function makeSeasonQuiz() {
  const pool = constellations.filter(c => c.season && c.hemisphere === "북반구");
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const choices = ["봄","여름","가을","겨울"];
  return {
    question: `Q) ${pick.name_ko}는 북반구 기준 어떤 계절의 별자리일까요?`,
    choices,
    answerIndex: choices.indexOf(pick.season),
    explanation: `${pick.name_ko}는 ${pick.season}철 별자리입니다.`
  };
}

// 밝은 별 소속 퀴즈
function makeStarQuiz() {
  const pool = constellations.filter(c => c.stars?.length > 0);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const star = pick.stars[Math.floor(Math.random() * pick.stars.length)];
  const choices = [pick.name_ko];
  while (choices.length < 4) {
    const other = pool[Math.floor(Math.random() * pool.length)].name_ko;
    if (!choices.includes(other)) choices.push(other);
  }
  const shuffled = choices.sort(() => Math.random()-0.5);
  return {
    question: `Q) ${star}는 어느 별자리에 속해 있을까요?`,
    choices: shuffled,
    answerIndex: shuffled.indexOf(pick.name_ko),
    explanation: `${star}는 ${pick.name_ko}에 속한 별입니다.`
  };
}

// 반구 구분 퀴즈
function makeHemisphereQuiz() {
  const pool = constellations;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const choices = ["북반구","남반구"];
  return {
    question: `Q) ${pick.name_ko}는 주로 어느 반구에서 잘 보일까요?`,
    choices,
    answerIndex: choices.indexOf(pick.hemisphere),
    explanation: `${pick.name_ko}는 ${pick.hemisphere} 별자리입니다.`
  };
}

// 태양계 퀴즈
function makeSolarQuiz() {
  const q = [];

  // 태양 관련
  q.push({
    question: "Q) 태양은 무엇인가요?",
    choices: ["항성","행성","위성","왜소행성"],
    answerIndex: 0,
    explanation: "태양은 태양계의 중심 항성입니다."
  });
  q.push({
    question: "Q) 일식이 일어날 때 배치는 어떻게 될까요?",
    choices: ["태양-달-지구","태양-지구-달","지구-달-태양","달-태양-지구"],
    answerIndex: 0,
    explanation: "일식은 태양-달-지구 순서로 일어납니다."
  });
  q.push({
    question: "Q) 월식이 일어날 때 배치는 어떻게 될까요?",
    choices: ["태양-달-지구","태양-지구-달","지구-달-태양","달-태양-지구"],
    answerIndex: 1,
    explanation: "월식은 태양-지구-달 순서로 일어납니다."
  });

  // 달 관련
  q.push({
    question: "Q) 달은 어느 행성의 위성일까요?",
    choices: ["금성","목성","지구","수성"],
    answerIndex: 2,
    explanation: "달은 지구의 위성입니다."
  });
  q.push({
    question: "Q) 저녁 시간에 볼 수 없는 달의 모습은?",
    choices: ["보름달","상현달","초승달","그믐달"],
    answerIndex: 3,
    explanation: "그믐달은 주로 새벽에 떠서 저녁에는 보이지 않습니다."
  });

  // 행성 구분
  q.push({
    question: "Q) 수성, 금성, 지구, 화성은 어떤 행성으로 분류되나요?",
    choices: ["지구형","가스형","얼음형","왜소행성"],
    answerIndex: 0,
    explanation: "내행성은 지구형 행성입니다."
  });
  q.push({
    question: "Q) 목성, 토성, 천왕성, 해왕성은 어떤 행성으로 분류되나요?",
    choices: ["지구형","가스형/얼음형","왜소행성","항성"],
    answerIndex: 1,
    explanation: "목성과 토성은 가스형, 천왕성과 해왕성은 얼음형입니다."
  });

  return q[Math.floor(Math.random() * q.length)];
}

// 성도 이미지 퀴즈
function makeImageQuiz() {
  const pick = constellations[Math.floor(Math.random() * constellations.length)];
  const choices = [pick.name_ko];
  while (choices.length < 4) {
    const other = constellations[Math.floor(Math.random() * constellations.length)].name_ko;
    if (!choices.includes(other)) choices.push(other);
  }
  const shuffled = choices.sort(() => Math.random() - 0.5);
  return {
    question: "Q) 다음 성도 이미지는 어떤 별자리일까요?",
    choices: shuffled,
    answerIndex: shuffled.indexOf(pick.name_ko),
    explanation: `${pick.name_ko} 성도입니다.`,
    image: `/public/images/constellations_iau/${pick.name_en.toLowerCase()}.svg`
  };
}

// ===== 라우트 =====
app.post("/chat", (req, res) => {
  try {
    let mode = req.body?.mode || "random";
    if (mode === "lunar") mode = "solar"; // 달 버튼 제거 → solar로 통합

    const pickers = {
      season: makeSeasonQuiz,
      star: makeStarQuiz,
      hemisphere: makeHemisphereQuiz,
      solar: makeSolarQuiz,
      image: makeImageQuiz
    };

    let quiz = pickers[mode] ? pickers[mode]() : null;
    if (!quiz) quiz = makeSolarQuiz();

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
