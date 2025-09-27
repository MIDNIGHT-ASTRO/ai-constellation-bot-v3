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

// ------------------ 유틸 ------------------ //
function safeLoadJSON(relPath) {
  const abs = path.join(__dirname, relPath);
  try {
    const text = fs.readFileSync(abs, "utf-8");
    const json = JSON.parse(text);
    return { ok: true, data: json, path: abs };
  } catch (e) {
    return { ok: false, error: e.message, path: abs };
  }
}
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ------------------ 데이터 로드 & 정규화 ------------------ //
const RAW = safeLoadJSON("constellations_88_ko_named.json");

// 1) 최상위가 배열이든 {"constellations":[…]}든 모두 흡수
let list = Array.isArray(RAW.data) ? RAW.data : (RAW.data?.constellations || []);
if (!Array.isArray(list)) list = [];

// 2) 값 매핑
const seasonMap = {
  spring: "봄",
  summer: "여름",
  autumn: "가을",
  fall: "가을",
  winter: "겨울",
  "year-round": "연중"
};
const hemiMap = { N: "북반구", S: "남반구", E: "북반구" };

// 3) 서버 기대 스키마로 변환
const constellations = list.map((c) => {
  // 별 이름 배열(한글) 추출: notable_stars[{name_ko}] → ["미라", ...]
  const stars =
    Array.isArray(c?.notable_stars)
      ? c.notable_stars.map((s) => s?.name_ko).filter(Boolean)
      : Array.isArray(c?.stars)
      ? c.stars
      : [];

  // 계절/반구 보정
  const season =
    c?.season ||
    seasonMap[(c?.best_season_northern || "").toLowerCase()] ||
    "연중";
  const hemisphere =
    hemiMap[c?.hemisphere] || c?.hemisphere || "북반구";

  return {
    name_en: c?.name_en || c?.english || c?.name || "",
    name_ko: c?.name_ko || c?.korean || "",
    hemisphere,
    season,
    stars
  };
})
// 필수값 누락 제거
.filter(c => c.name_ko && c.name_en);

// ✅ 한국천문연구원 기준 “게자리=겨울” 강제 보정 (원하신 사항)
for (const c of constellations) {
  if (c.name_ko === "게자리" || c.name_en?.toLowerCase() === "cancer") {
    c.season = "겨울";
  }
}

console.log(`[boot] constellations normalized: ${constellations.length}개 로드 (from ${RAW.path}) ${RAW.ok ? "" : "❌ "+RAW.error}`);

// ------------------ 보조 데이터 (태양/달) ------------------ //
const SOL = safeLoadJSON("solar_system.json");
const solarSystem = Array.isArray(SOL.data) ? SOL.data : [];
console.log(`[boot] solarSystem loaded: ${solarSystem.length}개 (from ${SOL.path}) ${SOL.ok ? "" : "❌ "+SOL.error}`);

// ------------------ 퀴즈 생성기 ------------------ //
function makeSeasonQuiz() {
  const pool = constellations.filter(c => c.hemisphere === "북반구" && c.season && c.name_ko);
  if (!pool.length) return null;
  const c = pick(pool);
  const seasons = ["봄", "여름", "가을", "겨울"];
  return {
    question: `Q) ${c.name_ko}는 북반구 기준 어떤 계절의 별자리일까요?`,
    choices: seasons,
    answerIndex: seasons.indexOf(c.season),
    explanation: `${c.name_ko}는 ${c.season}철에 잘 보이는 별자리입니다.`
  };
}

function makeStarQuiz() {
  const pool = constellations.filter(c => Array.isArray(c.stars) && c.stars.length && c.name_ko);
  if (!pool.length) return null;
  const c = pick(pool);
  const star = pick(c.stars);
  const wrongs = constellations
    .filter(x => x.name_ko !== c.name_ko)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3)
    .map(x => x.name_ko);
  const choices = [c.name_ko, ...wrongs].sort(() => Math.random() - 0.5);
  return {
    question: `Q) ‘${star}’ 별은 어느 별자리에 속해 있을까요?`,
    choices,
    answerIndex: choices.indexOf(c.name_ko),
    explanation: `${star}는 ${c.name_ko}에 속한 별입니다.`
  };
}

function makeHemisphereQuiz() {
  const pool = constellations.filter(c => c.name_ko && c.hemisphere);
  if (!pool.length) return null;
  const c = pick(pool);
  const choices = ["북반구", "남반구"];
  return {
    question: `Q) ${c.name_ko}는 주로 어느 반구에서 잘 보일까요?`,
    choices,
    answerIndex: choices.indexOf(c.hemisphere),
    explanation: `${c.name_ko}는 ${c.hemisphere} 별자리입니다.`
  };
}

function makeSolarQuiz() {
  const pool = solarSystem.filter(q => q?.category === "solar" && Array.isArray(q?.choices));
  if (!pool.length) return null;
  return pick(pool);
}

function makeLunarQuiz() {
  const pool = solarSystem.filter(q => q?.category === "moon" && Array.isArray(q?.choices));
  if (!pool.length) return null;
  return pick(pool);
}

function makeImageQuiz() {
  const pool = constellations.filter(c => c.name_ko && c.name_en);
  if (!pool.length) return null;
  const c = pick(pool);
  const imagePath = `/public/images/constellations_iau/${c.name_en.toLowerCase()}.svg`;
  const wrongs = pool
    .filter(x => x.name_ko !== c.name_ko)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3)
    .map(x => x.name_ko);
  const choices = [c.name_ko, ...wrongs].sort(() => Math.random() - 0.5);
  return {
    question: "Q) 다음 성도 이미지는 어떤 별자리일까요?",
    choices,
    answerIndex: choices.indexOf(c.name_ko),
    explanation: `이 성도는 ${c.name_ko}(${c.name_en}) 자리입니다.`,
    image: imagePath
  };
}

// ------------------ 정적/페이지 ------------------ //
app.use("/public", express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/health", (req, res) => res.json({ ok: true }));

// 디버그: 정규화 결과 확인
app.get("/debug", (req, res) => {
  res.json({
    constellations_count: constellations.length,
    sample_constellation: constellations[0] || null,
    solar_count: solarSystem.length,
    sample_solar: solarSystem[0] || null
  });
});

// ------------------ API ------------------ //
app.post("/chat", (req, res) => {
  try {
    const mode = req.body?.mode || "random";
    const pickers = {
      season: makeSeasonQuiz,
      star: makeStarQuiz,
      hemisphere: makeHemisphereQuiz,
      solar: makeSolarQuiz,
      lunar: makeLunarQuiz,
      image: makeImageQuiz
    };

    let quiz = pickers[mode] ? pickers[mode]() : null;

    // 랜덤/실패 시 대체
    if (!quiz) {
      const order = [makeSeasonQuiz, makeStarQuiz, makeHemisphereQuiz, makeSolarQuiz, makeLunarQuiz, makeImageQuiz];
      for (const fn of order) {
        quiz = fn();
        if (quiz) break;
      }
    }

    if (!quiz || !Array.isArray(quiz.choices) || typeof quiz.answerIndex !== "number") {
      console.error("[/chat] INVALID_QUIZ_PAYLOAD", { mode, quizNull: !quiz });
      return res.status(500).json({ error: "INVALID_QUIZ_PAYLOAD" });
    }

    return res.json({ type: "quiz", data: quiz });
  } catch (e) {
    console.error("[/chat] error:", e);
    return res.status(500).json({ error: "QUIZ_SERVER_ERROR", message: String(e) });
  }
});

// ------------------ 서버 시작 ------------------ //
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Quiz server running on port ${PORT}`);
  console.log(`➡️  Health: GET /health  |  Debug: GET /debug  |  Quiz: POST /chat`);
});
