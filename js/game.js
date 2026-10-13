/* 合成大麦霸 · Big MaiBa — 麦门美食合成小游戏 */
(function () {
  "use strict";

  // ---------- 配置 ----------
  const W = 420, H = 720;
  const GRAV = 1500;                 // 重力加速度 px/s²
  const AIR = 0.992;                 // 空气摩擦
  const REST = 0.32;                 // 碰撞弹性
  const FLOOR_Y = H - 26;            // 地面
  const TOP_Y = 104;                 // 游戏结束线
  const LEVELS = [
    { emoji: "🍟", name: "薯条",    r: 22, score: 10 },
    { emoji: "🧆", name: "麦乐鸡",  r: 30, score: 20 },
    { emoji: "🍔", name: "汉堡",    r: 40, score: 40 },
    { emoji: "🥤", name: "可乐",    r: 50, score: 70 },
    { emoji: "🍦", name: "麦旋风",  r: 62, score: 110 },
    { emoji: "🍗", name: "脆汁鸡",  r: 76, score: 170 },
    { emoji: "🍔", name: "巨无霸",  r: 92, score: 250 },
    { emoji: "🎉", name: "派对桶",  r: 110, score: 360 },
  ];
  const MAX_LEVEL = LEVELS.length - 1;

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $("game"), ctx = canvas.getContext("2d");
  const scoreEl = $("score"), bestEl = $("best"), nextEl = $("nextItem");
  const overlay = $("overlay"), endEmoji = $("endEmoji"), endTitle = $("endTitle");
  const endScore = $("endScore"), endBest = $("endBest"), rankList = $("rankList");
  const nickInput = $("nickInput"), toastEl = $("toast");

  // ---------- 状态 ----------
  let items = [];
  let curType = 0, nextType = 0;
  let score = 0, best = 0;
  let over = false, overTimer = 0, playing = false;
  let fx = [];                       // 合并特效
  let rafId = null, lastT = 0;
  let audioOn = localStorage.getItem("maiBaSound") !== "0";
  let ctxAudio = null;

  // ---------- 音效（WebAudio 合成，用户手势后启用） ----------
  function ensureAudio() {
    if (ctxAudio) { if (ctxAudio.state === "suspended") ctxAudio.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctxAudio = new AC();
  }
  function blip(freq, dur, type, vol) {
    if (!audioOn || !ctxAudio || ctxAudio.state !== "running") return;
    const t = ctxAudio.currentTime;
    const o = ctxAudio.createOscillator(), g = ctxAudio.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol || 0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (dur || 0.18));
    o.connect(g); g.connect(ctxAudio.destination);
    o.start(t); o.stop(t + (dur || 0.18) + 0.02);
  }
  function sMerge(level) { blip(320 + level * 90, 0.22, "square", 0.2); setTimeout(() => blip(520 + level * 90, 0.14, "triangle", 0.16), 60); }
  function sOver() { blip(220, 0.5, "sawtooth", 0.12); setTimeout(() => blip(160, 0.6, "sawtooth", 0.12), 220); }

  // ---------- 排行榜 ----------
  const RANK_KEY = "bigMaiBaRank";
  function loadRank() { try { return JSON.parse(localStorage.getItem(RANK_KEY)) || []; } catch (_) { return []; } }
  function saveRank(list) { localStorage.setItem(RANK_KEY, JSON.stringify(list.slice(0, 20))); }
  function renderRank() {
    const list = loadRank();
    if (!list.length) { rankList.innerHTML = '<li class="rank__empty">还没有成绩，快来当第一名 🏆</li>'; return; }
    rankList.innerHTML = list.map((r, i) =>
      `<li><span>${i + 1}. ${escapeHtml(r.nick || "默认玩家")}</span><span class="rank__score">${r.score}</span></li>`
    ).join("");
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- 游戏核心 ----------
  function spawn(x) {
    const lv = LEVELS[curType];
    items.push({ type: curType, r: lv.r, x: x, y: -lv.r * 1.2, vx: 0, vy: 0, merged: false });
    curType = nextType;
    nextType = Math.random() < 0.72 ? 0 : 1;   // 小物更常见
    nextEl.textContent = LEVELS[nextType].emoji;
    nextEl.style.animation = "none"; void nextEl.offsetWidth; nextEl.style.animation = "";
  }

  function physics(dt) {
    // 积分
    for (const a of items) {
      a.vy += GRAV * dt;
      a.x += a.vx * dt; a.y += a.vy * dt;
      a.vx *= AIR; a.vy *= AIR;
      // 左右墙
      if (a.x - a.r < 4) { a.x = 4 + a.r; a.vx = Math.abs(a.vx) * REST; }
      if (a.x + a.r > W - 4) { a.x = W - 4 - a.r; a.vx = -Math.abs(a.vx) * REST; }
      // 地面
      if (a.y + a.r > FLOOR_Y) {
        a.y = FLOOR_Y - a.r;
        if (Math.abs(a.vy) > 60) { a.vy = -a.vy * REST; a.vx *= 0.82; } else { a.vy = 0; a.vx *= 0.82; }
      }
    }
    // 圆-圆碰撞 + 合并
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const minD = a.r + b.r;
        if (dist >= minD || dist === 0) continue;
        // 分离
        const nx = dx / dist, ny = dy / dist;
        const push = (minD - dist) / 2;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
        // 速度
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) {
          const imp = rel * 0.5;
          a.vx += imp * nx; a.vy += imp * ny;
          b.vx -= imp * nx; b.vy -= imp * ny;
        }
        // 合并：同型、未合并过、已落稳（双方速度足够小）
        if (a.type === b.type && !a.merged && !b.merged && a.type < MAX_LEVEL) {
          if (dist < minD * 0.92 && Math.hypot(a.vx, a.vy) < 420 && Math.hypot(b.vx, b.vy) < 420) {
            a.remove = b.remove = true;
            const nx2 = a.type + 1, lv = LEVELS[nx2];
            fx.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, type: nx2, t: 0 });
            items.push({
              type: nx2, r: lv.r,
              x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
              vx: (a.vx + b.vx) / 2, vy: (a.vy + b.vy) / 2,
              merged: true,
            });
            score += lv.score;
            scoreEl.textContent = score;
            if (score > best) { best = score; bestEl.textContent = best; }
            sMerge(nx2);
          }
        }
      }
    }
    // 清理：被合并的旧球删除；新生成的球解除 merged 标记以便后续继续合并
    const alive = [];
    for (const it of items) {
      if (it.remove) continue;
      it.merged = false;
      alive.push(it);
    }
    items = alive;
    // 特效
    for (const f of fx) f.t += dt;
    fx = fx.filter((f) => f.t < 0.4);
  }

  function checkOver(dt) {
    const danger = items.some((it) => it.y - it.r < TOP_Y);
    if (danger) {
      overTimer += dt;
      if (overTimer > 1.1 && !over) endGame();
    } else {
      overTimer = 0;
    }
  }

  // ---------- 绘制 ----------
  function draw() {
    ctx.clearRect(0, 0, W, H);
    // 棋盘格背景
    ctx.fillStyle = "rgba(218,41,28,0.05)";
    for (let y = 0; y < H; y += 36)
      for (let x = 0; x < W; x += 36)
        if ((x / 36 + y / 36) % 2 === 0) ctx.fillRect(x, y, 36, 36);
    // 结束线
    ctx.strokeStyle = "rgba(218,41,28,0.4)";
    ctx.setLineDash([8, 8]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(8, TOP_Y); ctx.lineTo(W - 8, TOP_Y); ctx.stroke();
    ctx.setLineDash([]);
    // 物品
    for (const it of items) drawItem(it.x, it.y, it.type);
    // 特效
    for (const f of fx) {
      const p = f.t / 0.4;
      ctx.globalAlpha = 1 - p;
      ctx.font = `${Math.round(LEVELS[f.type].r * 2 * (0.6 + p * 0.7))}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(LEVELS[f.type].emoji, f.x, f.y);
      ctx.globalAlpha = 1;
    }
  }

  function drawItem(x, y, type) {
    const lv = LEVELS[type];
    // 阴影
    ctx.fillStyle = "rgba(28,20,16,0.12)";
    ctx.beginPath(); ctx.ellipse(x, y + lv.r * 0.86, lv.r * 0.78, lv.r * 0.22, 0, 0, Math.PI * 2); ctx.fill();
    // 圆形底
    const g = ctx.createRadialGradient(x - lv.r * 0.3, y - lv.r * 0.3, lv.r * 0.2, x, y, lv.r);
    g.addColorStop(0, "#fff8ec"); g.addColorStop(1, type >= 6 ? "#ffd23f" : "#f4d9a8");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, lv.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#1c1410"; ctx.lineWidth = type >= 6 ? 5 : 3.5;
    ctx.stroke();
    // emoji
    ctx.font = `${Math.round(lv.r * 1.62)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(lv.emoji, x, y + 2);
  }

  // ---------- 主循环 ----------
  function loop(t) {
    const dt = Math.min((t - lastT) / 1000, 0.033);
    lastT = t;
    if (playing && !over) {
      physics(dt);
      checkOver(dt);
    }
    draw();
    rafId = requestAnimationFrame(loop);
  }

  // ---------- 流程控制 ----------
  function reset() {
    items = []; fx = [];
    score = 0; over = false; overTimer = 0; playing = true;
    curType = 0; nextType = Math.random() < 0.72 ? 0 : 1;
    scoreEl.textContent = 0;
    nextEl.textContent = LEVELS[nextType].emoji;
    overlay.classList.add("hidden");
  }

  function endGame() {
    over = true; playing = false;
    endScore.textContent = score;
    endBest.textContent = best;
    endEmoji.textContent = score >= 500 ? "🎉" : score >= 200 ? "🍔" : "🥲";
    endTitle.textContent = score >= 500 ? "麦门大厨就是你！" : score >= 200 ? "不错，麦门欢迎你" : "游戏结束";
    // 提交排行榜
    const nick = (nickInput.value || "默认玩家").trim().slice(0, 10) || "默认玩家";
    const list = loadRank();
    list.unshift({ nick: nick, score: score, date: Date.now() });
    saveRank(list);
    renderRank();
    overlay.classList.remove("hidden");
    sOver();
  }

  // ---------- 事件 ----------
  canvas.addEventListener("pointerdown", (e) => {
    if (over || !playing) return;
    ensureAudio();
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * W;
    spawn(Math.min(Math.max(x, LEVELS[curType].r + 4), W - LEVELS[curType].r - 4));
  });

  $("againBtn").addEventListener("click", () => { ensureAudio(); reset(); });
  $("restartBtn").addEventListener("click", () => { ensureAudio(); reset(); });
  $("rankClose").addEventListener("click", () => { rankList.closest(".rank").style.display = "none"; });
  nickInput.addEventListener("input", () => {
    // 昵称变更即保存当前成绩归属
    localStorage.setItem("maiBaNick", nickInput.value.trim().slice(0, 10));
  });
  $("soundBtn").addEventListener("click", () => {
    ensureAudio();
    audioOn = !audioOn;
    localStorage.setItem("maiBaSound", audioOn ? "1" : "0");
    $("soundBtn").textContent = audioOn ? "🔊" : "🔇";
    $("soundBtn").classList.toggle("off", !audioOn);
    $("soundBtn").setAttribute("aria-checked", String(audioOn));
  });

  $("shareBtn").addEventListener("click", share);

  function share() {
    const url = location.href.split("#")[0];
    const text = "我玩【合成大麦霸】合成到了 " + score + " 分，来挑战我！🍔🎉";
    if (navigator.share) {
      navigator.share({ title: "合成大麦霸", text: text, url: url }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text + " " + url)
        .then(() => toast("链接和战绩已复制，快发给朋友！"))
        .catch(() => toast("长按复制地址栏链接发给朋友吧"));
    } else {
      toast("长按复制地址栏链接发给朋友吧");
    }
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "r" || e.key === "R") { ensureAudio(); reset(); }
  });

  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.remove("hidden");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 2600);
  }

  // ---------- 初始化 ----------
  best = parseInt(localStorage.getItem("bigMaiBaBest") || "0", 10) || 0;
  bestEl.textContent = best;
  const savedNick = localStorage.getItem("maiBaNick");
  if (savedNick) nickInput.value = savedNick;
  $("soundBtn").textContent = audioOn ? "🔊" : "🔇";
  $("soundBtn").classList.toggle("off", !audioOn);
  $("soundBtn").setAttribute("aria-checked", String(audioOn));
  renderRank();
  reset();
  lastT = performance.now();
  rafId = requestAnimationFrame(loop);

  // 结束保存最高分
  setInterval(() => {
    if (score > best) { best = score; bestEl.textContent = best; localStorage.setItem("bigMaiBaBest", String(best)); }
  }, 800);
})();
