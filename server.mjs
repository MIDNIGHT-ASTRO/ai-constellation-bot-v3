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
app.use(express.static(path.join(__dirname, "public")));

// ------------------ 데이터 로딩 ------------------ //
let constellations = [];
let solarData = {};
let bodyBank = [];

try {
  constellations = JSON.parse(fs.readFileSync(path.join(__dirname, "constellations_88_ko_named.json"), "utf-8"));
} catch (e) {
  console.error("[boot] constellations JSON load failed:", e);
}

try {
  solarData = JSON.parse(fs.readFileSync(path.join(__dirname, "solar_system.json"), "utf-8"));
} catch (e) {
  console.error("[boot] solar_system JSON load failed:", e);
}

// 행성 이미지 폴더 로드
const IMAGE_DIR = path.join(__dirname, "public", "images", "planets");
if (fs.existsSync(IMAGE_DIR)) {
  bodyBank = fs.readdirSync(IMAGE_DIR)
    .filter(f => /\.(jpg|jpeg|png|webp|svg)$/i.test(f))
    .map(f => {
      const slug = path.basename(f, path.extname(f)).toLowerCase();
      return { slug, file: `/images/planets/${f}` };
    });
  console.log(`[boot] planet photos loaded: ${bodyBank.length}개`);
}

// ------------------ 문제 생성기 ------------------ //

// 계절 별자리 (4지선다)
function makeSeasonQuiz() {
  if (!constellations.length) return null;
  const target = constellations[Math.floor(Math.random() * constellations.length)];
  const correct = target.season;
  const seasons = ["봄","여름","가을","겨울"];
  return {
    category: "constellation",
    question: `Q) ${target.name_ko}는 어느 계절의 별자리일까요?`,
    choices: seasons,
    answerIndex: seasons.indexOf(correct),
    explanation: `${target.name_ko}는 ${correct}철 별자리입니다.`
  };
}

// 반구 구분 (2지선다)
function makeHemisphereQuiz() {
  if (!constellations.length) return null;
  const target = constellations[Math.floor(Math.random() * constellations.length)];
  const hemis = ["북반구","남반구"];
  return {
    category: "constellation",
    question: `Q) ${target.name_ko}는 어느 반구에서 주로 보일까요?`,
    choices: hemis,
    answerIndex: hemis.indexOf(target.hemisphere),
    explanation: `${target.name_ko}는 ${target.hemisphere} 별자리입니다.`
  };
}

// 별자리 성도 이미지 맞추기 (4지선다)
function makeImageQuiz() {
  const dir = path.join(__dirname, "public", "images", "constellations_iau");
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".svg"));
  if (!files.length) return null;

  const pick = files[Math.floor(Math.random() * files.length)];
  const name = path.basename(pick, ".svg");

  // 보기 랜덤 4개
  const options = [name];
  while (options.length < 4) {
    const rnd = path.basename(files[Math.floor(Math.random() * files.length)], ".svg");
    if (!options.includes(rnd)) options.push(rnd);
  }
  options.sort(() => Math.random() - 0.5);

  return {
    category: "image",
    question: "Q) 이 성도(星圖)는 어떤 별자리일까요?",
    image: `/images/constellations_iau/${pick}`,
    image_credit: "IAU 공식 성도(CC BY 4.0)",
    choices: options,
    answerIndex: options.indexOf(name),
    explanation: `이 성도는 ${name} 별자리입니다.`
  };
}

// 태양계/달 문제 (텍스트형 + 사진형)
function makeSolarQuiz() {
  const candidates = [];

  // 태양: 본질
  candidates.push({
    question: "Q) 태양은 무엇인가요?",
    choices: ["항성","행성","위성","왜소행성"],
    answerIndex: 0,
    explanation: "태양은 태양계의 중심 항성입니다."
  });

  // 행성 분류
  const planet = solarData.planets[Math.floor(Math.random()*solarData.planets.length)];
  candidates.push({
    question: `Q) ${planet.name_ko}는 어떤 유형의 행성인가요?`,
    choices: ["지구형","가스형","얼음형"],
    answerIndex: ["지구형","가스형","얼음형"].indexOf(planet.type),
    explanation: `${planet.name_ko}는 ${planet.type} 행성입니다.`
  });

  // 식 배치
  const ecl = solarData.eclipses[Math.floor(Math.random()*solarData.eclipses.length)];
  candidates.push({
    question: `Q) ${ecl.type}이(가) 일어날 때 천체 배치는 어떻게 될까요?`,
    choices: solarData.eclipses.map(e=>e.order.join(" → ")),
    answerIndex: solarData.eclipses.indexOf(ecl),
    explanation: `${ecl.type}: ${ecl.desc}`
  });

  // 행성 이미지
  if (bodyBank.length) {
    const body = bodyBank[Math.floor(Math.random()*bodyBank.length)];
    const others = bodyBank.filter(b => b.slug !== body.slug);
    const wrong = others.sort(()=>Math.random()-0.5).slice(0,3).map(b=>b.slug);
    const options = [body.slug,...wrong].sort(()=>Math.random()-0.5);
    candidates.push({
      question: "Q) 아래 사진은 어떤 천체일까요?",
      image: body.file,
      image_credit: "Image: NASA (Public Domain)",
      choices: options,
      answerIndex: options.indexOf(body.slug),
      explanation: `${body.slug}의 사진입니다.`
    });
  }

  return candidates[Math.floor(Math.random()*candidates.length)];
}

// ------------------ 라우트 ------------------ //
app.get("/health",(req,res)=>res.json({ok:true}));

app.get("/debug",(req,res)=>{
  res.json({
    constellations_count: constellations.length,
    solar_planets: solarData.planets?.length,
    bodies_found: bodyBank.length
  });
});

app.post("/chat",(req,res)=>{
  try {
    const mode = req.body?.mode || "random";
    let quiz = null;

    if (mode==="random") {
      const pool = [makeSeasonQuiz,makeHemisphereQuiz,makeImageQuiz,makeSolarQuiz];
      quiz = pool[Math.floor(Math.random()*pool.length)]();
    } else if (mode==="constellation") {
      quiz = Math.random()<0.5 ? makeSeasonQuiz() : makeHemisphereQuiz();
    } else if (mode==="image") {
      quiz = makeImageQuiz();
    } else if (mode==="solar") {
      quiz = makeSolarQuiz();
    }

    if (!quiz) return res.status(500).json({error:"NO_QUIZ"});
    return res.json({type:"quiz",data:quiz});
  } catch (e) {
    console.error(e);
    res.status(500).json({error:"SERVER_ERR",message:String(e)});
  }
});

// ------------------ 시작 ------------------ //
app.listen(PORT,"0.0.0.0",()=>{
  console.log(`✅ Quiz server on :${PORT}`);
});
