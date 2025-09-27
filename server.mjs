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

// ------------------ 데이터 로드 ------------------ //
function loadJSON(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, file), "utf-8"));
}

const constellations = loadJSON("constellations_88_ko_named.json"); // 88개 별자리
const solarSystem = loadJSON("solar_system.json"); // 태양계/달 문제

// ------------------ 퀴즈 생성기 ------------------ //

// 랜덤 퀴즈 하나 선택
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// 계절 퀴즈 (북반구 기준, 남반구 별자리는 제외)
function makeSeasonQuiz() {
  const northern = constellations.filter(c => c.hemisphere === "북반구");
  const c = pickRandom(northern);
  const seasons = ["봄", "여름", "가을", "겨울"];
  return {
    question: `Q) ${c.name_ko}는 북반구 기준 어떤 계절의 별자리일까요?`,
    choices: seasons,
    answerIndex: seasons.indexOf(c.season),
    explanation: `${c.name_ko}는 ${c.season}철에 잘 보이는 별자리입니다.`,
  };
}

// 밝은 별 → 별자리 맞추기
function makeStarQuiz() {
  const withStars = constellations.filter(c => c.stars && c.stars.length > 0);
  const c = pickRandom(withStars);
  const star = pickRandom(c.stars);
  const wrongs = constellations
    .filter(x => x.name_ko !== c.name_ko)
    .slice(0, 3)
    .map(x => x.name_ko);
  const options = [c.name_ko, ...wrongs].sort(() => Math.random() - 0.5);
  return {
    question: `Q) '${star}' 별은 어느 별자리에 속해 있을까요?`,
    choices: options,
    answerIndex: options.indexOf(c.name_ko),
    explanation: `${star}는 ${c.name_ko}에 속한 별입니다.`,
  };
}

// 북/남반구 구분 퀴즈 (2지선다)
function makeHemisphereQuiz() {
  const c = pickRandom(constellations);
  const options = ["북반구", "남반구"];
  return {
    question: `Q) ${c.name_ko}는 주로 어느 반구에서 잘 보일까요?`,
    choices: options,
    answerIndex: options.indexOf(c.hemisphere),
    explanation: `${c.name_ko}는 ${c.hemisphere} 별자리입니다.`,
  };
}

// 태양계 퀴즈
function makeSolarQuiz() {
  return pickRandom(solarSystem);
}

// 성도(이미지) 맞추기 퀴즈
function makeImageQuiz() {
  const c = pickRandom(constellations);
  const imagePath = `/public/images/constellations_iau/${c.name_en.toLowerCase()}.svg`;

  // 오답 3개 뽑기
  const wrongs = constellations
    .filter(x => x.name_ko !== c.name_ko)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3)
    .map(x => x.name_ko);

  const options = [c.name_ko, ...wrongs].sort(() => Math.random() - 0.5);

  return {
    question: "Q) 다음 성도 이미지는 어떤 별자리일까요?",
    choices: options,
    answerIndex: options.indexOf(c.name_ko),
    explanation: `이 성도는 ${c.name_ko}(${c.name_en}) 자리입니다.`,
    image: imagePath,
  };
}

// 달 퀴즈 (solar_system.json 안에 포함됨)
function makeLunarQuiz() {
  const lunar = solarSystem.filter(q => q.category === "moon");
  return pickRandom(lunar);
}

// ------------------ 라우팅 ------------------ //

app.use("/public", express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/chat", (req, res) => {
  const mode = req.body.mode || "random";
  let quiz;

  if (mode === "season") quiz = makeSeasonQuiz();
  else if (mode === "star") quiz = makeStarQuiz();
  else if (mode === "hemisphere") quiz = makeHemisphereQuiz();
  else if (mode === "solar") quiz = makeSolarQuiz();
  else if (mode === "lunar") quiz = makeLunarQuiz();
  else if (mode === "image") quiz = makeImageQuiz();
  else {
    // 랜덤 모드 → 모든 유형 섞어서
    const fns = [
      makeSeasonQuiz,
      makeStarQuiz,
      makeHemisphereQuiz,
      makeSolarQuiz,
      makeLunarQuiz,
      makeImageQuiz,
    ];
    quiz = pickRandom(fns)();
  }

  res.json({ type: "quiz", data: quiz });
});

// ------------------ 서버 시작 ------------------ //
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Quiz server running on port ${PORT}`);
});
