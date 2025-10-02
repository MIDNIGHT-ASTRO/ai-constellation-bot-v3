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
    return { ok: true, data: JSON.parse(text), path: abs };
  } catch (e) {
    return { ok: false, error: e.message, path: abs, data: null };
  }
}
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => arr.slice().sort(() => Math.random() - 0.5);

// ------------------ 별자리 데이터 로드 & 정규화 ------------------ //
const RAW = safeLoadJSON("constellations_88_ko_named.json");
let list = Array.isArray(RAW.data) ? RAW.data : (RAW.data?.constellations || []);
if (!Array.isArray(list)) list = [];

const seasonMap = {
  spring: "봄",
  summer: "여름",
  autumn: "가을",
  fall: "가을",
  winter: "겨울",
  "year-round": "연중"
};
const hemiMap = { N: "북반구", S: "남반구", E: "북반구" };

const constellations = list
  .map((c) => {
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
    const hemisphere = hemiMap[c?.hemisphere] || c?.hemisphere || "북반구";

    return {
      name_en: c?.name_en || c?.english || c?.name || "",
      name_ko: c?.name_ko || c?.korean || "",
      hemisphere,
      season,
      stars
    };
  })
  .filter((c) => c.name_ko && c.name_en);

// 한국천문연구원 기준: 게자리 = 겨울 보정
for (const c of constellations) {
  if (c.name_ko === "게자리" || c.name_en?.toLowerCase() === "cancer") {
    c.season = "겨울";
  }
}

console.log(`[boot] constellations normalized: ${constellations.length}개 (from ${RAW.path}) ${RAW.ok ? "" : "❌ " + RAW.error}`);

// ------------------ 태양계 원천데이터 → 문항 생성 ------------------ //
const SOL = safeLoadJSON("solar_system.json");
const sol = SOL.data || {};
console.log(`[boot] solar_system source: ${SOL.ok ? "OK" : "FAIL"} (from ${SOL.path}) ${SOL.ok ? "" : "❌ " + SOL.error}`);

// 문항 저장소
let solarBank = []; // 태양/식/행성
let lunarBank = []; // 위성(달 포함)

// 행성/위성/식 등 파싱
const planets = Array.isArray(sol.planets) ? sol.planets : [];
const moons = Array.isArray(sol.moons) ? sol.moons : [];
const eclipses = Array.isArray(sol.eclipses) ? sol.eclipses : [];
const sunInfo = sol.sun || null;

// 중복 방지용 유틸
function unique(arr) {
  return Array.from(new Set(arr));
}

// (A) 태양 정체
if (sunInfo) {
  solarBank.push({
    category: "solar",
    question: "Q) 태양은 무엇인가요?",
    choices: ["항성", "행성", "위성", "왜소행성"],
    answerIndex: 0,
    explanation: "태양은 태양계의 중심 항성입니다."
  });
}

// (B) 일식/월식 배치
if (eclipses.length) {
  const allBodies = ["태양", "지구", "달"];
  for (const e of eclipses) {
    if (!Array.isArray(e.order) || e.order.length !== 3) continue;
    const correctOrder = e.order.join(" → ");
    // 오답: 섞거나 잘못된 순서 3개 만들기
    const wrongs = new Set();
    // 1) 뒤집기
    wrongs.add([...e.order].reverse().join(" → "));
    // 2) 무작위 셔플
    for (let i = 0; i < 6 && wrongs.size < 3; i++) {
      wrongs.add(shuffle(e.order).join(" → "));
    }
    // 3) 혹시 셔플이 전부 같아지면, 임의 조합 추가
    if (wrongs.size < 3) {
      wrongs.add(["지구", "달", "태양"].join(" → "));
      wrongs.add(["달", "태양", "지구"].join(" → "));
    }

    const choices = shuffle([correctOrder, ...Array.from(wrongs).slice(0, 3)]);
    solarBank.push({
      category: "solar",
      question: `Q) ${e.type}이(가) 일어날 때, 올바른 천체 배치는 무엇일까요?`,
      choices,
      answerIndex: choices.indexOf(correctOrder),
      explanation: e.desc || ""
    });
  }
}

// (C) 행성 공전 순서(태양에서 몇 번째)
if (planets.length) {
  // 모든 순서 문제 만들면 너무 많으니 8개 전체를 생성(수성~해왕성)
  const byOrder = planets
    .filter((p) => typeof p.orbit_order === "number")
    .sort((a, b) => a.orbit_order - b.orbit_order);

  const planetNames = byOrder.map((p) => p.name_ko);

  byOrder.forEach((p) => {
    // 정답: 해당 순서의 행성
    const correct = p.name_ko;
    // 오답: 다른 순서의 행성에서 3개
    const wrongs = shuffle(planetNames.filter((n) => n !== correct)).slice(0, 3);
    const choices = shuffle([correct, ...wrongs]);

    solarBank.push({
      category: "solar",
      question: `Q) 태양에서 ${p.orbit_order}번째 행성은 무엇일까요?`,
      choices,
      answerIndex: choices.indexOf(correct),
      explanation: `태양에서 ${p.orbit_order}번째 행성은 ${correct}입니다.`
    });
  });
}

// (D) 행성 유형(지구형/가스형/얼음형)
if (planets.length) {
  const types = unique(planets.map((p) => p.type)).filter(Boolean); // ["지구형","가스형","얼음형"]
  for (const p of planets) {
    const correct = p.type;
    const wrongs = shuffle(types.filter((t) => t !== correct)).slice(0, 3);
    const pool = unique([correct, ...wrongs]); // 혹시 타입 가짓수가 3 미만일 때
    const choices = shuffle(pool.length >= 4 ? pool.slice(0, 4) : pool);

    solarBank.push({
      category: "solar",
      question: `Q) ${p.name_ko}은(는) 어떤 유형의 행성일까요?`,
      choices,
      answerIndex: choices.indexOf(correct),
      explanation: `${p.name_ko}은(는) ${correct} 행성입니다.`
    });
  }
}

// (E) 위성 소속 맞추기 (달 포함)
if (moons.length) {
  for (const m of moons) {
    const correct = m.planet;
    // 후보 행성 이름 풀
    const planetNamePool = unique([
      ...planets.map((p) => p.name_ko),
      ...moons.map((mm) => mm.planet)
    ]).filter(Boolean);

    // 오답 3개
    const wrongs = shuffle(planetNamePool.filter((n) => n !== correct)).slice(0, 3);
    const choices = shuffle([correct, ...wrongs]);

    lunarBank.push({
      category: "moon",
      question: `Q) ${m.name_ko}은(는) 어느 행성의 위성일까요?`,
      choices,
      answerIndex: choices.indexOf(correct),
      explanation: `${m.name_ko}은(는) ${correct}의 위성입니다.`
    });
  }
}

console.log(`[boot] solarBank: ${solarBank.length}문항, lunarBank: ${lunarBank.length}문항 생성`);

// ------------------ 별자리 퀴즈 생성기 ------------------ //
function makeSeasonQuiz() {
  const pool = constellations.filter(
    (c) => c.hemisphere === "북반구" && c.season && c.name_ko
  );
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
  const pool = constellations.filter(
    (c) => Array.isArray(c.stars) && c.stars.length && c.name_ko
  );
  if (!pool.length) return null;
  const c = pick(pool);
  const star = pick(c.stars);
  const wrongs = constellations
    .filter((x) => x.name_ko !== c.name_ko)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3)
    .map((x) => x.name_ko);
  const choices = shuffle([c.name_ko, ...wrongs]);
  return {
    question: `Q) ‘${star}’ 별은 어느 별자리에 속해 있을까요?`,
    choices,
    answerIndex: choices.indexOf(c.name_ko),
    explanation: `${star}는 ${c.name_ko}에 속한 별입니다.`
  };
}

function makeHemisphereQuiz() {
  const pool = constellations.filter((c) => c.name_ko && c.hemisphere);
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

// ------------------ 태양/달 퀴즈 픽커 ------------------ //
function makeSolarQuiz() {
  return solarBank.length ? pick(solarBank) : null;
}
function makeLunarQuiz() {
  return lunarBank.length ? pick(lunarBank) : null;
}

// ------------------ 성도(이미지) 퀴즈 ------------------ //
function makeImageQuiz() {
  const pool = constellations.filter((c) => c.name_ko && c.name_en);
  if (!pool.length) return null;
  const c = pick(pool);
  const imagePath = `/public/images/constellations_iau/${c.name_en.toLowerCase()}.svg`;
  const wrongs = pool
    .filter((x) => x.name_ko !== c.name_ko)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3)
    .map((x) => x.name_ko);
  const choices = shuffle([c.name_ko, ...wrongs]);
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

app.get("/debug", (req, res) => {
  res.json({
    constellations_count: constellations.length,
    solarBank_count: solarBank.length,
    lunarBank_count: lunarBank.length,
    samples: {
      constellation: constellations[0] || null,
      solar: solarBank[0] || null,
      lunar: lunarBank[0] || null
    }
  });
});

// ------------------ API ------------------ //
app.post("/chat", (req, res) => {
  try {
    const mode = req.body?.mode || "random";

    // ★ 여기에 추가
    console.log("[/chat] mode =", mode);

    const pickers = {
      season: makeSeasonQuiz,
      star: makeStarQuiz,
      hemisphere: makeHemisphereQuiz,
      solar: makeSolarQuiz,
      lunar: makeLunarQuiz,
      image: makeImageQuiz
    };

    let quiz = pickers[mode] ? pickers[mode]() : null;

    if ((mode === "solar" || mode === "lunar") && !quiz) {
      // (선택) 원인 파악용 추가 로그
      console.warn("[/chat] NO_QUIZ_FOR_CATEGORY:", mode);
      return res.status(500).json({
        error: "NO_QUIZ_FOR_CATEGORY",
        message: `요청 모드(${mode})에 해당하는 문제가 없습니다. /debug에서 solarBank/lunarBank 개수를 확인하세요.`
      });
    }

    if (!quiz) {
      // (선택) 대체 로직 들어가는 경우 로그
      console.log("[/chat] fallback to other quiz types (mode:", mode, ")");
      const order = [
        makeSeasonQuiz,
        makeStarQuiz,
        makeHemisphereQuiz,
        makeSolarQuiz,
        makeLunarQuiz,
        makeImageQuiz
      ];
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
