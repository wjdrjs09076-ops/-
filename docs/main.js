const $ = (id) => document.getElementById(id);

function search() {
  const q = $("q").value.trim();
  if (!q) return;

  $("result").classList.remove("hidden");
  $("company").textContent = q.toUpperCase();

  // 지금은 더미 값 (다음 단계에서 실데이터로 교체)
  $("per").textContent = "25.3";
  $("pbr").textContent = "6.1";
  $("ev").textContent = "18.7";
  $("eps").textContent = "4.92";
}

document.addEventListener("DOMContentLoaded", () => {
  $("btn").addEventListener("click", search);
  $("q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") search();
  });
});
