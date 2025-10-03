// server.mjs
import express from "express";
import fs from "fs";
import path from "path";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

// /public 정적 경로 (index.html은 sendFile로 별도 서빙)
app.use("/public", express.static(path.join(__dirname, "public"), { maxAge: "7d" }));

app.get("/", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", (_, res) => res.json({ ok: true }));

// ───────────── 유틸 ─────────────
const rand = n => Math.floor(Math.random() * n);
const shuffle = arr => arr.slice().sort(() => Math.random() - 0.5);
const ALLOWED_IMG_EXT = new Set([".svg", ".png", ".jpg", ".jpeg", ".webp"]);

const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const normalizeStem = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\.(svg|png|jpg|jpeg|webp)$/i, "")
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

// ───────────── 데이터 로드 ─────────────
let constellations = [];
let solarData = {};

try {
  constellations = JSON.parse(
    fs.readFileSync(path.join(__dirname, "constellations_88_ko_named.json"), "utf-8")
  );
} catch (e) {
  console.warn("[boot] constellations JSON load failed:", e.message);
}

try {
  solarData = JSON.parse(
    fs.readFileSync(path.join(__dirname, "solar_system.json"), "utf-8")
  );
} catch (e) {
  console.warn("[boot] solar_system JSON load failed:", e.message);
}

// 별자리 뱅크
const seasonBank = (constellations || [])
  .filter(c => c?.name_ko && c?.season)
  .map(c => ({ name_ko: c.name_ko, season: c.season }));

const hemisphereBank = (constellations || [])
  .filter(c => c?.name_ko && c?.hemisphere)
  .map(c => {
    let hemi = /남/.test(c.hemisphere) ? "남반구" : "북반구";
    return { name_ko: c.name_ko, hemisphere: hemi };
  });

// 영문→한글 매핑(성도 파일명 매칭용)
const enToKo = new Map();
const enVariants = new Map(); // key: 다양한 변형 → value: ko

for (const c of constellations || []) {
  const en = c?.name_en || c?.name || "";
  const ko = c?.name_ko || "";
  if (!en || !ko) continue;

  const slug = slugify(en);           // andromeda
  const tight = en.toLowerCase().replace(/[^a-z0-9]/g, ""); // andromeda (공백/특수문자 제거)

  enToKo.set(slug, ko);
  enVariants.set(slug, ko);
  enVariants.set(tight, ko);

  // 추가 변형: 공백→하이픈, 언더스코어 등
  const hyphen = en.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const underscore = en.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  enVariants.set(hyphen, ko);
  enVariants.set(underscore, ko);
}

// ───────────── 성도 이미지 스캔(유연 매칭) ─────────────
const CONST_IMG_DIR = path.join(__dirname, "public", "images", "constellations_iau");

function matchKoNameByStem(stem) {
  // 1) stem 자체가 우리가 만든 variant 키와 일치?
  if (enVariants.has(stem)) return enVariants.get(stem);

  // 2) stem에서 하이픈/언더스코어 제거해 타이트 비교
  const tight = stem.replace(/[-_]/g, "");
  if (enVariants.has(tight)) return enVariants.get(tight);

  // 3) stem을 공백기준으로 나눠 첫 토큰만 비교 (예: "leo-1" → "leo")
  const first = stem.split(/[-_]/)[0];
  if (enVariants.has(first)) return enVariants.get(first);

  return null;
}

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

    const stem = normalizeStem(filename); // 유연 정규화
    const ko = matchKoNameByStem(stem);
    if (!ko) {
      // 매칭 실패한 파일은 로그로만 알림
      // console.warn("[chart-skip] no match:", filename, "→ stem:", stem);
      continue;
    }
    arr.push({
      name_ko: ko,
      image: `/public/images/constellations_iau/${filename}`,
      credit: "Image © IAU (CC BY 4.0)"
    });
  }
  return arr;
}

const CHART_BANK = scanConstellationCharts();
console.log(`[boot] constellation charts found: ${CHART_BANK.length}개 at ${CONST_IMG_DIR}`);

// ───────────── 천체 사진(행성/태양/달) 스캔 ─────────────
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
  const out = [];
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!ALLOWED_IMG_EXT.has(ext)) continue;
    const stem = normalizeStem(f); // 소문자/하이픈 통일
    const meta = NAME_MAP[stem];
    if (!meta) continue;
    out.push({
      name_ko: meta.ko,
      type: meta.type,
      image: `/public/images/planets/${f}`,
      credit: "이미지: 로컬 에셋 (사용자 제공)"
    });
  }
  return out;
}
const BODY_BANK = scanPlanetPhotos();
console.log(`[boot] planet photos found: ${BODY_BANK.length}개 at ${PLANET_IMG_DIR}`);

// ───────────── 태양계 데이터 정리 ─────────────
let planets = Array.isArray(solarData.planets) ? solarData.planets : [];
let moons   = Array.isArray(solarData.moons)   ? solarData.moons   : [];
let eclipses= Array.isArray(solarData.eclipses)? solarData.eclipses: [];
const sunInfo = solarData.sun || null;

const orderMap = { "수성":1,"금성":2,"지구":3,"화성":4,"목성":5,"토성":6,"천왕성":7,"해왕성":8 };
const innerSet = new Set(["수성","금성","지구","화성"]);
const outerGas = new Set(["목성","토성"]);

if (!planets.length) {
  planets = [
    { name_ko:"수성" },{ name_ko:"금성" },{ name_ko:"지구" },{ name_ko:"화성" },
    { name_ko:"목성" },{ name_ko:"토성" },{ name_ko:"천왕성" },{ name_ko:"해왕성" }
  ];
}
planets = planets.map(p => ({
  ...p,
  orbit_order: typeof p.orbit_order === "number" ? p.orbit_order : (orderMap[p.name_ko] || null),
  type: p.type || (innerSet.has(p.name_ko) ? "지구형" : outerGas.has(p.name_ko) ? "가스형" : "얼음형")
}));
if (!moons.length) moons = [{ name_ko:"달", planet:"지구" }];

// ───────────── 문제 생성기 ─────────────
function makeSeasonQuiz() {
  if (!seasonBank.length) return null;
  const item = seasonBank[rand(seasonBank.length)];
  const seasons = ["봄","여름","가을","겨울"];
  let choices = shuffle(seasons);
  if (!choices.includes(item.season)) { choices[0] = item.season; choices = shuffle(choices); }
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
  const choices = ["북반구","남반구"];
  return {
    category: "constellation",
    subtype: "hemisphere",
    question: `Q) 「${item.name_ko}」는 주로 어느 반구의 별자리일까요?`,
    choices,
    answerIndex: choices.indexOf(item.hemisphere),
    explanation: `${item.name_ko}는(은) ${item.hemisphere} 하늘에서 잘 보입니다.`
  };
}

function makeConstellationImageQuiz() {
  if (!CHART_BANK.length) return null;
  const correct = CHART_BANK[rand(CHART_BANK.length)];
  let others = shuffle(CHART_BANK.filter(x => x.name_ko !== correct.name_ko)).slice(0,3);
  const choiceObjs = shuffle([correct, ...others]);
  const choices = choiceObjs.map(x => x.name_ko);
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

function makeSolarQuiz() {
  const types = ["planet-img","type","orbit","inner-outer","moon-belongs","sun-what","eclipse-order"];
  const t = types[rand(types.length)];

  if (t === "planet-img" && BODY_BANK.length >= 2) {
    const correct = BODY_BANK[rand(BODY_BANK.length)];
    let picks = shuffle(BODY_BANK.filter(b => b !== correct)).slice(0,3);
    const choiceObjs = shuffle([correct, ...picks]);
    const choices = choiceObjs.map(x => x.name_ko);
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

  const withOrder = planets.filter(p=>typeof p.orbit_order==="number");
  if (t === "orbit" && withOrder.length >= 2) {
    const p = withOrder[rand(withOrder.length)];
    const all = [...new Set(withOrder.map(x=>x.orbit_order))];
    const distractors = shuffle(all.filter(n=>n!==p.orbit_order)).slice(0,3);
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

  if (t === "inner-outer" && planets.length) {
    const p = planets[rand(planets.length)];
    const cls = (new Set(["수성","금성","지구","화성"]).has(p.name_ko) ? "내행성" : "외행성");
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

  if (t === "eclipse-order" && eclipses.length) {
    const e = eclipses[rand(eclipses.length)];
    const correct = e.order.join(" → ");
    const fillers = ["태양 → 달 → 지구","달 → 지구 → 태양","지구 → 달 → 태양","달 → 태양 → 지구"];
    let choices = shuffle([correct, ...fillers]).slice(0,4);
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

// ───────────── API ─────────────
app.get("/debug", (_, res) => {
  res.json({
    constellations_count: constellations.length,
    seasonBank_count: seasonBank.length,
    hemisphereBank_count: hemisphereBank.length,
    charts_count: CHART_BANK.length,
    planet_photos_count: BODY_BANK.length
  });
});

app.post("/chat", (req, res) => {
  try {
    const mode = req.body?.mode || "random";
    let quiz = null;

    if (mode === "image") {
      quiz = makeConstellationImageQuiz();
    } else if (mode === "constellation") {
      quiz = (Math.random() < 0.5 ? makeSeasonQuiz() : makeHemisphereQuiz());
      if (!quiz) quiz = makeSeasonQuiz() || makeHemisphereQuiz();
    } else if (mode === "solar") {
      quiz = makeSolarQuiz();
    } else if (mode === "random") {
      const group = shuffle([
        () => makeConstellationImageQuiz(),
        () => (Math.random() < 0.5 ? makeSeasonQuiz() : makeHemisphereQuiz()),
        () => makeSolarQuiz()
      ]);
      for (const fn of group) { quiz = fn(); if (quiz) break; }
    } else {
      quiz = makeConstellationImageQuiz() || makeSeasonQuiz() || makeHemisphereQuiz() || makeSolarQuiz();
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Quiz server running on port ${PORT}`);
  console.log(`➡️  Health: GET /health | Debug: GET /debug | Quiz: POST /chat  (modes: random, image, constellation, solar)`);
});
