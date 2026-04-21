window.addEventListener("keydown", (e) => {
  const key = String(e?.key || "").toLowerCase();
  if (e.ctrlKey && e.altKey && key === "q") {
    e.preventDefault();
    window.TPV_SYS?.quit?.();
  }
});
