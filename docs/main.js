const $ = (id) => document.getElementById(id);

// ✅ 네 Worker 주소
const WORKER_BASE = "https://multiples-api.wjdrjs09076.workers.dev";

// peers.json 유지
let peersMap = {};

// KR map
let krMap = null;          // { "005930": {corp_code, name}, ... }
let krList = [];           // [{ code:"005930", name:"삼성전자" }, ...]

let lastBaseRow = null;
let lastTicker = null;
let isLoading = false;

// ✅ compare box (localStorage)
const LS_KEY = "multiples_compare_v1";
const MAX_COMPARE = 6;
let compareTickers = []; // ["005930.KS", "AAPL", ...]

function fmt(x) {
  if (x === null || x === undefined) return "-";
  if (typeof x === "string") {
    const t = x.trim().toLowerCase();
    if (!t || t === "null" || t === "nan" || t === "undefined") return "-";
  }
  const v = Number(x);
  if (!Number.isFinite(v)) return "-";
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function normName(s) {
  return String(s || "")
    .replace(/\s+/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/㈜/g, "")
    .trim()
    .toLowerCase();
}

function hasHangul(s) {
  return /[ㄱ-ㅎ가-힣]/.test(String(s || ""));
}

async function loadPeers() {
  try {
    const r = await fetch("./peers.json", { cache: "no-store" });
    peersMap = r.ok ? await r.json() : {};
  } catch (_) {
    peersMap = {};
  }
}

async function loadKrMap() {
  try {
    const r = await fetch("./kr_corp_map.json", { cache: "no-store" });
    if (!r.ok) {
      krMap = null;
      krList = [];
      return;
    }
    krMap = await r.json();
    krList = Object.entries(krMap).map(([code, v]) => ({
      code,
      name: v?.name || code,
      _n: normName(v?.name || ""),
    }));
  } catch (_) {
    krMap = null;
    krList = [];
  }
}

async function apiSearchUS(q) {
  const url = `${WORKER_BASE}/api/search?q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) return [];
  return r.json();
}

async function fetchFundamentals(ticker) {
  const url = `${WORKER_BASE}/api/fundamentals?ticker=${encodeURIComponent(ticker)}`;
  const r = await fetch(url, { cache: "no-store" });

  if (!r.ok) {
    let msg = `API error ${r.status}`;
    try {
      const j = await r.json();
      msg = j?.message ? j.message : msg;
    } catch (_) {}
    throw new Error(msg);
  }
  return r.json();
}

function resetUIForSearch() {
  $("hint").textContent = "조회 중...";
  $("suggestions").classList.add("hidden");
  $("suggestions").innerHTML = "";

  $("result").classList.add("hidden");
  $("peers").classList.add("hidden");

  // peers 버튼 초기화
  $("loadPeersBtn").classList.add("hidden");
  $("loadPeersBtn").disabled = false;
  $("loadPeersBtn").textContent = "경쟁사 비교 보기 (최대 3개)";
  $("peerStatus").textContent = "";

  // compare 상태
  const cs = $("compareStatus");
  if (cs) cs.textContent = "";

  lastBaseRow = null;
  lastTicker = null;

  syncCompareButtons();
}

function renderSingle(d) {
  $("result").classList.remove("hidden");
  $("company").textContent = `${d.name} (${d.ticker})`;
  $("asof").textContent = `As of: ${d.asof || "-"}`;

  $("per").textContent = fmt(d.per);
  $("pbr").textContent = fmt(d.pbr);
  $("ev").textContent = fmt(d.ev_ebitda);
  $("eps").textContent = fmt(d.eps);

  syncCompareButtons();
}

function renderSuggestions(list) {
  const box = $("suggestions");
  if (!list || list.length === 0) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.classList.remove("hidden");

  // item shape: {symbol, name, exchange, type, note?}
  box.innerHTML = list
    .slice(0, 10)
    .map((x) => `
      <button type="button" class="item" data-symbol="${x.symbol}">
        <b>${x.symbol}</b> — ${x.name}
        <span class="ex">${x.note ? x.note : (x.exchange ? `(${x.exchange})` : "")}</span>
      </button>
    `)
    .join("");
}

function isTickerLike(s) {
  return /^[A-Za-z0-9.\-]{1,12}$/.test(s);
}

function krSuggest(q) {
  if (!krList.length) return [];
  const nq = normName(q);
  if (!nq) return [];

  // 포함 매칭(가벼운)
  const hits = krList
    .filter((x) => x._n.includes(nq) || x.code.includes(nq))
    .slice(0, 10)
    .map((x) => ({
      symbol: `${x.code}.KS`,            // 기본은 KS로 제안 (KQ는 조회 시 fallback)
      name: x.name,
      exchange: "KRX",
      type: "EQUITY",
      note: "(KRX)",
      _code: x.code,
    }));

  return hits;
}

async function resolveAndFetchKRByCode(code6) {
  // 1) .KS 시도 → 2) 실패 시 .KQ 시도
  try {
    return await fetchFundamentals(`${code6}.KS`);
  } catch (e1) {
    return await fetchFundamentals(`${code6}.KQ`);
  }
}

async function resolveAndFetchKRByName(nameKor) {
  const hits = krSuggest(nameKor);
  if (!hits.length) throw new Error("KR 기업명을 찾지 못했습니다. (kr_corp_map.json 기준)");

  // 1개면 바로 조회, 여러 개면 suggestions 띄우기
  if (hits.length === 1) {
    const code6 = hits[0].symbol.slice(0, 6);
    return await resolveAndFetchKRByCode(code6);
  } else {
    $("hint").textContent = "한국 기업명으로 인식됨. 아래 목록에서 선택하세요.";
    renderSuggestions(hits);
    return null; // 선택 유도
  }
}

async function search() {
  let raw = $("q").value.trim();
  if (!raw) return;
  if (isLoading) return;

  isLoading = true;
  resetUIForSearch();

  try {
    // ✅ 6자리 숫자면 KR로 간주
    if (/^\d{6}$/.test(raw)) {
      const base = await resolveAndFetchKRByCode(raw);
      lastBaseRow = base;
      lastTicker = base.ticker;

      renderSingle(base);
      $("loadPeersBtn").classList.remove("hidden");

      const peers = (peersMap[lastTicker] || []).slice(0, 3);
      $("peerStatus").textContent = peers.length
        ? `경쟁사 ${peers.length}개 준비됨 · 버튼을 누르면 불러옵니다.`
        : `등록된 경쟁사가 없습니다 (peers.json에 추가 가능).`;

      $("hint").textContent = "";
      return;
    }

    // ✅ 6자리.KS / 6자리.KQ면 그대로 KR 조회
    if (/^\d{6}\.(KS|KQ)$/i.test(raw)) {
      const base = await fetchFundamentals(raw.toUpperCase());
      lastBaseRow = base;
      lastTicker = base.ticker;

      renderSingle(base);
      $("loadPeersBtn").classList.remove("hidden");

      const peers = (peersMap[lastTicker] || []).slice(0, 3);
      $("peerStatus").textContent = peers.length
        ? `경쟁사 ${peers.length}개 준비됨 · 버튼을 누르면 불러옵니다.`
        : `등록된 경쟁사가 없습니다 (peers.json에 추가 가능).`;

      $("hint").textContent = "";
      return;
    }

    // ✅ 한글 포함이면 KR 회사명으로 먼저 처리(로컬 map)
    if (hasHangul(raw)) {
      const base = await resolveAndFetchKRByName(raw);
      if (!base) return; // 여러 개면 선택 대기
      lastBaseRow = base;
      lastTicker = base.ticker;

      renderSingle(base);
      $("loadPeersBtn").classList.remove("hidden");

      const peers = (peersMap[lastTicker] || []).slice(0, 3);
      $("peerStatus").textContent = peers.length
        ? `경쟁사 ${peers.length}개 준비됨 · 버튼을 누르면 불러옵니다.`
        : `등록된 경쟁사가 없습니다 (peers.json에 추가 가능).`;

      $("hint").textContent = "";
      return;
    }

    // ✅ 그 외: US/글로벌 (티커면 fundamentals, 이름이면 search suggestions)
    if (!isTickerLike(raw) || raw.length > 6) {
      $("hint").textContent = "기업명으로 인식됨. 아래 목록에서 선택하세요.";
      const list = await apiSearchUS(raw);
      renderSuggestions(list);
      return;
    }

    const ticker = raw.toUpperCase();
    const base = await fetchFundamentals(ticker);

    lastBaseRow = base;
    lastTicker = ticker;

    renderSingle(base);
    $("loadPeersBtn").classList.remove("hidden");

    const peers = (peersMap[ticker] || []).slice(0, 3);
    $("peerStatus").textContent = peers.length
      ? `경쟁사 ${peers.length}개 준비됨 · 버튼을 누르면 불러옵니다.`
      : `등록된 경쟁사가 없습니다 (peers.json에 추가 가능).`;

    $("hint").textContent = "";
  } catch (e) {
    $("hint").textContent = `조회 실패: ${e.message}`;
  } finally {
    isLoading = false;
    syncCompareButtons();
  }
}

function renderPeersTable(rows) {
  const tbody = $("peerTable").querySelector("tbody");
  tbody.innerHTML = rows
    .map(
      (d) => `
    <tr>
      <td>${d.ticker}</td>
      <td>${d.name}</td>
      <td class="num">${fmt(d.per)}</td>
      <td class="num">${fmt(d.pbr)}</td>
      <td class="num">${fmt(d.ev_ebitda)}</td>
      <td class="num">${fmt(d.eps)}</td>
    </tr>
  `
    )
    .join("");
}

async function loadPeersBtn() {
  if (!lastTicker || !lastBaseRow) return;

  $("loadPeersBtn").disabled = true;
  $("loadPeersBtn").textContent = "불러오는 중...";
  $("peerStatus").textContent = "";

  const peers = (peersMap[lastTicker] || []).slice(0, 3);
  const rows = [lastBaseRow];

  for (const p of peers) {
    try {
      rows.push(await fetchFundamentals(p));
    } catch (_) {}
  }

  renderPeersTable(rows);
  $("peers").classList.remove("hidden");
  $("loadPeersBtn").textContent = "경쟁사 비교 완료";
  $("peerStatus").textContent = "완료";
}

/* =========================
   compare box (localStorage)
========================= */
function loadCompare() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    compareTickers = Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch {
    compareTickers = [];
  }
}

function saveCompare() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(compareTickers));
  } catch {}
}

function inCompare(t) {
  return compareTickers.includes(t);
}

function syncCompareButtons() {
  const addBtn = $("addToCompareBtn");
  const clearBtn = $("clearCompareBtn");

  if (addBtn) {
    if (!lastTicker) {
      addBtn.disabled = true;
      addBtn.textContent = "비교함에 추가";
    } else if (inCompare(lastTicker)) {
      addBtn.disabled = true;
      addBtn.textContent = "이미 비교함에 있음";
    } else if (compareTickers.length >= MAX_COMPARE) {
      addBtn.disabled = true;
      addBtn.textContent = `비교함 가득참(${MAX_COMPARE})`;
    } else {
      addBtn.disabled = false;
      addBtn.textContent = "비교함에 추가";
    }
  }

  if (clearBtn) clearBtn.disabled = compareTickers.length === 0;
}

function renderCompareChips() {
  const wrap = $("compareChips");
  if (!wrap) return;

  wrap.innerHTML = compareTickers
    .map((t) => `<button type="button" class="chip" data-ticker="${t}">${t}</button>`)
    .join("");

  wrap.querySelectorAll(".chip[data-ticker]").forEach((b) => {
    b.addEventListener("click", () => {
      $("q").value = b.dataset.ticker;
      search();
    });
  });
}

function renderCompareTable(rows) {
  const tbody = $("compareTable").querySelector("tbody");
  tbody.innerHTML = rows
    .map((d) => `
      <tr>
        <td>${d.ticker}</td>
        <td>${d.name}</td>
        <td class="num">${fmt(d.per)}</td>
        <td class="num">${fmt(d.pbr)}</td>
        <td class="num">${fmt(d.ev_ebitda)}</td>
        <td class="num">${fmt(d.eps)}</td>
        <td class="num">
          <button type="button" class="mini" data-action="view" data-ticker="${d.ticker}">보기</button>
          <button type="button" class="mini danger" data-action="remove" data-ticker="${d.ticker}">삭제</button>
        </td>
      </tr>
    `)
    .join("");

  tbody.querySelectorAll('button[data-action="view"]').forEach((b) => {
    b.addEventListener("click", () => {
      $("q").value = b.dataset.ticker;
      search();
    });
  });

  tbody.querySelectorAll('button[data-action="remove"]').forEach((b) => {
    b.addEventListener("click", async () => {
      const t = b.dataset.ticker;
      compareTickers = compareTickers.filter((x) => x !== t);
      saveCompare();
      await refreshCompareUI();
      syncCompareButtons();
    });
  });
}

async function refreshCompareUI() {
  const sec = $("compare");
  if (!sec) return;

  if (!compareTickers.length) {
    sec.classList.add("hidden");
    return;
  }

  sec.classList.remove("hidden");
  renderCompareChips();

  const status = $("compareStatus");
  if (status) status.textContent = "비교함 불러오는 중...";

  const results = await Promise.allSettled(compareTickers.map((t) => fetchFundamentals(t)));

  const rows = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return { ticker: compareTickers[i], name: "(조회 실패)", per: null, pbr: null, ev_ebitda: null, eps: null };
  });

  renderCompareTable(rows);

  if (status) status.textContent = "";
}

async function addCurrentToCompare() {
  if (!lastTicker) return;
  const status = $("compareStatus");

  if (inCompare(lastTicker)) return;

  if (compareTickers.length >= MAX_COMPARE) {
    if (status) status.textContent = `비교함은 최대 ${MAX_COMPARE}개까지입니다.`;
    return;
  }

  compareTickers.push(lastTicker);
  saveCompare();
  syncCompareButtons();
  await refreshCompareUI();
  if (status) status.textContent = "";
}

async function clearCompare() {
  compareTickers = [];
  saveCompare();
  syncCompareButtons();

  const sec = $("compare");
  if (sec) sec.classList.add("hidden");

  const status = $("compareStatus");
  if (status) status.textContent = "";
}

/* =========================
   typing suggestions
========================= */
let debounceTimer = null;
function onType() {
  const q = $("q").value.trim();

  if (q.length < 2) {
    renderSuggestions([]);
    return;
  }

  // ✅ KR 한글 입력이면 로컬 map 기반 suggestions
  if (hasHangul(q)) {
    const list = krSuggest(q);
    renderSuggestions(list);
    return;
  }

  // ✅ 6자리 숫자면 KR suggestions로 안내
  if (/^\d{2,6}$/.test(q)) {
    const list = krSuggest(q);
    renderSuggestions(list);
    return;
  }

  // ✅ 티커처럼 보이면 자동완성 끔(US ticker direct)
  if (isTickerLike(q) && q.length <= 6) {
    renderSuggestions([]);
    return;
  }

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    try {
      const list = await apiSearchUS(q);
      renderSuggestions(list);
    } catch (_) {
      renderSuggestions([]);
    }
  }, 250);
}

/* =========================
   이벤트 바인딩 + suggestions 선택 (pointerdown)
========================= */
document.addEventListener("DOMContentLoaded", () => {
  // 백그라운드 로딩
  loadPeers();
  loadKrMap();

  // compare init
  loadCompare();
  syncCompareButtons();
  refreshCompareUI();

  $("btn").addEventListener("click", search);

  $("q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      search();
    } else if (e.key === "Escape") {
      $("suggestions").classList.add("hidden");
      $("suggestions").innerHTML = "";
    }
  });

  $("q").addEventListener("input", onType);

  $("loadPeersBtn").addEventListener("click", loadPeersBtn);

  $("addToCompareBtn")?.addEventListener("click", addCurrentToCompare);
  $("clearCompareBtn")?.addEventListener("click", clearCompare);

  const sug = $("suggestions");
  sug.addEventListener(
    "pointerdown",
    async (e) => {
      const el = e.target.closest(".item[data-symbol]");
      if (!el) return;

      e.preventDefault();
      e.stopPropagation();

      const sym = el.dataset.symbol; // 예: 005930.KS or AAPL
      $("q").value = sym;

      sug.classList.add("hidden");
      sug.innerHTML = "";

      // ✅ KR 제안(005930.KS)인데 KS가 실패할 수 있으니 6자리면 fallback 조회
      if (/^\d{6}\.(KS|KQ)$/i.test(sym)) {
        const code6 = sym.slice(0, 6);
        isLoading = true;
        resetUIForSearch();
        try {
          const base = await resolveAndFetchKRByCode(code6);
          lastBaseRow = base;
          lastTicker = base.ticker;

          renderSingle(base);
          $("loadPeersBtn").classList.remove("hidden");

          const peers = (peersMap[lastTicker] || []).slice(0, 3);
          $("peerStatus").textContent = peers.length
            ? `경쟁사 ${peers.length}개 준비됨 · 버튼을 누르면 불러옵니다.`
            : `등록된 경쟁사가 없습니다 (peers.json에 추가 가능).`;

          $("hint").textContent = "";
        } catch (err) {
          $("hint").textContent = `조회 실패: ${err.message}`;
        } finally {
          isLoading = false;
          syncCompareButtons();
        }
        return;
      }

      // 그 외는 일반 search로 처리
      search();
    },
    { capture: true, passive: false }
  );

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.target === $("q") || sug.contains(e.target)) return;
      sug.classList.add("hidden");
    },
    { capture: true }
  );
});
// URL 파라미터로 티커 자동 검색
window.addEventListener("DOMContentLoaded", function () {
  const params = new URLSearchParams(window.location.search);
  const ticker = params.get("q") || params.get("ticker");

  if (!ticker) return;

  const input = document.querySelector("input[type='text']");
  if (!input) return;

  input.value = ticker.toUpperCase();

  // 검색 함수가 있다면 직접 호출
  if (typeof searchCompany === "function") {
    searchCompany();
  } 
  // 검색 버튼이 있다면 클릭
  else {
    const btn = document.querySelector("button");
    btn?.click();
  }
});
