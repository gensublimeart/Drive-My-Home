(function () {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;
  const started = performance.now();
  const minMs = reduced ? 0 : 780;
  const maxMs = reduced ? 400 : 2800;
  root.classList.add("is-booting");

  const icon = document.querySelector('link[rel="icon"]');
  const boot = document.createElement("div");
  boot.className = "boot";
  boot.setAttribute("role", "status");
  boot.setAttribute("aria-live", "polite");
  boot.setAttribute("aria-label", "載入中");
  boot.innerHTML =
    '<div class="boot-mark"><span class="boot-ring" aria-hidden="true"></span><img class="boot-logo" alt="" width="64" height="64" /></div><p class="boot-caption">屋企在途中</p>';
  const logo = boot.querySelector(".boot-logo");
  if (icon) logo.src = icon.getAttribute("href");

  let mounted = false;
  let finishing = false;

  function mount() {
    if (mounted || !document.body) return;
    mounted = true;
    document.body.prepend(boot);
  }

  function pageReady() {
    if (!document.body) return false;
    if (document.body.classList.contains("index-body")) return document.body.classList.contains("flow-ready");
    return document.readyState === "complete";
  }

  function finish() {
    if (finishing) return;
    finishing = true;
    const wait = Math.max(0, minMs - (performance.now() - started));
    setTimeout(() => {
      root.classList.add("is-booted");
      boot.classList.add("is-out");
      const done = () => {
        if (!boot.isConnected) return;
        root.classList.remove("is-booting");
        boot.remove();
      };
      if (reduced) done();
      else {
        boot.addEventListener("transitionend", done, { once: true });
        setTimeout(done, 700);
      }
    }, wait);
  }

  function poll() {
    mount();
    if (performance.now() - started >= maxMs || pageReady()) finish();
    else requestAnimationFrame(poll);
  }

  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
  window.addEventListener("load", () => {
    if (!document.body || !document.body.classList.contains("index-body")) finish();
  });
  requestAnimationFrame(poll);
})();
