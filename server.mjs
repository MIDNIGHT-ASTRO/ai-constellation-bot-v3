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

// ──────────────────────────────────────────────────────────────
// 기본 페이지 & 정적 파일
// ──────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.sendFile(path.join(__dirname, "index.html"));
});

app.use("/public", express.static(path.join(__dirname, "public"), {
  maxAge: "7d",
  etag: true
}));

app.get("/health", (_, res) => res.json({ ok: true }));

// ──────────────────────────────────────────────────────────────
// 유틸
// ──────────────────────────────────────────────────────────────
const rand = n => Math.floor(Math.random() * n);
const shuffle = arr => arr.slice().sort(() => Math.random() - 0.5);

function safeLoadJSON(relPath) {
  const p = path.join(__dirname, relPath);
  try {
    return { ok: true, path: p, data: JSON.parse(fs.readFileSync(p, "utf-8")) };
  } catch (e) {
    console.warn(`[boot] JSON load fail: ${relPath} → ${e.message}`);
    return { ok: false, path: p, data: null, error: e.message };
  }
}

const ALLOWED_IMG_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".svg"]);

const slugify = (s) =>
  s.toLowerCase()
   .replace(/'/g, "")
   .replace(/[^a-z0-9]+/g, "-")
   .replace(/^-+|-+$/g, "");

// ──────────────────────────────────────────────────────────────
// 1) 별자리 데이터 & 성도(이미지)
//    - constellations_88_ko_named.json 필요
//    - 성도 이미지 경로: public/images/constellations_iau/*.svg|png|jpg (파일명 = 영문명 슬러그)
// ──────────────────────────────────────────────────────────────
const C = safeLoadJSON("constellations_88_ko_named.json");
const constellations = Array.isArray(C.data) ? C.data : [];
console.log(`[boot] constellations: ${constellations.length}개 from ${C.path}`);

const enToKoMap = new Map();
for (const c of constellations) {
  if (!c) continue;
  const en = c.name_en || c.name || "";
  const ko = c.name_ko || c.korean || "";
  if (en && ko) enToKoMap.set(slugify(en), ko);
}

// 계절/반구 뱅크
const seasonBank = constellations
  .filter(c => c?.name_ko && c?.season)
  .map(c => ({ name_ko: c.name_ko, season: c.season }));

const hemisphereBank = constellations
  .filter(c => c?.name_ko && c?.hemisphere)
  .map(c => {
    let hemi = c.hemisphere;
    if (/남/.test(hemi)) hemi = "남반구";
    else hemi = "북반구";
    return { name_ko: c.name_ko, hemisphere: hemi };
  });

// 성도 이미지 스캔
const CONST_IMG_DIR = path.join(__dirname, "public", "images", "constellations_iau");
function scanConstellationCharts() {
  let files = [];
  try {
    files = fs.readdirSync(CONST_IMG_DIR, { withFileTypes: true })
      .filter(d => d.isFile())
      .map(d => d.name);
  } catch (e) {
    console.warn("[boot] cannot read IAU charts:", CONST_IMG_DIR, e.message);
  }
  const arr = [];
  for (const filename of files) {
    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_IMG_EXT.has(ext)) continue;
    const slug = path.basename(filename, ext).toLowerCase(); // 예: andromeda
    const koName = enToKoMap.get(slug);
    if (!koName) continue; // 매핑 안되면 스킵
    arr.push({
      slug,
      name_ko: koName,
      image: `/public/images/constellations_iau/${filename}`,
      credit: "Image © IAU (CC BY 4.0)"
    });
  }
  return arr;
}
const CHART_BANK = scanConstellationCharts();
console.log(`[boot] constellation charts: ${CHART_BANK.length}개 from ${CONST_IMG_DIR}`);

// ──────────────────────────────────────────────────────────────
// 2) 태양계 데이터 & 천체 사진(로컬)
//    - solar_system.json (태양/행성/달/식 정보)
//    - 행성/천체 이미지 경로: public/images/planets/* (파일명: mercury, venus, earth...)
// ──────────────────────────────────────────────────────────────
const S = safeLoadJSON("solar_system.json");
const sol = S.data || {};
console.log(`[boot] solar_system: ${S.ok ? "OK" : "FAIL"} from ${S.path}`);

let planets = Array.isArray(sol.planets) ? sol.planets : [];
let moons = Array.isArray(sol.moons) ? sol.moons : [];
let eclipses = Array.isArray(sol.eclipses) ? sol.eclipses : [];
const sunInfo = sol.sun || null;

const orderMap = { "수성":1, "금성":2, "지구":3, "화성":4, "목성":5, "토성":6, "천왕성":7, "해왕성":8 };
const innerSet = new Set(["수성","금성","지구","화성"]);
const outerGas = new Set(["목성","토성"]);

if (!planets.length) {
  planets = [
    { name_ko:"수성" }, { name_ko:"금성" }, { name_ko:"지구" }, { name_ko:"화성" },
    { name_ko:"목성" }, { name_ko:"토성" }, { name_ko:"천왕성" }, { name_ko:"해왕성" }
  ];
}
planets = planets.map(p => ({
  ...p,
  orbit_order: typeof p.orbit_order === "number" ? p.orbit_order : (orderMap[p.name_ko] || null),
  type: p.type || (innerSet.has(p.name_ko) ? "지구형" : outerGas.has(p.name_ko) ? "가스형" : "얼음형")
}));
if (!moons.length) moons = [{ name_ko:"달", planet:"지구" }];

const PLANET_IMG_DIR = path.join(__dirname, "public", "images", "planets");
const NAME_MAP = {
  mercury:{ ko:"수성", type:"행성" }, venus:{ ko:"금성", type:"행성" }, earth:{ ko:"지구", type:"행성" }, mars:{ ko:"화성", type:"행성" },
  jupiter:{ ko:"목성", type:"행성" }, saturn:{ ko:"토성", type:"행성" }, uranus:{ ko:"천왕성", type:"행성" }, neptune:{ ko:"해왕성", type:"행성" },
  sun:{ ko:"태양", type:"항성" }, moon:{ ko:"달", type:"위성" }, pluto:{ ko:"명왕성", type:"왜소행성" }, comet:{ ko:"혜성", type:"소천체" }
};
function scanPlanetPhotos() {
  let files = [];
  try {
    files = fs.readdirSync(PLANET_IMG_DIR, { withFileTypes: true })
      .filter(d => d.isFile()).map(d => d.name);
  } catch (e) {
    console.warn("[boot] cannot read planet images:", PLANET_IMG_DIR, e.message);
  }
  const arr = [];
  for (const filename of files) {
    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_IMG_EXT.has(ext)) continue;
    const slug = path.basename(filename, ext).toLowerCase(); // e.g., earth
    const m = NAME_MAP[slug];
    if (!m) continue;
    arr.push({
      slug,
      name_ko: m.ko,
      type: m.type,
      image: `/public/images/planets/${filename}`,
      credit: "이미지: 로컬 에셋 (사용자 제공)"
    });
  }
  return arr;
}
const BODY_BANK = scanPlanetPhotos();
console.log(`[boot] planet photos: ${BODY_BANK.length}개 from ${PLANET_IMG_DIR}`);

// ──────────────────────────────────────────────────────────────
/** 별자리 퀴즈(계절/반구 통합) */
// ──────────────────────────────────────────────────────────────
function makeSeasonQuiz() {
  if (!seasonBank.length) return null;
  const item = seasonBank[rand(seasonBank.length)];
  const seasons = ["봄","여름","가을","겨울"];
  let choices = shuffle(seasons);
  if (!choices.includes(item.season)) {
    choices[0] = item.season;
    choices = shuffle(choices);
  }
  return {
    category: "constellation",
    subtype: "season",
    question: `Q) 「${item.name_ko}」는 북반구 기준 어떤 계절의 별자리일까요?`,
    choices,
    answerIndex: choices.indexOf(item.season),
    explanation: `${item.name_ko}는(은) ${item.season}철 대표 별자리입니다.`
  };
}

function makeHemisphereQuiz() {
  if (!hemisphereBank.length) return null;
  const item = hemisphereBank[rand(hemisphereBank.length)];
  const choices = ["북반구","남반구"]; // 2지선다
  return {
    category: "constellation",
    subtype: "hemisphere",
    question: `Q) 「${item.name_ko}」는 주로 어느 반구의 별자리일까요?`,
    choices,
    answerIndex: choices.indexOf(item.hemisphere),
    explanation: `${item.name_ko}는(은) ${item.hemisphere} 하늘에서 잘 보입니다.`
  };
}

// 성도(이미지) 모드: 4지선다, 정답은 이미지에 해당하는 별자리
function makeConstellationImageQuiz() {
  if (!CHART_BANK.length) return null;
  const correct = CHART_BANK[rand(CHART_BANK.length)];
  // 오답 3개
  let others = shuffle(CHART_BANK.filter(x => x.slug !== correct.slug)).slice(0,3);
  let choiceObjs = shuffle([correct, ...others]);
  const choices = choiceObjs.map(o => o.name_ko);
  return {
    category: "image",
    question: "Q) 아래 성도(별자리 그림)는 어떤 별자리일까요?",
    choices,
    answerIndex: choices.indexOf(correct.name_ko),
    explanation: `${correct.name_ko} 성도입니다.`,
    image: correct.image,
    credit: correct.credit
  };
}

// ──────────────────────────────────────────────────────────────
/** 태양계 모드(달 포함, 사진 일부 섞임) */
// ──────────────────────────────────────────────────────────────
function makeSolarQuiz() {
  const types = ["planet-img","type","orbit","inner-outer","moon-belongs","sun-what","eclipse-order"];
  const t = types[rand(types.length)];

  // (1) 사진 맞추기 (행성/태양/달/혜성 포함, 로컬)
  if (t === "planet-img" && BODY_BANK.length >= 2) {
    const correctIdx = rand(BODY_BANK.length);
    const correct = BODY_BANK[correctIdx];
    const sameType = BODY_BANK.filter((b,i)=>i!==correctIdx && b.type===correct.type);
    const others   = BODY_BANK.filter((b,i)=>i!==correctIdx && b.type!==correct.type);
    let picks = shuffle(sameType).slice(0,3);
    if (picks.length<3) picks = picks.concat(shuffle(others).slice(0, 3-picks.length));
    const choiceObjs = shuffle([correct, ...picks].slice(0,4));
    const choices = choiceObjs.map(x=>x.name_ko);
    return {
      category:"solar",
      subtype:"photo",
      question:"Q) 이 사진의 천체는 무엇일까요?",
      choices,
      answerIndex: choices.indexOf(correct.name_ko),
      explanation:`${correct.name_ko} (${correct.type}) 입니다.`,
      image: correct.image,
      credit: correct.credit
    };
  }

  // (2) 행성 분류
  if (t === "type" && planets.length) {
    const p = planets[rand(planets.length)];
    const kinds = ["지구형","가스형","얼음형"];
    const choices = shuffle(kinds);
    return {
      category:"solar",
      subtype:"type",
      question:`Q) 「${p.name_ko}」는(은) 어떤 분류의 행성일까요?`,
      choices,
      answerIndex: choices.indexOf(p.type),
      explanation:`${p.name_ko}는(은) ${p.type} 행성입니다.`
    };
  }

  // (3) 공전 순서
  const withOrder = planets.filter(p=>typeof p.orbit_order==="number");
  if (t === "orbit" && withOrder.length >= 2) {
    const p = withOrder[rand(withOrder.length)];
    const allOrders = withOrder.map(x=>x.orbit_order);
    const distractors = shuffle([...new Set(allOrders.filter(n=>n!==p.orbit_order))]).slice(0,3);
    const choices = shuffle([p.orbit_order, ...distractors]).map(n=>`${n}번째`);
    return {
      category:"solar",
      subtype:"orbit",
      question:`Q) 「${p.name_ko}」는(은) 태양에서 몇 번째 행성일까요?`,
      choices,
      answerIndex: choices.indexOf(`${p.orbit_order}번째`),
      explanation:`${p.name_ko}는(은) 태양에서 ${p.orbit_order}번째 행성입니다.`
    };
  }

  // (4) 내행성/외행성
  if (t === "inner-outer" && planets.length) {
    const p = planets[rand(planets.length)];
    const cls = (innerSet.has(p.name_ko) ? "내행성" : "외행성");
    const choices = ["내행성","외행성"];
    return {
      category:"solar",
      subtype:"inner-outer",
      question:`Q) 「${p.name_ko}」는(은) 내행성일까요, 외행성일까요?`,
      choices,
      answerIndex: choices.indexOf(cls),
      explanation:`${p.name_ko}는(은) ${cls}입니다.`
    };
  }

  // (5) 위성 소속 (달 포함)
  if (t === "moon-belongs" && moons.length) {
    const m = moons[rand(moons.length)];
    const planetNames = [...new Set(planets.map(p=>p.name_ko))];
    let choices = shuffle(planetNames).slice(0,3);
    if (!choices.includes(m.planet)) choices.push(m.planet);
    choices = shuffle(choices).slice(0,4);
    return {
      category:"solar",
      subtype:"moon-belongs",
      question:`Q) 「${m.name_ko}」는(은) 어느 행성의 위성일까요?`,
      choices,
      answerIndex: choices.indexOf(m.planet),
      explanation:`${m.name_ko}는(은) ${m.planet}의 위성입니다.`
    };
  }

  // (6) 태양이란?
  if (t === "sun-what") {
    const choices = ["항성","행성","위성","왜소행성"];
    return {
      category:"solar",
      subtype:"sun-what",
      question:"Q) 태양은 무엇인가요?",
      choices,
      answerIndex: choices.indexOf("항성"),
      explanation:"태양은 태양계의 중심 항성입니다."
    };
  }

  // (7) 일식/월식 배치
  if (t === "eclipse-order" && eclipses.length) {
    const e = eclipses[rand(eclipses.length)];
    const correct = e.order.join(" → ");
    const distract = ["태양 → 달 → 지구","달 → 지구 → 태양","지구 → 달 → 태양","달 → 태양 → 지구"];
    let choices = shuffle([correct, ...distract]).slice(0,4);
    return {
      category:"solar",
      subtype:"eclipse-order",
      question:`Q) ${e.type}의 천체 배치는 어떻게 될까요?`,
      choices,
      answerIndex: choices.indexOf(correct),
      explanation:`${e.type}은(는) 「${correct}」 순서로 일어납니다.`
    };
  }

  return null;
}

// ──────────────────────────────────────────────────────────────
// 디버그
// ──────────────────────────────────────────────────────────────
app.get("/debug", (_, res) => {
  res.json({
    constellations_count: constellations.length,
    seasonBank_count: seasonBank.length,
    hemisphereBank_count: hemisphereBank.length,
    charts_count: CHART_BANK.length,
    planets_count: planets.length,
    moons_count: moons.length,
    eclipses_count: eclipses.length,
    planet_photos_count: BODY_BANK.length,
    samples: {
      constellation: constellations[0],
      chart: CHART_BANK[0],
      planet: planets[0],
      moon: moons[0],
      eclipse: eclipses[0],
      body_photo: BODY_BANK[0]
    }
  });
});

// ──────────────────────────────────────────────────────────────
// /chat  — 모드별 엄격 분기
//   1) random : 임의(이미지/별자리퀴즈/태양계 중 섞기)
//   2) image  : 성도(이미지) 문제만
//   3) constellation : 계절(4지선다) 또는 반구(2지선다) 중 랜덤
//   4) solar  : 태양/행성/달/식 (사진 포함형 일부 섞임)
// ──────────────────────────────────────────────────────────────
app.post("/chat", (req, res) => {
  try {
    const mode = req.body?.mode || "random";
    let quiz = null;

    if (mode === "image") {
      quiz = makeConstellationImageQuiz();
    } else if (mode === "constellation") {
      // 계절/반구 중 하나만 랜덤
      quiz = (Math.random() < 0.5 ? makeSeasonQuiz() : makeHemisphereQuiz());
      if (!quiz) quiz = makeSeasonQuiz() || makeHemisphereQuiz();
    } else if (mode === "solar") {
      quiz = makeSolarQuiz();
    } else if (mode === "random") {
      // 세 가지 축에서 랜덤
      const group = shuffle([
        () => makeConstellationImageQuiz(),
        () => (Math.random()<0.5?makeSeasonQuiz():makeHemisphereQuiz()),
        () => makeSolarQuiz()
      ]);
      for (const fn of group) {
        quiz = fn();
        if (quiz) break;
      }
    } else {
      // 알 수 없는 모드 → random
      const group = shuffle([
        () => makeConstellationImageQuiz(),
        () => (Math.random()<0.5?makeSeasonQuiz():makeHemisphereQuiz()),
        () => makeSolarQuiz()
      ]);
      for (const fn of group) {
        quiz = fn();
        if (quiz) break;
      }
    }

    if (!quiz || !Array.isArray(quiz.choices) || typeof quiz.answerIndex !== "number") {
      console.error("[/chat] INVALID_QUIZ_PAYLOAD", { mode, hasQuiz: !!quiz });
      return res.status(500).json({ error: "INVALID_QUIZ_PAYLOAD" });
    }

    return res.json({ type: "quiz", data: quiz });
  } catch (e) {
    console.error("[/chat] error:", e);
    return res.status(500).json({ error: "QUIZ_SERVER_ERROR", message: String(e) });
  }
});

// ──────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Quiz server running on port ${PORT}`);
  console.log(`➡️  Health: GET /health  |  Debug: GET /debug`);
  console.log(`➡️  Quiz: POST /chat (modes: random | image | constellation | solar)`);
});
