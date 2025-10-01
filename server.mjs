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

// ------------------ 데이터 로드 & 정규화(별자리) ------------------ //
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
  const stars =
    Array.isArray(c?.notable_stars)
      ? c.notable_stars.map((s) => s?.name_ko).filter(Boolean)
      : Array.isArray(c?.stars)
      ? c.stars
      : [];

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
}).filter(c => c.name_ko && c.name_en);

// ✅ 한국천문연구원 기준 “게자리=겨울” 보정
for (const c of constellations) {
  if (c.name_ko === "게자리" || c.name_en?.toLowerCase() === "cancer") {
    c.season = "겨울";
  }
}

console.log(`[boot] constellations normalized: ${constellations.length}개 (from ${RAW.path}) ${RAW.ok ? "" : "❌ "+RAW.error}`);

// ------------------ 태양/달 데이터 ------------------ //
const SOL = safeLoadJSON("solar_system.json");
const solarSystemRaw = Array.isArray(SOL.data) ? SOL.data : [];
console.log(`[boot] solarSystem loaded: ${solarSystemRaw.length}개 (from ${SOL.path}) ${SOL.ok ? "" : "❌ "+SOL.error}`);

// 카테고리 별칭 지원
const SOLAR_ALIASES = new Set(["solar","sun","planet","planets","eclipse","sol"]);
const LUNAR_ALIASES = new Set(["moon","lunar","phases","lunAR","moonphase"]);

function filterByAliases(items, aliases) {
  return items.filter(q => {
    const c = String(q?.category || "").toLowerCase().trim();
    return aliases.has(c);
  });
}

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

// 🔧 별칭을 허용하는 태양/달 퀴즈
function makeSolarQuiz() {
  const pool = filterByAliases(solarSystemRaw, SOLAR_ALIASES)
    .filter(q => Array.isArray(q?.choices) && typeof q?.answerIndex === "number");
  return pool.length ? pick(pool) : null;
}

function makeLunarQuiz() {
  const pool = filterByAliases(solarSystemRaw, LUNAR_ALIASES)
    .filter(q => Array.isArray(q?.choices) && typeof q?.answerIndex === "number");
  return pool.length ? pick(pool) : null;
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

// 디버그: 카테고리 집계
app.get("/debug", (req, res) => {
  const counts = {};
  for (const q of solarSystemRaw) {
    const k = String(q?.category || "unknown").toLowerCase();
    counts[k] = (counts[k] || 0) + 1;
  }
  res.json({
    constellations_count: constellations.length,
    solar_raw_count: solarSystemRaw.length,
    solar_category_counts: counts,
    solar_aliases_solar: [...SOLAR_ALIASES],
    solar_aliases_lunar: [...LUNAR_ALIASES],
    sample_constellation: constellations[0] || null,
    sample_solar: solarSystemRaw[0] || null
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

    // 요청 모드가 solar/lunar인데 풀이 비면, 대체하지 말고 명확히 에러 반환(원인 파악 쉬움)
    if ((mode === "solar" || mode === "lunar") && !quiz) {
      return res.status(500).json({
        error: "NO_QUIZ_FOR_CATEGORY",
        message: `요청 모드(${mode})에 해당하는 문제가 없습니다. /debug에서 solar_category_counts와 aliases를 확인하세요.`
      });
    }

    // random 또는 다른 모드 실패 시에는 대체 시도
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
