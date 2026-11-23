(() => {
  const $ = (id) => document.getElementById(id);
  const form = $("solverForm"), functionInput = $("functionInput"), canvas = $("plot");
  const ctx = canvas.getContext("2d");
  let currentFunction = null, currentRows = [], currentRange = null;

  // A small recursive-descent parser: no eval() or arbitrary JavaScript execution.
  function compileExpression(source) {
    const input = source.replace(/\s+/g, "").toLowerCase();
    if (!input) throw new Error("Please enter a function.");
    let pos = 0;
    const peek = () => input[pos];
    const consume = (c) => { if (input[pos] === c) { pos++; return true; } return false; };
    const number = () => {
      const rest = input.slice(pos), match = rest.match(/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/);
      if (!match) return null;
      pos += match[0].length; return Number(match[0]);
    };
    function primary() {
      if (consume("(")) { const node = expression(); if (!consume(")")) throw new Error("Missing closing parenthesis."); return node; }
      const n = number(); if (n !== null) return () => n;
      if (/[a-z]/.test(peek() || "")) {
        const start = pos; while (/[a-z]/.test(peek() || "")) pos++;
        const name = input.slice(start, pos);
        if (name === "x") return (x) => x;
        if (name === "pi") return () => Math.PI;
        if (name === "e") return () => Math.E;
        const funcs = {sin:Math.sin, cos:Math.cos, tan:Math.tan, exp:Math.exp, log:Math.log, ln:Math.log, sqrt:Math.sqrt, abs:Math.abs};
        if (!funcs[name]) throw new Error(`Unknown name "${name}". Use x, pi, e or a supported function.`);
        if (!consume("(")) throw new Error(`Function ${name} must be followed by parentheses, e.g. ${name}(x).`);
        const arg = expression(); if (!consume(")")) throw new Error("Missing closing parenthesis after function.");
        return (x) => funcs[name](arg(x));
      }
      throw new Error(`Unexpected character near "${input.slice(pos, pos + 8)}".`);
    }
    function unary() { if (consume("+")) return unary(); if (consume("-")) { const a = unary(); return (x) => -a(x); } return primary(); }
    function power() { let a = unary(); if (consume("^")) { const b = power(), left = a; a = (x) => Math.pow(left(x), b(x)); } return a; }
    function term() { let a = power(); while (true) { if (consume("*")) { const b = power(), left = a; a = (x) => left(x) * b(x); } else if (consume("/")) { const b = power(), left = a; a = (x) => left(x) / b(x); } else break; } return a; }
    function expression() { let a = term(); while (true) { if (consume("+")) { const b = term(), left = a; a = (x) => left(x) + b(x); } else if (consume("-")) { const b = term(), left = a; a = (x) => left(x) - b(x); } else break; } return a; }
    const fn = expression();
    if (pos !== input.length) throw new Error(`Unexpected input near "${input.slice(pos)}". Check operators and parentheses.`);
    return fn;
  }

  const derivative = (f, x) => {
    const h = 1e-5 * Math.max(1, Math.abs(x));
    return (f(x + h) - f(x - h)) / (2 * h);
  };
  const fmt = (n, digits = 10) => Number.isFinite(n) ? Number(n.toPrecision(digits)).toString() : String(n);
  const pretty = (s) => s.replace(/\*/g, " × ").replace(/\bpi\b/gi, "π");

  function solve(f, x0, tolerance, maxIterations) {
    const rows = [];
    let x = x0, converged = false, reason = "";
    for (let i = 0; i < maxIterations; i++) {
      const fx = f(x), dfx = derivative(f, x);
      if (!Number.isFinite(fx)) throw new Error(`f(x) is not defined at x = ${fmt(x)}. Try a different initial guess.`);
      if (!Number.isFinite(dfx) || Math.abs(dfx) < 1e-14) throw new Error(`The derivative is zero or undefined at x = ${fmt(x)}. Newton–Raphson cannot continue.`);
      const next = x - fx / dfx, error = Math.abs(next - x);
      if (!Number.isFinite(next)) throw new Error("The next approximation is not finite. Try a different initial guess.");
      rows.push({i, x, fx, dfx, next, error});
      const nextFx = f(next);
      if (error <= tolerance || (Number.isFinite(nextFx) && Math.abs(nextFx) <= tolerance)) { converged = true; reason = error <= tolerance ? "The change between two successive approximations is within the tolerance." : "The absolute function value is within the tolerance."; break; }
      x = next;
    }
    return {rows, converged, reason, root: rows.length ? rows[rows.length - 1].next : x0, froot: f(rows.length ? rows[rows.length - 1].next : x0)};
  }

  function showResult(result, source) {
    currentRows = result.rows;
    $("rootValue").textContent = fmt(result.root, 12);
    $("iterationValue").textContent = result.rows.length;
    $("functionValue").textContent = fmt(Math.abs(result.froot), 6);
    $("rootSub").textContent = `f(root) = ${fmt(result.froot, 8)}`;
    $("resultBadge").textContent = result.converged ? "CONVERGED" : "MAX ITERATIONS";
    $("resultBadge").className = `badge ${result.converged ? "success" : "error"}`;
    $("message").className = `message ${result.converged ? "success-message" : "error-message"}`;
    $("message").innerHTML = result.converged ? `<b>Solution converged.</b> ${result.reason}` : `<b>Convergence not reached.</b> The maximum number of iterations was reached. Try another initial guess or tolerance.`;
    $("rowCount").textContent = `${result.rows.length} ${result.rows.length === 1 ? "STEP" : "STEPS"}`;
    $("iterationBody").innerHTML = result.rows.map(r => `<tr><td>${r.i}</td><td>${fmt(r.x, 11)}</td><td>${fmt(r.fx, 9)}</td><td>${fmt(r.dfx, 9)}</td><td><b>${fmt(r.next, 11)}</b></td><td>${fmt(r.error, 7)}</td></tr>`).join("");
    $("graphFunction").textContent = `f(x) = ${pretty(source)}`;
    $("graphEmpty").classList.add("hidden");
    currentFunction = result._fn;
    drawGraph(currentFunction, result.rows);
  }

  function showError(message) {
    $("resultBadge").textContent = "CHECK INPUT"; $("resultBadge").className = "badge error";
    $("message").className = "message error-message"; $("message").textContent = message;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const source = functionInput.value.trim(), f = compileExpression(source);
      const x0 = Number($("initialGuess").value), tolerance = Number($("tolerance").value), max = Number($("maxIterations").value);
      if (!Number.isFinite(x0)) throw new Error("Enter a valid initial guess x₀.");
      if (!(tolerance > 0) || !Number.isFinite(tolerance)) throw new Error("Tolerance must be a positive number.");
      if (!Number.isInteger(max) || max < 1 || max > 200) throw new Error("Maximum iterations must be an integer from 1 to 200.");
      const result = solve(f, x0, tolerance, max); result._fn = f;
      showResult(result, source);
    } catch (err) { showError(err.message); }
  });

  document.querySelectorAll(".example").forEach(btn => btn.addEventListener("click", () => {
    functionInput.value = btn.dataset.function;
    if (btn.dataset.function === "cos(x) - x") $("initialGuess").value = "0.5";
    else if (btn.dataset.function === "x^2 - 4") $("initialGuess").value = "1.5";
    else $("initialGuess").value = "1.5";
    form.requestSubmit();
  }));

  $("resetBtn").addEventListener("click", () => {
    functionInput.value = "x^3 - x - 2"; $("initialGuess").value = "1.5";
    $("tolerance").value = "0.000001"; $("maxIterations").value = "50";
    form.requestSubmit();
  });

  function drawGraph(f, rows) {
    const rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr)); canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width, h = rect.height, pad = {l:54,r:20,t:18,b:36};
    const xs = rows.map(r => r.x).concat(rows.map(r => r.next));
    let xMin = Math.min(...xs), xMax = Math.max(...xs);
    const spread = Math.max(xMax - xMin, 1);
    xMin -= spread * .65; xMax += spread * .65;
    // Include a useful neighborhood around the root and initial guess.
    if (xMax - xMin < 4) { const mid=(xMax+xMin)/2; xMin=mid-2; xMax=mid+2; }
    let samples = [];
    for(let i=0;i<=400;i++){const x=xMin+(xMax-xMin)*i/400;let y=f(x);if(Number.isFinite(y))samples.push({x,y});}
    let yMin = Math.min(0,...samples.map(p=>p.y)), yMax = Math.max(0,...samples.map(p=>p.y));
    if (!Number.isFinite(yMin)||!Number.isFinite(yMax)||yMax-yMin<1e-10){yMin=-2;yMax=2;}
    const yPad=(yMax-yMin)*.12 || 1; yMin-=yPad; yMax+=yPad;
    // Clip extreme values so one asymptote does not flatten the whole graph.
    const cap=Math.max(Math.abs(yMin),Math.abs(yMax),1)*1.4;
    samples=samples.filter(p=>Math.abs(p.y)<cap*4);
    const X=x=>pad.l+(x-xMin)/(xMax-xMin)*(w-pad.l-pad.r);
    const Y=y=>h-pad.b-(y-yMin)/(yMax-yMin)*(h-pad.t-pad.b);
    ctx.clearRect(0,0,w,h); ctx.font="10px DM Mono, monospace"; ctx.lineWidth=1;
    // Grid and labels
    for(let i=0;i<=5;i++){
      const x=xMin+(xMax-xMin)*i/5, px=X(x);ctx.strokeStyle="#edf0f5";ctx.beginPath();ctx.moveTo(px,pad.t);ctx.lineTo(px,h-pad.b);ctx.stroke();
      ctx.fillStyle="#929bad";ctx.textAlign="center";ctx.fillText(Number(x.toPrecision(3)),px,h-13);
      const y=yMin+(yMax-yMin)*i/5, py=Y(y);ctx.strokeStyle="#edf0f5";ctx.beginPath();ctx.moveTo(pad.l,py);ctx.lineTo(w-pad.r,py);ctx.stroke();
      ctx.textAlign="right";ctx.fillText(Number(y.toPrecision(3)),pad.l-9,py+3);
    }
    // Axes
    if(yMin<=0&&yMax>=0){ctx.strokeStyle="#aab2c2";ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(pad.l,Y(0));ctx.lineTo(w-pad.r,Y(0));ctx.stroke();ctx.setLineDash([]);}
    // Function curve
    ctx.strokeStyle="#4969e8";ctx.lineWidth=2.4;ctx.beginPath();let started=false;
    samples.forEach(p=>{if(p.y<yMin||p.y>yMax){started=false;return;}if(!started){ctx.moveTo(X(p.x),Y(p.y));started=true;}else ctx.lineTo(X(p.x),Y(p.y));});ctx.stroke();
    // Newton sequence: approximate points on the curve at x_i.
    rows.forEach((r,i)=>{
      const y=f(r.x); if(!Number.isFinite(y)||y<yMin||y>yMax)return;
      const px=X(r.x),py=Y(y);
      ctx.fillStyle="#e69b43";ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.beginPath();ctx.arc(px,py,4.5,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle="#a66b20";ctx.font="10px DM Mono, monospace";ctx.textAlign="left";ctx.fillText(`x${i}`,px+7,py-8);
    });
    // Root marker
    const root=rows.length?rows[rows.length-1].next:null;
    if(root!==null&&root>=xMin&&root<=xMax){ctx.strokeStyle="#16a68a";ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(X(root),pad.t);ctx.lineTo(X(root),h-pad.b);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle="#16a68a";ctx.beginPath();ctx.arc(X(root),Y(0),4,0,Math.PI*2);ctx.fill();}
    currentRange={xMin,xMax,yMin,yMax,X,Y};
  }

  canvas.addEventListener("mousemove", e => {
    if(!currentRange)return;
    const r=canvas.getBoundingClientRect(), px=e.clientX-r.left, py=e.clientY-r.top, g=currentRange;
    const x=g.xMin+(px-54)/(r.width-74)*(g.xMax-g.xMin), y=g.yMin+(r.height-36-py)/(r.height-54)*(g.yMax-g.yMin);
    canvas.title=`x: ${fmt(x,5)}, y: ${fmt(y,5)}`;
  });
  window.addEventListener("resize",()=>{if(currentFunction&&currentRows.length)drawGraph(currentFunction,currentRows);});
  // Initial graph and first solve make the page useful immediately.
  form.requestSubmit();
})();