// tools/normalize_constellations.mjs
import fs from "fs";

const src = "constellations_88_ko_named.json";               // 현재 파일
const out = "constellations_88_ko_named.normalized.json";    // 결과 파일

const seasonMap = {
  spring: "봄",
  summer: "여름",
  autumn: "가을",
  fall: "가을",
  winter: "겨울",
  "year-round": "연중"
};
const hemiMap = { N: "북반구", S: "남반구", E: "북반구" };

const raw = JSON.parse(fs.readFileSync(src, "utf-8"));
const list = Array.isArray(raw) ? raw : raw?.constellations;

if (!Array.isArray(list)) {
  throw new Error("입력 JSON 최상위에 배열이 없습니다. (`[ ... ]` 또는 `{ constellations:[ ... ] }` 형태만 지원)");
}

const normalized = list
  .map((c) => {
    const stars =
      Array.isArray(c?.notable_stars)
        ? c.notable_stars.map((s) => s?.name_ko).filter(Boolean)
        : Array.isArray(c?.stars)
        ? c.stars : [];

    let season = c?.season || seasonMap[(c?.best_season_northern || "").toLowerCase()] || "연중";
    if ((c?.name_ko === "게자리") || (c?.name_en || "").toLowerCase() === "cancer") {
      season = "겨울"; // 한국천문연구원 기준 보정
    }

    return {
      name_en: c?.name_en || c?.english || c?.name || "",
      name_ko: c?.name_ko || c?.korean || "",
      hemisphere: hemiMap[c?.hemisphere] || c?.hemisphere || "북반구",
      season,
      stars
    };
  })
  .filter(c => c.name_en && c.name_ko);

fs.writeFileSync(out, JSON.stringify(normalized, null, 2), "utf-8");
console.log(`✅ 변환 완료 → ${out} (총 ${normalized.length}개)`);
