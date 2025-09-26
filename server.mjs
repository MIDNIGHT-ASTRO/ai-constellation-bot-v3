// server.mjs
// 실행: npm i && node server.mjs
import express from 'express';
import bodyParser from 'body-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.use(bodyParser.json());

// 정적 서빙: 프로젝트 루트 + public 폴더
app.use(express.static(__dirname));
app.use('/public', express.static(path.join(__dirname, 'public')));

// ===== 헬스체크 =====
app.get('/health', (req,res) => res.json({ ok:true, ts: Date.now() }));

// ===== 콘솔 로깅(문제 추적) =====
app.use((req,res,next)=>{
  if (req.path === '/chat') {
    console.log(`[CHAT] ${new Date().toISOString()} ${req.method} body=`, req.body);
  }
  next();
});

// --------- 유틸 ---------
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (a) => a.slice().sort(() => Math.random() - 0.5);

// ===== 별 고유명 한글화(핵심) =====
const STAR_NAME_KO = {
  'betelgeuse':'베텔게우스','rigel':'리겔','bellatrix':'벨라트릭스',
  'sirius':'시리우스','procyon':'프로키온','vega':'베가','deneb':'데네브','altair':'알타이르',
  'arcturus':'아크투루스','spica':'스피카','capella':'카펠라',
  'castor':'카스토르','pollux':'폴룩스','aldebaran':'알데바란','algol':'알골','mirfak':'미르팍',
  'almach':'알마크','alpheratz':'알페라츠','algenib':'알게니브','enif':'애니프',
  'dubhe':'두베','merak':'메라크','phecda':'페크다','megrez':'메그레즈','alioth':'알리오트',
  'mizar':'미자르','alcor':'알코르','alkaid':'알카이드','regulus':'레굴루스','denebola':'데네볼라',
  'antares':'안타레스','mira':'미라','fomalhaut':'포말하우트','polaris':'폴라리스',
  'sadr':'사드르','albireo':'알비레오','dabih':'다비흐','canopus':'카노푸스'
};
const GREEK_LETTER = {
  'α':'alpha','β':'beta','γ':'gamma','δ':'delta','ε':'epsilon','ζ':'zeta','η':'eta','θ':'theta',
  'ι':'iota','κ':'kappa','λ':'lambda','μ':'mu','ν':'nu','ξ':'xi','ο':'omicron','π':'pi',
  'ρ':'rho','σ':'sigma','ς':'sigma','τ':'tau','υ':'upsilon','φ':'phi','χ':'chi','ψ':'psi','ω':'omega'
};
function normalizeKey(s) {
  if (!s) return '';
  let t = String(s).normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[.,]/g, ' ');
  t = t.replace(/[\u0370-\u03FF]/g, ch => GREEK_LETTER[ch] || ch);
  return t.replace(/\s+/g, ' ').trim();
}
function koStarName(starOrName) {
  if (!starOrName) return '';
  if (typeof starOrName === 'object') {
    if (starOrName.name_ko) return starOrName.name_ko;
    const candidates = [starOrName.name, starOrName.proper, starOrName.designation, starOrName.bayer, starOrName.flamsteed].filter(Boolean);
    for (const c of candidates) {
      const key = normalizeKey(c);
      if (STAR_NAME_KO[key]) return STAR_NAME_KO[key];
      if (/mira/.test(key)) return '미라';
    }
    return (starOrName.name || '').toString().trim();
  }
  const key = normalizeKey(starOrName);
  if (STAR_NAME_KO[key]) return STAR_NAME_KO[key];
  if (/mira/.test(key)) return '미라';
  return String(starOrName).trim();
}

// ===== IAU 성도 이미지 파일명/예외 처리 =====
// 저장 규칙: 소문자 + 언더스코어 + (ö -> oe)
// 예: "Boötes" -> bootes.svg
function slugifyNameEnToIAUSlug(nameEn) {
  return String(nameEn || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/ö/g, 'oe');
}
// 절대경로로 파일 존재 확인 (Serpens 예외 포함)
function resolveConstellationImageAbs(nameEn) {
  const base = path.join(__dirname, 'public/images/constellations_iau');
  const slug = slugifyNameEnToIAUSlug(nameEn);
  const primary = path.join(base, `${slug}.svg`);
  if (fs.existsSync(primary)) return primary;

  // Serpens는 Caput/Cauda로 나뉜 업로드가 흔함 → 보조 검색
  if (slug === 'serpens') {
    const caput = path.join(base, 'serpens_caput.svg');
    const cauda = path.join(base, 'serpens_cauda.svg');
    if (fs.existsSync(caput)) return caput;
    if (fs.existsSync(cauda)) return cauda;
  }
  return null;
}
// 클라이언트에서 접근 가능한 URL로 반환
function imageUrlForClientByNameEn(nameEn) {
  const abs = resolveConstellationImageAbs(nameEn);
  if (!abs) return null;
  return '/public/images/constellations_iau/' + path.basename(abs);
}

// --------- 데이터 로드 ---------
let CONSTELLATIONS = [];
try {
  const raw = fs.readFileSync(path.join(__dirname, 'constellations_88_ko_named.json'), 'utf-8');
  const json = JSON.parse(raw);
  if (Array.isArray(json.constellations)) CONSTELLATIONS = json.constellations;
  console.log(`[INIT] constellations loaded: ${CONSTELLATIONS.length}`);
} catch (e) {
  console.warn('[INIT] constellations load failed:', e.message);
}

let SOLAR = { sun:null, eclipses:[], planets:[] };
try {
  const raw = fs.readFileSync(path.join(__dirname, 'solar_system.json'), 'utf-8');
  const json = JSON.parse(raw);
  SOLAR.sun      = json.sun || null;
  SOLAR.eclipses = Array.isArray(json.eclipses)? json.eclipses : [];
  SOLAR.planets  = Array.isArray(json.planets)? json.planets : [];
  console.log(`[INIT] solar loaded: planets=${SOLAR.planets.length} eclipses=${SOLAR.eclipses.length}`);
} catch (e) {
  console.warn('[INIT] solar load failed:', e.message);
}

// --------- 보조 ---------
function ensureChoices(choices, correctLabel, targetN=4){
  let out = Array.isArray(choices) ? choices.slice(0) : [];
  if (out.length === 0 && correctLabel) out = [correctLabel];
  const fillers = ['봄','여름','가을','겨울','연중'];
  const used = new Set(out);
  while (out.length < targetN) {
    const x = pick(fillers);
    if (!used.has(x)) { out.push(x); used.add(x); }
  }
  if (out.length > targetN) out = out.slice(0, targetN);
  const idx = out.indexOf(correctLabel);
  return { choices: out, answerIndex: (idx>=0? idx : 0) };
}

// --------- 계절 로테이션 ---------
const K2L = {spring:'봄',summer:'여름',autumn:'가을',winter:'겨울','year-round':'연중'};
function normalizeSeason(c){ const out={...c}; if(!out.best_season_northern) out.best_season_northern='year-round'; return out; }
let SEASON_ROTATION = [];
function refillSeasonRotation() {
  const pool = CONSTELLATIONS.filter(c => c.hemisphere !== 'S').map(normalizeSeason);
  SEASON_ROTATION = shuffle(pool);
}
function nextSeasonConstellation() {
  if (!SEASON_ROTATION.length) refillSeasonRotation();
  return SEASON_ROTATION.shift();
}

// --------- 퀴즈 빌더 ---------
function makeSeasonQuiz(){
  const c = nextSeasonConstellation();
  if (!c) return { question:'계절 데이터가 부족합니다.', choices:['봄','여름','가을','겨울'], answerIndex:0, explanation:'JSON 필요' };
  const correctKey = c.best_season_northern;
  const seasons = ['spring','summer','autumn','winter'];
  const set = new Set([correctKey]);
  while (set.size<4) set.add(pick(seasons));
  const arr = Array.from(set);
  const choices = arr.map(k=>K2L[k]||k);
  return { question: `${c.name_ko || c.name_en}는 북반구 기준 어떤 계절의 별자리일까요?`,
           choices, answerIndex: arr.indexOf(correctKey), explanation: `${c.name_ko || c.name_en} → ${K2L[correctKey]}` };
}
function makeStarQuiz(){
  const pool = CONSTELLATIONS.filter(c => Array.isArray(c.notable_stars) && c.notable_stars.length>0);
  if (!pool.length) return { question:'별 소속 데이터가 부족합니다.', choices:['A','B','C','D'], answerIndex:0, explanation:'JSON 필요' };
  const c = pick(pool);
  const star = pick(c.notable_stars);
  const correct = c.name_ko || c.name_en;
  const names = pool.map(x=>x.name_ko || x.name_en);
  const used = new Set([correct]);
  const choices = [correct];
  while (choices.length<4){ const v = pick(names); if (!used.has(v)){ choices.push(v); used.add(v);} }
  const final = shuffle(choices);
  const starKo = koStarName(star);
  return { question: `${starKo}는 어느 별자리에 속하나요?`, choices: final, answerIndex: final.indexOf(correct), explanation: `${starKo} → ${correct}` };
}
function makeHemisphereQuiz(){
  const list = CONSTELLATIONS.length? CONSTELLATIONS : [{name_ko:'큰곰자리',hemisphere:'N'},{name_ko:'남십자자리',hemisphere:'S'}];
  const c = pick(list);
  const correct = c.hemisphere === 'S' ? '남반구' : '북반구';
  const choices = Math.random()<0.5 ? ['북반구','남반구'] : ['남반구','북반구'];
  return { question: `${c.name_ko || c.name_en}는 어느 반구에서 주로 보일까요?`, choices, answerIndex: choices.indexOf(correct), explanation: `${c.name_ko || c.name_en} → ${correct} 별자리` };
}

// ★ 성도(IAU 차트 이미지) 4지선다 퀴즈 (예외 파일명 자동 처리)
function makeConstellationImageQuiz(){
  const pool = (CONSTELLATIONS || []).filter(c => imageUrlForClientByNameEn(c.name_en));
  if (!pool.length) {
    return { question:'성도 이미지가 아직 준비되지 않았습니다.', choices:['데이터 보강 필요'], answerIndex:0, explanation:'download_iau_svgs.sh 실행 후 새로고침' };
  }
  const c = pick(pool);
  const correct = c.name_ko || c.name_en;
  const imageUrl = imageUrlForClientByNameEn(c.name_en);

  const names = pool.map(x => x.name_ko || x.name_en);
  const used = new Set([correct]);
  const choices = [correct];
  while (choices.length < 4) {
    const v = pick(names);
    if (!used.has(v)) { choices.push(v); used.add(v); }
  }
  const final = shuffle(choices);

  return {
    question: '다음 중 이 별자리는 무엇일까요?',
    image: imageUrl,
    choices: final,
    answerIndex: final.indexOf(correct),
    explanation: `정답: ${correct}`
  };
}

// 태양계(간단형)
function makeSolarType1_planetType(){
  const P = SOLAR.planets || [];
  if (!P.length) return {question:'태양계 데이터 없음',choices:[''],answerIndex:0,explanation:'solar_system.json 필요'};
  const p = pick(P);
  const correct = p.type;
  const choices = shuffle(['지구형','가스형','얼음형','왜소행성']);
  return { question:`태양계의 ${p.name_ko}는 어떤 종류의 천체일까요?`, choices, answerIndex: choices.indexOf(correct), explanation:`${p.name_ko} → ${correct}` };
}
function makeSolarType2_orbitOrder(){
  const P = SOLAR.planets || [];
  if (!P.length) return {question:'태양계 데이터 없음',choices:[''],answerIndex:0,explanation:'solar_system.json 필요'};
  const n = 1+Math.floor(Math.random()*8);
  const item = P.find(x=>x.orbit_order===n) || P[n-1];
  const name = item ? item.name_ko : '지구';
  const names = [...new Set(P.map(p=>p.name_ko))];
  const used = new Set([name]); const choices=[name];
  while(choices.length<4){ const v = pick(names); if(!used.has(v)){choices.push(v); used.add(v);} }
  const final = shuffle(choices);
  return { question:`태양으로부터 ${n}번째 행성은 무엇일까요?`, choices:final, answerIndex: final.indexOf(name), explanation:`${n}번째 → ${name}` };
}
function makeSolarType4_sunIdentity(){
  if (!SOLAR.sun) return {question:'태양 데이터 없음',choices:[''],answerIndex:0,explanation:'solar_system.json 필요'};
  const choices = shuffle(['항성','행성','위성','혜성']);
  return { question:'태양은 무엇인가요?', choices, answerIndex: choices.indexOf('항성'), explanation:'태양은 태양계의 유일한 항성입니다.' };
}
function makeSolarType5_eclipse(){
  const E = SOLAR.eclipses || [];
  if (!E.length) return {question:'식(일식/월식) 데이터 없음',choices:[''],answerIndex:0,explanation:'solar_system.json 필요'};
  const e = pick(E);
  const correct = e.order.join(' - ');
  const variants = shuffle(Array.from(new Set([
    correct, e.order.slice().reverse().join(' - '),
    ['달','태양','지구'].join(' - '), ['지구','달','태양'].join(' - ')
  ]))).slice(0,4);
  return { question:`${e.type}이 일어날 때, 지구·태양·달의 올바른 배치는 무엇일까요?`, choices:variants, answerIndex: variants.indexOf(correct), explanation:`${e.type}: ${correct} (${e.desc})` };
}

// 달(시간대별 ‘볼 수 없는 달의 모습’)
const MOON_PHASE_CHOICES = ['보름달','상현달','초승달','그믐달'];
const MOON_TIME_RULE = { '저녁':'그믐달', '한밤중':'초승달', '새벽':'상현달' };
function makeLunarType1_timeVisibility(){
  const t = pick(Object.keys(MOON_TIME_RULE));
  const correct = MOON_TIME_RULE[t];
  const a = shuffle(MOON_PHASE_CHOICES.slice());
  return { question:`다음 중 ${t} 시간에 볼 수 없는 달의 모습은?`, choices:a, answerIndex:a.indexOf(correct), explanation:`${t}에 보기 어려운 위상 → ${correct}` };
}

// --------- 라우트 ---------
app.post('/chat', (req,res)=>{
  const mode = req.body?.mode || 'random';
  try{
    let q = null;
    if (mode === 'season') q = makeSeasonQuiz();
    else if (mode === 'star') q = makeStarQuiz();
    else if (mode === 'hemisphere') q = makeHemisphereQuiz();
    else if (mode === 'solar') {
      const r = Math.random();
      if (r < 0.25) q = makeSolarType1_planetType();
      else if (r < 0.50) q = makeSolarType2_orbitOrder();
      else if (r < 0.75) q = makeSolarType4_sunIdentity();
      else q = makeSolarType5_eclipse();
    }
    else if (mode === 'lunar') q = makeLunarType1_timeVisibility();
    else if (mode === 'image') q = makeConstellationImageQuiz();
    else if (mode === 'random') {
      const picker = [makeSeasonQuiz, makeStarQuiz, makeHemisphereQuiz, makeSolarType1_planetType, makeLunarType1_timeVisibility, makeConstellationImageQuiz];
      q = pick(picker)();
    }

    if (mode === 'chat'){
      const msg = (req.body?.message || '').trim();
      if (!msg) return res.json({ type:'guide', data:'퀴즈 버튼을 눌러 시작해보세요!' });
      return res.json({ type:'rule', data:'퀴즈 모드에서는 정답 번호 1~N만 적어도 채점돼요.' });
    }

    if (!q) return res.json({ type:'guide', data:'모드를 지정해주세요 (season/star/hemisphere/solar/lunar/image/random).' });

    // ★ 반구 퀴즈는 반드시 2지선다
    const hemiSet = new Set(['북반구','남반구']);
    const looksLikeHemi = Array.isArray(q.choices) && q.choices.length <= 2 && q.choices.every(x => hemiSet.has(x));
    const isHemMode = (mode === 'hemisphere');

    let dataOut;
    if (isHemMode || looksLikeHemi) {
      const two = q.choices.slice(0,2);
      dataOut = { question:q.question, image:q.image, choices:two, answerIndex:q.answerIndex, explanation:q.explanation || '' };
    } else {
      const norm = ensureChoices(q.choices, q.choices[q.answerIndex] ?? q.choices[0], 4);
      dataOut = { question:q.question, image:q.image, choices:norm.choices, answerIndex:norm.answerIndex, explanation:q.explanation || '' };
    }

    return res.json({ type:'quiz', data: dataOut });
  } catch (e){
    console.error(e);
    res.status(500).json({ type:'error', data:'서버 오류' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`Quiz server on http://localhost:${PORT}  (open http://localhost:${PORT})`));
