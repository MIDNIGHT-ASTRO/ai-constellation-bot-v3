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

// ===== 공통 유틸 =====
function safeLoadJSON(relPath) {
  const abs = path.join(__dirname, relPath);
  try {
    const txt = fs.readFileSync(abs, "utf-8");
    return { ok: true, data: JSON.parse(txt), path: abs };
  } catch (e) {
    return { ok: false, error: e.message, data: null, path: abs };
  }
}
const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
const shuffle = (arr) => arr.slice().sort(() => Math.random() - 0.5);
const unique = (arr) => Array.from(new Set(arr));
const safePick = (arr) => (Array.isArray(arr) && arr.length ? pick(arr) : null);

// ===== index.html 캐시 금지 =====
app.get("/", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.sendFile(path.join(__dirname, "index.html"));
});

// 정적 리소스는 캐시 OK
app.use("/public", express.static(path.join(__dirname, "public"), {
  maxAge: "7d",
  etag: true
}));

// 헬스체크
app.get("/health", (req, res) => res.json({ ok: true }));

// ===== 별자리 데이터 로드/정규화 =====
const RAW = safeLoadJSON("constellations_88_ko_named.json");
let rawList = Array.isArray(RAW.data) ? RAW.data : (RAW.data?.constellations || []);
if (!Array.isArray(rawList)) rawList = [];

const seasonMap = { spring:"봄", summer:"여름", autumn:"가을", fall:"가을", winter:"겨울", "year-round":"연중" };
const hemiMap   = { N:"북반구", S:"남반구", E:"북반구" };

const constellations = rawList.map(c => {
  const stars = Array.isArray(c?.notable_stars)
    ? c.notable_stars.map(s => s?.name_ko).filter(Boolean)
    : Array.isArray(c?.stars) ? c.stars : [];
  const season = c?.season || seasonMap[(c?.best_season_northern || "").toLowerCase()] || "연중";
  const hemisphere = hemiMap[c?.hemisphere] || c?.hemisphere || "북반구";
  return {
    name_en: c?.name_en || c?.english || c?.name || "",
    name_ko: c?.name_ko || c?.korean || "",
    hemisphere,
    season,
    stars
  };
}).filter(c => c.name_en && c.name_ko);

// 한국천문연구원 기준 보정: 게자리=겨울
for (const c of constellations) {
  if (c.name_ko === "게자리" || c.name_en?.toLowerCase() === "cancer") c.season = "겨울";
}

console.log(`[boot] constellations normalized: ${constellations.length}개 (from ${RAW.path}) ${RAW.ok ? "" : "❌ "+RAW.error}`);

// ===== 태양계 원천 → 문제은행 생성 (달 포함) =====
const SOL = safeLoadJSON("solar_system.json");
const sol = SOL.data || {};
console.log(`[boot] solar_system source: ${SOL.ok ? "OK" : "FAIL"} (from ${SOL.path}) ${SOL.ok ? "" : "❌ "+SOL.error}`);

const planets  = Array.isArray(sol.planets)  ? sol.planets  : [];
const moons    = Array.isArray(sol.moons)    ? sol.moons    : [];
const eclipses = Array.isArray(sol.eclipses) ? sol.eclipses : [];
const sunInfo  = sol.sun || null;

const innerPlanets = new Set(["수성","금성","지구","화성"]);
const outerPlanets = new Set(["목성","토성","천왕성","해왕성"]);

const MOON_FACTS = { rotation_days: 27.3, synodic_days: 29.5, evening_not_visible: "그믐달", dawn_not_visible: "초승달" };

// 행성 이미지(있을 때만 출제)
const planetSlugByKo = {
  "수성":"mercury","금성":"venus","지구":"earth","화성":"mars",
  "목성":"jupiter","토성":"saturn","천왕성":"uranus","해왕성":"neptune"
};
function findPlanetImage(nameKo) {
  const slug = planetSlugByKo[nameKo];
  if (!slug) return null;
  const base = path.join(__dirname, "public", "images", "planets", slug);
  const files = [base+".png", base+".jpg", base+".jpeg", base+".webp", base+".svg"];
  for (const f of files) if (fs.existsSync(f)) return `/public/images/planets/${path.basename(f)}`;
  return null;
}

let solarBank = [];

// (1) 태양 정체
if (sunInfo) {
  const base = ["항성","행성","위성","왜소행성"];
  const choices = shuffle(base);
  solarBank.push({
    category: "solar", qtype: "sun_identity",
    question: "Q) 태양은 무엇인가요?",
    choices, answerIndex: choices.indexOf("항성"),
    explanation: "태양은 태양계의 중심 항성입니다."
  });
}

// (2) 일식/월식 배치
for (const e of eclipses) {
  if (!Array.isArray(e.order) || e.order.length !== 3) continue;
  const correct = e.order.join(" → ");
  const wrongs = new Set();
  wrongs.add([...e.order].reverse().join(" → "));
  for (let i=0; i<8 && wrongs.size<3; i++) wrongs.add(shuffle(e.order).join(" → "));
  if (wrongs.size < 3) {
    wrongs.add(["지구","달","태양"].join(" → "));
    wrongs.add(["달","태양","지구"].join(" → "));
  }
  const choices = shuffle([correct, ...Array.from(wrongs).slice(0,3)]);
  solarBank.push({
    category: "solar", qtype: "eclipse_order",
    question: `Q) ${e.type}이(가) 일어날 때 올바른 천체 배치는 무엇일까요?`,
    choices, answerIndex: choices.indexOf(correct),
    explanation: e.desc || ""
  });
}

// (3) 태양에서 n번째 행성
const byOrder = planets
  .filter(p => typeof p.orbit_order === "number")
  .sort((a,b)=> a.orbit_order - b.orbit_order);
const planetNames = byOrder.map(p => p.name_ko);

for (const p of byOrder) {
  const correct = p.name_ko;
  const distract = shuffle(planetNames.filter(n => n !== correct)).slice(0,3);
  const choices = shuffle([correct, ...distract]);
  solarBank.push({
    category: "solar", qtype: "planet_order",
    question: `Q) 태양에서 ${p.orbit_order}번째 행성은 무엇일까요?`,
    choices, answerIndex: choices.indexOf(correct),
    explanation: `태양에서 ${p.orbit_order}번째 행성은 ${correct}입니다.`
  });
}

// (4) 행성 유형(지구형/가스형/얼음형)
const types = unique(planets.map(p=>p.type).filter(Boolean));
for (const p of planets) {
  const correct = p.type;
  const distract = shuffle(types.filter(t=>t!==correct)).slice(0,3);
  const pool = unique([correct, ...distract]);
  const choices = shuffle(pool.length>=4 ? pool.slice(0,4) : pool);
  solarBank.push({
    category: "solar", qtype: "planet_type",
    question: `Q) ${p.name_ko}은(는) 어떤 유형의 행성일까요?`,
    choices, answerIndex: choices.indexOf(correct),
    explanation: `${p.name_ko}은(는) ${correct} 행성입니다.`
  });
}

// (5) 내행성/외행성
for (const p of planets) {
  const cls = innerPlanets.has(p.name_ko) ? "내행성" : (outerPlanets.has(p.name_ko) ? "외행성" : null);
  if (!cls) continue;
  const choices = shuffle(["내행성","외행성"]);
  solarBank.push({
    category: "solar", qtype: "inner_outer",
    question: `Q) ${p.name_ko}은(는) 내행성일까요, 외행성일까요?`,
    choices, answerIndex: choices.indexOf(cls),
    explanation: `${p.name_ko}은(는) ${cls}입니다.`
  });
}

// (6) 행성 이미지 맞히기 (이미지가 있는 경우만)
for (const p of planets) {
  const img = findPlanetImage(p.name_ko);
  if (!img) continue;
  const correct = p.name_ko;
  const distract = shuffle(planetNames.filter(n=>n!==correct)).slice(0,3);
  const choices = shuffle([correct, ...distract]);
  solarBank.push({
    category: "solar", qtype: "planet_image",
    question: "Q) 다음 행성 이미지는 무엇일까요?",
    image: img, choices, answerIndex: choices.indexOf(correct),
    explanation: `이미지는 ${correct}입니다.`
  });
}

// (7) 위성 소속 (달 포함)
if (moons.length) {
  const planetPool = unique([
    ...planets.map(p=>p.name_ko),
    ...moons.map(m=>m.planet)
  ]).filter(Boolean);
  for (const m of moons) {
    const correct = m.planet;
    const distract = shuffle(planetPool.filter(n=>n!==correct)).slice(0,3);
    const choices = shuffle([correct, ...distract]);
    solarBank.push({
      category: "solar", qtype: "moon_owner",
      question: `Q) ${m.name_ko}은(는) 어느 행성의 위성일까요?`,
      choices, answerIndex: choices.indexOf(correct),
      explanation: `${m.name_ko}은(는) ${correct}의 위성입니다.`
    });
  }
}

// (8) 달의 자전/삭망 주기 + 월령/시간대
{
  // 자전주기
  const correct = "약 27.3일";
  const pool = ["24시간","약 29.5일","약 7일","약 14일","약 27.3일","약 30일"];
  const choices = shuffle(unique([correct, ...shuffle(pool).slice(0,3)]));
  solarBank.push({
    category: "solar", qtype: "moon_rotation",
    question: "Q) 달의 자전주기는 얼마일까요?",
    choices, answerIndex: choices.indexOf(correct),
    explanation: "달의 자전주기는 약 27.3일(항성월)입니다."
  });
  // 삭망주기
  const correct2 = "약 29.5일";
  const pool2 = ["약 27.3일","24시간","약 7일","약 14일","약 30일","약 31일"];
  const choices2 = shuffle(unique([correct2, ...shuffle(pool2).slice(0,3)]));
  solarBank.push({
    category: "solar", qtype: "moon_synodic",
    question: "Q) 달의 삭망주기(합삭→합삭)는 얼마일까요?",
    choices: choices2, answerIndex: choices2.indexOf(correct2),
    explanation: "달의 삭망주기는 약 29.5일입니다."
  });
  // 월령/시간대: 저녁
  const eCorrect = MOON_FACTS.evening_not_visible; // 그믐달
  const eChoices = shuffle(["보름달","상현달","초승달", eCorrect]);
  solarBank.push({
    category: "solar", qtype: "moon_phase_evening",
    question: "Q) 다음 중 ‘저녁 시간’에 볼 수 없는 달의 모습은?",
    choices: eChoices, answerIndex: eChoices.indexOf(eCorrect),
    explanation: "그믐달은 주로 새벽에 보입니다."
  });
  // 월령/시간대: 새벽
  const dCorrect = MOON_FACTS.dawn_not_visible; // 초승달
  const dChoices = shuffle(["보름달","하현달","그믐달", dCorrect]);
  solarBank.push({
    category: "solar", qtype: "moon_phase_dawn",
    question: "Q) 다음 중 ‘새벽 시간’에 볼 수 없는 달의 모습은?",
    choices: dChoices, answerIndex: dChoices.indexOf(dCorrect),
    explanation: "초승달은 해진 직후 저녁 서쪽 하늘에 보입니다."
  });
}

console.log(`[boot] solarBank 생성 완료: ${solarBank.length}문항`);

// ===== 별자리 퀴즈 생성기 =====
function makeSeasonQuiz() {
  const pool = constellations.filter(c => c.hemisphere === "북반구" && c.season && c.name_ko);
  const c = safePick(pool);
  if (!c) return null;
  const seasons = ["봄","여름","가을","겨울"];
  return {
    question: `Q) ${c.name_ko}는 북반구 기준 어떤 계절의 별자리일까요?`,
    choices: seasons,
    answerIndex: seasons.indexOf(c.season),
    explanation: `${c.name_ko}는 ${c.season}철에 잘 보입니다.`
  };
}

function makeStarQuiz() {
  const pool = constellations.filter(c => Array.isArray(c.stars) && c.stars.length && c.name_ko);
  const c = safePick(pool);
  if (!c) return null;
  const star = pick(c.stars);
  const wrongs = constellations
    .filter(x => x.name_ko !== c.name_ko)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3)
    .map(x => x.name_ko);
  const choices = shuffle([c.name_ko, ...wrongs]);
  return {
    question: `Q) ‘${star}’ 별은 어느 별자리에 속해 있을까요?`,
    choices,
    answerIndex: choices.indexOf(c.name_ko),
    explanation: `${star}는 ${c.name_ko}에 속합니다.`
  };
}

function makeHemisphereQuiz() {
  const pool = constellations.filter(c => c.name_ko && c.hemisphere);
  const c = safePick(pool);
  if (!c) return null;
  const choices = ["북반구","남반구"];
  return {
    question: `Q) ${c.name_ko}는 주로 어느 반구에서 잘 보일까요?`,
    choices,
    answerIndex: choices.indexOf(c.hemisphere),
    explanation: `${c.name_ko}는 ${c.hemisphere} 별자리입니다.`
  };
}

function makeImageQuiz() {
  const pool = constellations.filter(c => c.name_ko && c.name_en);
  const c = safePick(pool);
  if (!c) return null;
  const imagePath = `/public/images/constellations_iau/${c.name_en.toLowerCase()}.svg`;
  const wrongs = pool
    .filter(x => x.name_ko !== c.name_ko)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3)
    .map(x => x.name_ko);
  const choices = shuffle([c.name_ko, ...wrongs]);
  return {
    question: "Q) 다음 성도 이미지는 어떤 별자리일까요?",
    choices,
    answerIndex: choices.indexOf(c.name_ko),
    explanation: `이 성도는 ${c.name_ko}(${c.name_en}) 자리입니다.`,
    image: imagePath
  };
}

// ===== 디버그 =====
app.get("/debug", (req, res) => {
  res.json({
    constellations_count: constellations.length,
    solarBank_count: solarBank.length,
    samples: {
      constellation: constellations[0] || null,
      solar: solarBank[0] || null
    }
  });
});
app.get("/debug/sample", (req, res) => {
  res.json({ solarSample: safePick(solarBank) });
});

// ===== API =====
app.post("/chat", (req, res) => {
  try {
    let mode = req.body?.mode || "random";
    if (mode === "lunar") mode = "solar"; // 달 버튼/모드 통합
    console.log("[/chat] mode =", mode);

    const pickers = {
      season: makeSeasonQuiz,
      star: makeStarQuiz,
      hemisphere: makeHemisphereQuiz,
      solar: () => safePick(solarBank) || null,
      image: makeImageQuiz
    };

    let quiz = pickers[mode] ? pickers[mode]() : null;

    if (!quiz) {
      console.warn("[/chat] quiz null → fallback sequence");
      const order = [() => safePick(solarBank), makeSeasonQuiz, makeStarQuiz, makeHemisphereQuiz, makeImageQuiz];
      for (const fn of order) { quiz = fn(); if (quiz) break; }
    }

    if (!quiz || !Array.isArray(quiz.choices) || typeof quiz.answerIndex !== "number") {
      const base = ["항성","행성","위성","왜소행성"];
      const choices = shuffle(base);
      return res.json({
        type: "quiz",
        data: {
          category: "solar",
          qtype: "sun_identity_guard",
          question: "Q) 태양은 무엇인가요?",
          choices,
          answerIndex: choices.indexOf("항성"),
          explanation: "임시 문항(안전 가드)입니다. 서버 로그 확인 권장."
        }
      });
    }

    return res.json({ type: "quiz", data: quiz });
  } catch (e) {
    console.error("[/chat] error:", e);
    const base = ["항성","행성","위성","왜소행성"];
    const choices = shuffle(base);
    return res.json({
      type: "quiz",
      data: {
        category: "solar", qtype: "sun_identity_exception",
        question: "Q) 태양은 무엇인가요?",
        choices, answerIndex: choices.indexOf("항성"),
        explanation: "임시 문항(예외 처리)입니다. 서버 로그 확인 권장."
      }
    });
  }
});

// 서버 시작
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Quiz server running on port ${PORT}`);
  console.log(`➡️  Health: GET /health  |  Debug: GET /debug | Sample: GET /debug/sample | Quiz: POST /chat`);
});
