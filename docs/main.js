// docs/app.js
const API_BASE = "https://multiples-api.wjdrjs09076.workers.dev"; // <-- 너 worker 도메인으로 변경

const $q = document.getElementById("q");
const $suggestions = document.getElementById("suggestions");
const $status = document.getElementById("status");
const $result = document.getElementById("result");

let lastQuery = "";
let debounceTimer = null;

function setStatus(msg = "") {
  $status.textContent = msg;
}

function clearSuggestions() {
  $suggestions.innerHTML = "";
  $suggestions.classList.remove("open");
}

function openSuggestions() {
  $suggestions.classList.add("open");
}

function renderSuggestions(items) {
  if (!items || items.length === 0) {
    clearSuggestions();
    return;
  }

  $suggestions.innerHTML = items
    .map(
      (it) => `
      <button type="button" class="suggestion" data-symbol="${escapeHtml(
        it.symbol
      )}">
        <div class="suggestion-row">
          <span class="sym">${escapeHtml(it.symbol)}</span>
          <span class="nm">${escapeHtml(it.name || "")}</span>
          <span class="ex">${escapeHtml(it.exchange || "")}</span>
        </div>
      </button>
    `
    )
    .join("");

  openSuggestions();
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path) {
  const r = await fetch(`${API_BASE}${path}`);
  const text = await r.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // keep raw
  }
  if (!r.ok) {
    const msg = data?.message || data?.error || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data;
}

async function doSearch(query) {
  setStatus("");
  if (!query) {
    clearSuggestions();
    return;
  }
  const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
  renderSuggestions(data);
}

async function loadFundamentals(ticker) {
  clearSuggestions();
  setStatus("불러오는 중...");
  $result.innerHTML = "";

  const data = await api(`/api/fundamentals?ticker=${encodeURIComponent(ticker)}`);

  setStatus("");
  $result.innerHTML = renderResultCard(data);
}

function fmt(x) {
  if (x === null || x === undefined) return "—";
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function renderResultCard(d) {
  return `
  <div class="card">
    <div class="card-h">
      <div class="title">${escapeHtml(d.name || d.ticker)}</div>
      <div class="sub">${escapeHtml(d.ticker)} · ${escapeHtml(d.country || "")} · asof ${escapeHtml(d.asof || "")}</div>
    </div>

    <div class="grid">
      <div class="kv"><div class="k">Price</div><div class="v">${fmt(d.price)}</div></div>
      <div class="kv"><div class="k">PER</div><div class="v">${fmt(d.per)}</div></div>
      <div class="kv"><div class="k">PBR</div><div class="v">${fmt(d.pbr)}</div></div>
      <div class="kv"><div class="k">EPS</div><div class="v">${fmt(d.eps)}</div></div>
      <div class="kv"><div class="k">EV/EBITDA</div><div class="v">${fmt(d.ev_ebitda)}</div></div>
    </div>

    ${
      d?.error
        ? `<div class="err">에러: ${escapeHtml(d.error)} ${escapeHtml(d.message || "")}</div>`
        : ""
    }
  </div>
  `;
}

// 입력 디바운스
$q.addEventListener("input", () => {
  const v = $q.value.trim();
  lastQuery = v;

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    try {
      await doSearch(lastQuery);
    } catch (e) {
      setStatus(`검색 실패: ${e.message}`);
      clearSuggestions();
    }
  }, 200);
});

// Enter로 바로 조회
$q.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const v = $q.value.trim();
    if (!v) return;
    try {
      await loadFundamentals(v);
    } catch (err) {
      setStatus(`조회 실패: ${err.message}`);
    }
  } else if (e.key === "Escape") {
    clearSuggestions();
  }
});

// ✅ 핵심: 자동완성 클릭(이벤트 위임)
$suggestions.addEventListener("click", async (e) => {
  const btn = e.target.closest(".suggestion[data-symbol]");
  if (!btn) return;

  const sym = btn.getAttribute("data-symbol");
  $q.value = sym;

  try {
    await loadFundamentals(sym);
  } catch (err) {
    setStatus(`조회 실패: ${err.message}`);
  }
});

// 바깥 클릭 시 닫기 (레이어 겹침 방지)
document.addEventListener("click", (e) => {
  if (e.target === $q || $suggestions.contains(e.target)) return;
  clearSuggestions();
});
