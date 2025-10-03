// tools/download_planet_images.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MANIFEST_PATH = path.join(__dirname, "planet_image_manifest.json");
const OUT_DIR = path.join(__dirname, "..", "public", "images", "planets");

// -------- utils ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const UA = "Mozilla/5.0 (QuizDownloader; +https://example.invalid)";

function extFromContentType(ct) {
  if (!ct) return "jpg";
  ct = ct.toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("svg")) return "svg";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  return "jpg";
}
function extFromUrl(url) {
  const u = url.split("?")[0].toLowerCase();
  if (u.endsWith(".png")) return "png";
  if (u.endsWith(".webp")) return "webp";
  if (u.endsWith(".svg")) return "svg";
  if (u.endsWith(".jpg") || u.endsWith(".jpeg")) return "jpg";
  return null;
}
async function ensureDir(p) {
  await fs.promises.mkdir(p, { recursive: true });
}
async function downloadBuffer(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") || "";
  return { buf, contentType: ct };
}
function findOgImage(html) {
  // 매우 단순한 파서: og:image / twitter:image
  const m1 = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (m1 && m1[1]) return m1[1];
  const m2 = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
  if (m2 && m2[1]) return m2[1];
  return null;
}
async function discoverFromPage(pageUrl) {
  const res = await fetch(pageUrl, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} on page`);
  const html = await res.text();
  const og = findOgImage(html);
  if (!og) throw new Error("og:image not found");
  return og.startsWith("http") ? og : new URL(og, pageUrl).href;
}

async function saveImage(url, outBase) {
  // 1) 직접 다운로드 시도
  try {
    const { buf, contentType } = await downloadBuffer(url);
    const ext = extFromUrl(url) || extFromContentType(contentType);
    const outPath = `${outBase}.${ext}`;
    await fs.promises.writeFile(outPath, buf);
    return outPath;
  } catch (e) {
    throw e;
  }
}

async function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`❌ Manifest not found: ${MANIFEST_PATH}`);
    process.exit(1);
  }
  await ensureDir(OUT_DIR);

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  const planets = manifest.planets || [];
  console.log(`🛰  Total planets: ${planets.length}`);

  for (const p of planets) {
    const { name_ko, slug, url, page } = p;
    const outBase = path.join(OUT_DIR, slug);

    let done = false;
    for (let attempt = 1; attempt <= 5 && !done; attempt++) {
      try {
        console.log(`↓ [${attempt}/5] ${name_ko} (${slug}) ← ${url}`);
        const outPath = await saveImage(url, outBase);
        console.log(`✅ Saved: ${outPath}`);
        done = true;
      } catch (e) {
        console.warn(`⚠️  Direct failed: ${e.message}`);
        if (!page) {
          await sleep(1500 * attempt);
          continue;
        }
        // 페이지에서 og:image 추출 후 재시도
        try {
          console.log(`🔎 Trying og:image from page: ${page}`);
          const ogUrl = await discoverFromPage(page);
          console.log(`↪️  Found og:image: ${ogUrl}`);
          const outPath = await saveImage(ogUrl, outBase);
          console.log(`✅ Saved via og:image: ${outPath}`);
          done = true;
        } catch (e2) {
          console.warn(`⚠️  Fallback og:image failed: ${e2.message}`);
          await sleep(1500 * attempt);
        }
      }
    }

    if (!done) {
      console.error(`❌ FAILED: ${name_ko} (${slug}) — please update URL in manifest`);
    }
  }

  console.log("✅ Done.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
