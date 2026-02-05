const $ = (id) => document.getElementById(id);

// ✅ 네 Worker 주소
const WORKER_BASE = "https://multiples-api.wjdrjs09076.workers.dev";

const qEl = $("q");
const btnEl = $("btn");
const hintEl = $("hint");
const sugEl = $("suggestions");

const resultEl = $("result");
const companyEl = $("company");
const asofEl = $("asof");
const perEl = $("per");
const pbrEl = $("pbr");
const evEl = $("ev");
const epsEl = $("eps");

const loadPeersBtn = $("loadPeersBtn");
const peerStatus = $("peerStatus");
const peersSection = $("peers");
const peerTableBody = document.querySelector("#peerTable tbody");

let debounceTimer = null;
let latestSuggestions = [];
let lastTicker = null;

function setHint(msg = "") {
  hintEl.textContent = msg;
}

function show(el) {
  el.classList.remove("hidden");
}
function hide(el) {
  el.classList.add("hidden");
}
function clearSuggestions() {
  sugEl.innerHTML = "";
  hide(sugEl);
  latestSuggestions = [];
}

function fmt(x) {
  if (x === null || x === undefined || Number.isNaN(Number(x))) return "-";
  return Number(x).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

async function fetchJson(path) {
  const r = await fetch(`${WORKER_BASE}${path}`, { cache: "no-store" });
  const text = await r.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON: ${text.slice(0, 120)}`);
  }
  if (!r.ok) {
    const msg = j?.message || j?.error || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return j;
}

/* =========================
   Suggestions
========================= */
function renderSuggestions(items) {
  latestSuggestions = Array.isArray(items) ? items : [];
  if (latestSuggestions.length === 0) {
    clearSuggestions();
    return;
  }

  // ✅ 클릭 되게: data-symbol 필수 + button 태그 사용
  sugEl.innerHTML = latestSuggestions
    .map(
      (it) => `
      <button type="button" class="sug-item" data-symbol="${escapeHtml(it.symbol)}">
        <b>${escapeHtml(it.symbol)}</b> — ${escapeHtml(it.name || "")}
        <span class="sug-ex">${escapeHtml(it.exchange || "")}</span>
      </button>
    `
    )
    .join("");

  show(sugEl);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function doSuggest(q) {
  if (!q) {
    clearSuggestions();
    setHint("");
    return;
  }

  try {
    const data = await fetchJson(`/api/search?q=${encodeURIComponent(q)}`);
    renderSuggestions(data);
    setHint("기업명으로 인식됨. 아래 목록에서 선택하세요.");
  } catch (e) {
    // 검색 실패해도 UI는 깨지지 않게
    clearSuggestions();
    setHint(`검색 실패: ${e.message}`);
  }
}

/* =========================
   Fundamentals
========================= */
async function loadFundamentals(ticker) {
  clearSuggestions();
  setHint("");
  peerStatus.textContent = "";
  hide(peersSection);
  loadPeersBtn.classList.add("hidden");
  peerTableBody.innerHTML = "";

  try {
    setHint("조회 중...");
    const d = await fetchJson(`/api/fundamentals?ticker=${encodeURIComponent(ticker)}`);

    // 에러 메시지라도 화면에 표시
    if (d?.error) {
      setHint(`조회 실패: ${d.error}${d.message ? " - " + d.message : ""}`);
    } else {
      setHint("");
    }

    lastTicker = d?.ticker || ticker;

    companyEl.textContent = `${d?.ticker || ticker} — ${d?.name || ""}`;
    asofEl.textContent = d?.asof ? `asof ${d.asof}` : "";

    perEl.textContent = fmt(d?.per);
    pbrEl.textContent = fmt(d?.pbr);
    evEl.textContent = fmt(d?.ev_ebitda);
    epsEl.textContent = fmt(d?.eps);

    show(resultEl);

    // 경쟁사 버튼 노출 (peers.json이 있는 경우)
    loadPeersBtn.classList.remove("hidden");
  } catch (e) {
    show(resultEl);
    companyEl.textContent = ticker;
    asofEl.textContent = "";
    perEl.textContent = "-";
    pbrEl.textContent = "-";
    evEl.textContent = "-";
    epsEl.textContent = "-";
    setHint(`조회 실패: ${e.message}`);
  }
}

/* =========================
   Events
========================= */
// 입력 시 자동완성 (디바운스)
qEl.addEventListener("input", () => {
  const q = qEl.value.trim();

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => doSuggest(q), 200);
});

// 엔터로 바로 조회
qEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const v = qEl.value.trim();
    if (!v) return;
    loadFundamentals(v);
  } else if (e.key === "Escape") {
    clearSuggestions();
  }
});

// 검색 버튼
btnEl.addEventListener("click", () => {
  const v = qEl.value.trim();
  if (!v) return;
  loadFundamentals(v);
});

// ✅ 핵심: 자동완성 클릭 이벤트 (이벤트 위임)
sugEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".sug-item[data-symbol]");
  if (!btn) return;

  const sym = btn.getAttribute("data-symbol");
  qEl.value = sym;
  loadFundamentals(sym);
});

// 바깥 클릭 시 닫기
document.addEventListener("click", (e) => {
  if (e.target === qEl || sugEl.contains(e.target)) return;
  clearSuggestions();
});

/* =========================
   Peers (optional)
   - 기존 네 peers.json / peersMap 로직이 있으면 여기에 붙이면 됨.
   - 일단 클릭 문제 해결이 목적이라 최소한으로만 둠.
========================= */
loadPeersBtn.addEventListener("click", async () => {
  peerStatus.textContent = "준비 중...";
  // 여기부터는 네 기존 peers.json 로직이 이미 있으면 그대로 살려서 붙이면 됨.
  // 지금은 클릭 문제 해결이 우선이니 “버튼이 동작한다”만 확인.
  peerStatus.textContent = "경쟁사 비교 로직은 기존 코드 블록을 유지해서 붙이세요.";
});
