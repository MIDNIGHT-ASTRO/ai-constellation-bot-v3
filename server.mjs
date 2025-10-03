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

// ========= index.html 캐시 무효화로 서빙 =========
app.get("/", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.sendFile(path.join(__dirname, "index.html"));
});

// 정적 파일 (이미지 등) 1주 캐시
app.use("/public", express.static(path.join(__dirname, "public"), {
  maxAge: "7d", etag: true,
}));

app.get("/health", (_, res) => res.json({ ok: true }));

// ========= 유틸 =========
const rand = (n) => Math.floor(Math.random() * n);
const shuffle = (arr) => arr.slice().sort(() => Math.random() - 0.5);

function safeLoadJSON(relPath, expectArray = false) {
  const p = path.join(__dirname, relPath);
  try {
    const txt = fs.readFileSync(p, "utf-8");
    const data = JSON.parse(txt);
    if (expectArray && !Array.isArray(data)) throw new Error("JSON root is not array");
    return { ok: true, path: p, data };
  } catch (e) {
    console.warn(`[boot] JSON load fail: ${relPath} → ${e.message}`);
    return { ok: false, path: p, error: e.message, data: expectArray ? [] : {} };
  }
}

// ========= 1) 별자리 데이터 로드 =========
// 기대 구조(예): [{ name_ko, name_en, hemisphere, season, stars: ["미라",...]} ...]
const C = safeLoadJSON("constellations_88_ko_named.json", true);
const constellations = Array.isArray(C.data) ? C.data : [];
console.log(`[boot] constellations loaded: ${constellations.length}개 from ${C.path}`);

// 계절 뱅크(계절이 있는 항목만)
const seasonBank = constellations
  .filter(c => c && c.name_ko && c.season)
  .map(c => ({ name_ko: c.name_ko, season: c.season }));

// 밝은별(고유명) → 별자리 매핑
// 각 별자리 객체의 stars: ["알페라츠","미라", ...] 를 사용
const starPairs = [];
for (const c of constellations) {
  if (!c || !c.name_ko || !Array.isArray(c.stars)) continue;
  for (const s of c.stars) {
    if (typeof s === "string" && s.trim()) {
      starPairs.push({ star: s.trim(), constellation: c.name_ko });
    }
  }
}

// 반구 뱅크(북/남/적도권 등을 '북반구'/'남반구' 2지선다로 단순화)
const hemisphereBank = constellations
  .filter(c => c && c.name_ko && c.hemisphere)
  .map(c => {
    let hemi = c.hemisphere;
    // 값 표준화
    if (/남/.test(hemi)) hemi = "남반구";
    else hemi = "북반구";
    return { name_ko: c.name_ko, hemisphere: hemi };
  });

// ========= 2) 태양계 데이터 로드 =========
// 기대 구조: { sun, eclipses[], planets[], moons[], ... }
const S = safeLoadJSON("solar_system.json", false);
const sol = S.data || {};
console.log(`[boot] solar_system loaded: ${S.ok ? "OK" : "FAIL"} from ${S.path}`);

let planets = Array.isArray(sol.planets) ? sol.planets : [];
let moons   = Array.isArray(sol.moons)   ? sol.moons   : [];
let eclipses= Array.isArray(sol.eclipses)? sol.eclipses: [];
const sunInfo = sol.sun || null;

// fallback (혹시 planets가 비면 8행성 기본 주입)
if (!planets.length) {
  console.warn("[boot] planets empty → fallback 8 planets");
  planets = [
    { name_ko:"수성", type:"지구형", orbit_order:1 },
    { name_ko:"금성", type:"지구형", orbit_order:2 },
    { name_ko:"지구", type:"지구형", orbit_order:3 },
    { name_ko:"화성", type:"지구형", orbit_order:4 },
    { name_ko:"목성", type:"가스형", orbit_order:5 },
    { name_ko:"토성", type:"가스형", orbit_order:6 },
    { name_ko:"천왕성", type:"얼음형", orbit_order:7 },
    { name_ko:"해왕성", type:"얼음형", orbit_order:8 },
  ];
}
const orderMap = { "수성":1,"금성":2,"지구":3,"화성":4,"목성":5,"토성":6,"천왕성":7,"해왕성":8 };
const innerSet = new Set(["수성","금성","지구","화성"]);
const outerGas = new Set(["목성","토성"]);
const outerIce = new Set(["천왕성","해왕성"]);

planets = planets.map(p => ({
  ...p,
  orbit_order: typeof p.orbit_order === "number" ? p.orbit_order : (orderMap[p.name_ko] || null),
  type: p.type || (innerSet.has(p.name_ko) ? "지구형" : outerGas.has(p.name_ko) ? "가스형" : "얼음형")
}));

if (!moons.length) moons = [{ name_ko: "달", planet: "지구" }];

// ========= 3) 사진 퀴즈용 로컬 이미지 스캔 =========
// 경로: public/images/planets
const IMAGE_DIR = path.join(__dirname, "public", "images", "planets");
const ALLOWED_EXT = new Set([".jpg",".jpeg",".png",".webp",".svg"]);

// 파일명 → 한글명/분류 매핑 (사진 퀴즈 표기용)
const NAME_MAP = {
  mercury:{ ko:"수성", type:"행성" }, venus:{ ko:"금성", type:"행성" }, earth:{ ko:"지구", type:"행성" }, mars:{ ko:"화성", type:"행성" },
  jupiter:{ ko:"목성", type:"행성" }, saturn:{ ko:"토성", type:"행성" }, uranus:{ ko:"천왕성", type:"행성" }, neptune:{ ko:"해왕성", type:"행성" },
  sun:{ ko:"태양", type:"항성" }, moon:{ ko:"달", type:"위성" }, pluto:{ ko:"명왕성", type:"왜소행성" }, comet:{ ko:"혜성", type:"소천체" }
};

function scanBodyImages() {
  let files = [];
  try {
    files = fs.readdirSync(IMAGE_DIR, { withFileTypes: true })
      .filter(d => d.isFile()).map(d => d.name);
  } catch (e) {
    console.warn("[boot] cannot read images:", IMAGE_DIR, e.message);
  }
  const arr = [];
  for (const filename of files) {
    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) continue;
    const slug = path.basename(filename, ext).toLowerCase();
    if (!NAME_MAP[slug]) continue;
    const { ko, type } = NAME_MAP[slug];
    arr.push({ slug, name_ko: ko, type, image: `/public/images/planets/${filename}` });
  }
  return arr;
}
let BODY_BANK = scanBodyImages();
console.log(`[boot] local bodies(images): ${BODY_BANK.length}개 from ${IMAGE_DIR}`);

// ========= 4) 문제 생성기 =========
function makeSeasonQuiz() {
  if (!seasonBank.length) return null;
  const item = seasonBank[rand(seasonBank.length)];
  const seasons = ["봄","여름","가을","겨울"];
  let choices = shuffle(seasons);
  const answerIndex = choices.indexOf(item.season);
  if (answerIndex === -1) {
    choices[0] = item.season;
  }
  return {
    category: "season",
    question: `Q) 「${item.name_ko}」는 북반구 기준 어떤 계절의 별자리일까요?`,
    choices: choices,
    answerIndex: choices.indexOf(item.season),
    explanation: `${item.name_ko}는(은) ${item.season}철 대표 별자리입니다.`
  };
}

function makeStarQuiz() {
  if (!starPairs.length) return null;
  const pick = starPairs[rand(starPairs.length)];
  // 보기: 해당 별자리를 정답으로, 다른 별자리 3개
  let pool = shuffle(constellations.map(c => c.name_ko).filter(n => n !== pick.constellation)).slice(0,3);
  pool.push(pick.constellation);
  pool = shuffle(pool);
  return {
    category: "star",
    question: `Q) 「${pick.star}」는(은) 어느 별자리에 속할까요?`,
    choices: pool,
    answerIndex: pool.indexOf(pick.constellation),
    explanation: `「${pick.star}」는(은) ${pick.constellation}에 속합니다.`
  };
}

function makeHemisphereQuiz() {
  if (!hemisphereBank.length) return null;
  const item = hemisphereBank[rand(hemisphereBank.length)];
  const choices = ["북반구","남반구"]; // 2지선다
  return {
    category: "hemisphere",
    question: `Q) 「${item.name_ko}」는 주로 어느 반구의 별자리일까요?`,
    choices,
    answerIndex: choices.indexOf(item.hemisphere),
    explanation: `${item.name_ko}는(은) ${item.hemisphere} 하늘에서 잘 보입니다.`
  };
}

// 태양계(달 포함) 퀴즈 묶음
function makeSolarQuiz() {
  const types = ["planet-img","type","orbit","inner-outer","moon-belongs","sun-what","eclipse-order"];
  const t = types[rand(types.length)];

  // 1) 행성 사진 맞추기 (solar에서도 조금 섞어서 출제)
  if (t === "planet-img" && BODY_BANK.length) {
    // 행성/태양/달 등 포함. 행성 위주로 뽑고 싶으면 filter로 type==='행성' 우선
    const correctIdx = rand(BODY_BANK.length);
    const correct = BODY_BANK[correctIdx];
    // 보기 4개 구성
    const sameType = BODY_BANK.filter((b,i)=>i!==correctIdx && b.type===correct.type);
    const others   = BODY_BANK.filter((b,i)=>i!==correctIdx && b.type!==correct.type);
    let picks = shuffle(sameType).slice(0,3);
    if (picks.length<3) picks = picks.concat(shuffle(others).slice(0, 3-picks.length));
    const choiceObjs = shuffle([correct, ...picks].slice(0,4));
    const choices = choiceObjs.map(x=>x.name_ko);
    return {
      category:"solar",
      question:"Q) 이 사진의 천체는 무엇일까요?",
      choices,
      answerIndex: choices.indexOf(correct.name_ko),
      explanation: `${correct.name_ko} (${correct.type}) 입니다.`,
      image: correct.image,
      credit: "이미지: 로컬 에셋 (사용자 제공)"
    };
  }

  // 2) 행성 분류(지구형/가스형/얼음형)
  if (t === "type" && planets.length >= 2) {
    const p = planets[rand(planets.length)];
    const kinds = ["지구형","가스형","얼음형"];
    const choices = shuffle(kinds);
    return {
      category:"solar",
      question:`Q) 「${p.name_ko}」는(은) 어떤 분류의 행성일까요?`,
      choices,
      answerIndex: choices.indexOf(p.type),
      explanation: `${p.name_ko}는(은) ${p.type} 행성입니다.`
    };
  }

  // 3) 공전 순서(태양으로부터 n번째)
  if (t === "orbit" && planets.some(p=>p.orbit_order)) {
    const p = planets.filter(x=>x.orbit_order)[rand(planets.filter(x=>x.orbit_order).length)];
    const all = planets.filter(x=>x.orbit_order).map(x=>x.orbit_order);
    const distractors = shuffle([...new Set(all.filter(n=>n!==p.orbit_order))]).slice(0,3);
    const choices = shuffle([p.orbit_order, ...distractors]).map(n=>`${n}번째`);
    return {
      category:"solar",
      question:`Q) 「${p.name_ko}」는(은) 태양에서 몇 번째 행성일까요?`,
      choices,
      answerIndex: choices.indexOf(`${p.orbit_order}번째`),
      explanation: `${p.name_ko}는(은) 태양에서 ${p.orbit_order}번째 행성입니다.`
    };
  }

  // 4) 내행성/외행성 구분
  if (t === "inner-outer" && planets.length) {
    const p = planets[rand(planets.length)];
    const cls = (innerSet.has(p.name_ko) ? "내행성" : "외행성");
    const choices = ["내행성","외행성"];
    return {
      category:"solar",
      question:`Q) 「${p.name_ko}」는(은) 내행성일까요, 외행성일까요?`,
      choices,
      answerIndex: choices.indexOf(cls),
      explanation: `${p.name_ko}는(은) ${cls}입니다.`
    };
  }

  // 5) 위성 소속 (달 포함)
  if (t === "moon-belongs" && moons.length >= 1) {
    const m = moons[rand(moons.length)];
    // 보기 행성 4개
    const planetNames = [...new Set(planets.map(p=>p.name_ko))];
    let choices = shuffle(planetNames).slice(0,3);
    if (!choices.includes(m.planet)) choices.push(m.planet);
    choices = shuffle(choices).slice(0,4);
    return {
      category:"solar",
      question:`Q) 「${m.name_ko}」는(은) 어느 행성의 위성일까요?`,
      choices,
      answerIndex: choices.indexOf(m.planet),
      explanation: `${m.name_ko}는(은) ${m.planet}의 위성입니다.`
    };
  }

  // 6) 태양은 무엇인가요?
  if (t === "sun-what") {
    const choices = ["항성","행성","위성","왜소행성"];
    return {
      category:"solar",
      question:"Q) 태양은 무엇인가요?",
      choices,
      answerIndex: choices.indexOf("항성"),
      explanation:"태양은 태양계의 중심 항성입니다."
    };
  }

  // 7) 식(일식/월식) 배치
  if (t === "eclipse-order" && eclipses.length) {
    const e = eclipses[rand(eclipses.length)];
    const correct = e.order.join(" → ");
    const other = eclipses.filter(x=>x!==e).map(x=>x.order.join(" → "));
    let choices = shuffle([correct, ...other]).slice(0,4);
    // 보기가 2개뿐이면 보충
    if (choices.length < 4) {
      const fillers = ["태양 → 달 → 지구","달 → 지구 → 태양","지구 → 달 → 태양","달 → 태양 → 지구"];
      for (const f of fillers) if (!choices.includes(f)) choices.push(f);
      choices = choices.slice(0,4);
    }
    return {
      category:"solar",
      question:`Q) ${e.type}의 천체 배치는 어떻게 될까요?`,
      choices,
      answerIndex: choices.indexOf(correct),
      explanation:`${e.type}은(는) 「${correct}」 순서로 일어납니다.`
    };
  }

  return null;
}

// 사진 전용(천체 사진 모드)
function makePhotoQuiz() {
  if (!BODY_BANK.length) return null;
  const correctIdx = rand(BODY_BANK.length);
  const correct = BODY_BANK[correctIdx];

  // 보기 4개 구성
  const sameType = BODY_BANK.filter((b,i)=>i!==correctIdx && b.type===correct.type);
  const others   = BODY_BANK.filter((b,i)=>i!==correctIdx && b.type!==correct.type);
  let picks = shuffle(sameType).slice(0,3);
  if (picks.length<3) picks = picks.concat(shuffle(others).slice(0, 3-picks.length));
  const choiceObjs = shuffle([correct, ...picks].slice(0,4));
  const choices = choiceObjs.map(x=>x.name_ko);

  return {
    category:"photo",
    question:"Q) 다음 사진의 천체는 무엇일까요?",
    choices,
    answerIndex: choices.indexOf(correct.name_ko),
    explanation: `${correct.name_ko} (${correct.type}) 입니다.`,
    image: correct.image,
    credit: "이미지: 로컬 에셋 (사용자 제공)"
  };
}

// ========= 5) 디버그 =========
app.get("/debug", (_, res) => {
  res.json({
    constellations_count: constellations.length,
    seasonBank_count: seasonBank.length,
    starPairs_count: starPairs.length,
    hemisphereBank_count: hemisphereBank.length,
    planets_count: planets.length,
    moons_count: moons.length,
    eclipses_count: eclipses.length,
    bodies_found: BODY_BANK.length,
    samples: {
      constellation: constellations[0],
      starPair: starPairs[0],
      solar_planet: planets[0],
      moon: moons[0],
      eclipse: eclipses[0],
      body: BODY_BANK[0]
    }
  });
});

// ========= 6) /chat =========
app.post("/chat", (req, res) => {
  try {
    const mode = req.body?.mode || "random";
    const pickers = {
      season: makeSeasonQuiz,
      star: makeStarQuiz,
      hemisphere: makeHemisphereQuiz,
      solar: makeSolarQuiz,
      photo: makePhotoQuiz
    };

    let quiz = pickers[mode] ? pickers[mode]() : null;

    // 랜덤 모드: 가능한 것 중 하나 섞기
    if (mode === "random" || !quiz) {
      const order = shuffle([
        makeSeasonQuiz,
        makeStarQuiz,
        makeHemisphereQuiz,
        makeSolarQuiz,
        makePhotoQuiz
      ]);
      for (const fn of order) {
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

// ========= 서버 시작 =========
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Quiz server running on port ${PORT}`);
  console.log(`➡️  Health: GET /health | Debug: GET /debug | Quiz: POST /chat (modes: season, star, hemisphere, solar, photo, random)`);
});
