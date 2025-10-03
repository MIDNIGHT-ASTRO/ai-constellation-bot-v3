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

// ===== index.html 캐시 없이 서빙 =====
app.get("/", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.sendFile(path.join(__dirname, "index.html"));
});

// 정적 파일 (public/*) 은 캐시 허용
app.use("/public", express.static(path.join(__dirname, "public"), {
  maxAge: "7d",
  etag: true
}));

// 헬스체크
app.get("/health", (req, res) => res.json({ ok: true }));

// ===== 유틸 =====
const rand = n => Math.floor(Math.random() * n);
const shuffle = arr => arr.slice().sort(() => Math.random() - 0.5);

// ===== 천체 이미지 스캔 (경로: public/images/planets) =====
// 파일명(확장자 제외) → 한글명/분류 매핑
const NAME_MAP = {
  mercury: { ko: "수성",   type: "행성" },
  venus:   { ko: "금성",   type: "행성" },
  earth:   { ko: "지구",   type: "행성" },
  mars:    { ko: "화성",   type: "행성" },
  jupiter: { ko: "목성",   type: "행성" },
  saturn:  { ko: "토성",   type: "행성" },
  uranus:  { ko: "천왕성", type: "행성" },
  neptune: { ko: "해왕성", type: "행성" },
  sun:     { ko: "태양",   type: "항성" },
  moon:    { ko: "달",     type: "위성" },
  pluto:   { ko: "명왕성", type: "왜소행성" },
  comet:   { ko: "혜성",   type: "소천체" }
};

const IMAGE_DIR = path.join(__dirname, "public", "images", "planets"); // ✅ 여기!
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".svg"]);

function scanBodyImages() {
  let files = [];
  try {
    files = fs.readdirSync(IMAGE_DIR, { withFileTypes: true })
      .filter(d => d.isFile())
      .map(d => d.name);
  } catch (e) {
    console.warn("[boot] 이미지 폴더를 읽을 수 없습니다:", IMAGE_DIR, e.message);
    files = [];
  }

  const bodies = [];
  for (const filename of files) {
    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) continue;
    const slug = path.basename(filename, ext).toLowerCase(); // 대소문자 방어
    if (!NAME_MAP[slug]) continue; // 미지원 파일명은 스킵
    const { ko, type } = NAME_MAP[slug];
    bodies.push({
      slug,
      name_ko: ko,
      type, // '행성', '항성', '위성', '왜소행성', '소천체'
      image: `/public/images/planets/${filename}` // ✅ 여기!
    });
  }
  return bodies;
}

let BODY_BANK = scanBodyImages();
console.log(`[boot] 발견한 천체 이미지: ${BODY_BANK.length}개 (경로: ${IMAGE_DIR})`);
if (BODY_BANK.length) {
  console.log("[boot] 샘플:", BODY_BANK.slice(0, 5));
}

// ===== 사진 퀴즈 생성 =====
// 정답과 같은 분류(type)에서 우선 오답을 뽑고, 부족하면 다른 분류에서 보충
function buildChoices(correctIdx) {
  const correct = BODY_BANK[correctIdx];
  const sameType = BODY_BANK
    .map((b, i) => ({ ...b, i }))
    .filter(x => x.i !== correctIdx && x.type === correct.type);
  const others = BODY_BANK
    .map((b, i) => ({ ...b, i }))
    .filter(x => x.i !== correctIdx && x.type !== correct.type);

  const picks = [];
  shuffle(sameType).slice(0, 3).forEach(x => picks.push(x));
  if (picks.length < 3) {
    shuffle(others).slice(0, 3 - picks.length).forEach(x => picks.push(x));
  }
  if (picks.length < 3) {
    const rest = BODY_BANK
      .map((b, i) => ({ ...b, i }))
      .filter(x => x.i !== correctIdx && !picks.find(p => p.i === x.i));
    shuffle(rest).slice(0, 3 - picks.length).forEach(x => picks.push(x));
  }

  const choiceObjs = shuffle([{ ...correct, i: correctIdx }, ...picks].slice(0, 4));
  const choices = choiceObjs.map(x => x.name_ko);
  const answerIndex = choiceObjs.findIndex(x => x.i === correctIdx);
  return { choices, answerIndex };
}

function makePhotoQuiz() {
  if (!BODY_BANK.length) return null;
  const correctIdx = rand(BODY_BANK.length);
  const correct = BODY_BANK[correctIdx];
  const { choices, answerIndex } = buildChoices(correctIdx);

  // 방어: choice가 2개 미만이면 무효(최소 2지선다)
  if (!Array.isArray(choices) || choices.length < 2 || answerIndex < 0) return null;

  return {
    category: "photo",
    question: "Q) 다음 사진의 천체는 무엇일까요?",
    choices,
    answerIndex,
    explanation: `${correct.name_ko} (${correct.type}) 입니다.`,
    image: correct.image,
    credit: "이미지: 로컬 에셋 (사용자 제공)"
  };
}

// ===== 디버그 =====
app.get("/debug", (req, res) => {
  res.json({
    image_dir: IMAGE_DIR,
    bodies_found: BODY_BANK.length,
    samples: BODY_BANK.slice(0, 8)
  });
});

// ===== /chat API =====
app.post("/chat", (req, res) => {
  try {
    const mode = req.body?.mode || "photo"; // 기본 photo
    let quiz = null;

    if (mode === "photo") {
      quiz = makePhotoQuiz();
    } else {
      // 다른 모드가 아직 필요 없으면 photo로 폴백
      quiz = makePhotoQuiz();
    }

    if (!quiz || !Array.isArray(quiz.choices) || typeof quiz.answerIndex !== "number") {
      console.error("[/chat] INVALID_QUIZ_PAYLOAD", { hasQuiz: !!quiz });
      return res.status(500).json({ error: "INVALID_QUIZ_PAYLOAD" });
    }
    return res.json({ type: "quiz", data: quiz });
  } catch (e) {
    console.error("[/chat] error:", e);
    return res.status(500).json({ error: "QUIZ_SERVER_ERROR", message: String(e) });
  }
});

// 서버 시작
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Quiz server running on port ${PORT}`);
  console.log(`➡️  Health: GET /health  |  Debug: GET /debug  |  Quiz: POST /chat (mode: "photo")`);
});
