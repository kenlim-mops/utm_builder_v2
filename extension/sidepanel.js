const $ = (id) => document.getElementById(id);
const state = { token: null, expiresAt: 0, campaigns: [], initiatives: [], presets: [], taxonomy: null, idempotencyKey: null, lastLinkId: null };

function baseUrl() { return $("apiBase").value.trim().replace(/\/$/, ""); }
function status(message, kind = "") { $("status").textContent = message; $("status").className = `status ${kind}`; }
function setBusy(busy) { $("preview").disabled = busy; $("issue").disabled = busy; }

async function ensurePermission() {
  const url = new URL(baseUrl());
  const origin = `${url.origin}/*`;
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  return chrome.permissions.request({ origins: [origin] });
}

async function api(path, init = {}) {
  if (!(await ensurePermission())) throw new Error("Permission to access the registry was not granted.");
  const headers = { "Content-Type": "application/json", ...(init.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(`${baseUrl()}${path}`, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error?.message || body.error || `Request failed (${response.status})`);
    error.body = body; error.status = response.status; throw error;
  }
  return body;
}

function randomBase64Url(bytes = 32) {
  const value = new Uint8Array(bytes); crypto.getRandomValues(value);
  return btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function challenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function connect() {
  try {
    status("Opening Runpod sign-in…");
    if (!(await ensurePermission())) return;
    const verifier = randomBase64Url(32); const oauthState = randomBase64Url(24);
    const redirectUri = chrome.identity.getRedirectURL("callback");
    const authorize = new URL(`${baseUrl()}/api/v1/auth/extension/authorize`);
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("state", oauthState);
    authorize.searchParams.set("code_challenge", await challenge(verifier));
    authorize.searchParams.set("code_challenge_method", "S256");
    const finalUrl = await chrome.identity.launchWebAuthFlow({ url: authorize.toString(), interactive: true });
    if (!finalUrl) throw new Error("Sign-in did not complete.");
    const result = new URL(finalUrl);
    if (result.searchParams.get("state") !== oauthState) throw new Error("Sign-in state did not match.");
    const token = await api("/api/v1/auth/extension/token", { method: "POST", body: JSON.stringify({ code: result.searchParams.get("code"), codeVerifier: verifier, redirectUri }) });
    state.token = token.access_token; state.expiresAt = Date.now() + token.expires_in * 1000;
    await chrome.storage.session.set({ apiToken: state.token, apiTokenExpiresAt: state.expiresAt });
    await initialize(); status("Connected to the Runpod registry.", "success");
  } catch (error) { status(error.message, "error"); }
}

function fillSelect(element, rows, emptyLabel, valueKey = "id", labelKey = "name") {
  const current = element.value; element.replaceChildren();
  if (emptyLabel) element.add(new Option(emptyLabel, ""));
  for (const row of rows) element.add(new Option(row[labelKey], row[valueKey]));
  if ([...element.options].some((option) => option.value === current)) element.value = current;
}

function updateSources() {
  const medium = $("medium").value;
  const sources = (state.taxonomy?.sources || []).filter((source) => source.status === "active" && (!medium || source.mediumSlug === medium));
  fillSelect($("source"), sources, "Select source…", "slug", "label");
}

function applyPreset() {
  const preset = state.presets.find((item) => item.key === $("preset").value);
  if (preset?.defaults?.utm_medium) $("medium").value = preset.defaults.utm_medium;
  updateSources();
  if (preset?.defaults?.utm_source) $("source").value = preset.defaults.utm_source;
}

async function loadReferenceData() {
  const [campaigns, initiatives, presets, taxonomy] = await Promise.all([
    api("/api/v1/campaigns"), api("/api/v1/initiatives"), api("/api/v1/presets"), api("/api/v1/taxonomy"),
  ]);
  state.campaigns = campaigns.campaigns; state.initiatives = initiatives.initiatives; state.presets = presets.presets; state.taxonomy = taxonomy;
  fillSelect($("initiative"), state.initiatives, "No initiative");
  fillSelect($("campaign"), state.campaigns, "Select a campaign…");
  fillSelect($("preset"), state.presets.filter((p) => p.verificationState !== "deprecated"), null, "key", "name");
  fillSelect($("medium"), taxonomy.mediums.filter((m) => m.status === "active"), "Select medium…", "slug", "label");
  applyPreset();
}

async function captureTarget() {
  const result = await chrome.runtime.sendMessage({ type: "capture-active-tab" });
  if (result?.url) $("destination").value = result.url;
}

function linkInput() {
  return { destination: $("destination").value, campaignId: $("campaign").value, presetKey: $("preset").value, utmMedium: $("medium").value, utmSource: $("source").value, utmContent: $("content").value || null, utmTerm: $("term").value || null };
}

function showResult(data, issued = false) {
  const link = data.link; const validation = data.validation || data;
  const url = link?.finalUrl || data.finalUrlPreview || data.existingUrl || "";
  const findings = validation?.findings || data.findings || [];
  $("result").classList.remove("hidden"); $("resultTitle").textContent = issued ? "Issued URL" : "Preview";
  $("resultBadge").textContent = findings.some((f) => f.severity === "error") ? "Blocked" : findings.some((f) => f.severity === "warning") ? "Warnings" : "Ready";
  $("resultBadge").className = `badge ${findings.some((f) => f.severity === "error") ? "error" : findings.some((f) => f.severity === "warning") ? "warn" : "ok"}`;
  $("findings").textContent = findings.map((f) => `${f.severity.toUpperCase()}: ${f.message}`).join("\n") || "No validation findings.";
  $("generatedUrl").value = url; state.lastLinkId = link?.id || data.existingLinkId || null;
}

async function preview() {
  try { setBusy(true); status("Validating…"); const result = await api("/api/v1/links/preview", { method:"POST", body:JSON.stringify(linkInput()) }); showResult(result); status("Preview complete.", "success"); }
  catch (error) { showResult(error.body || {}); status(error.message, "error"); } finally { setBusy(false); }
}

async function issue(event) {
  event.preventDefault();
  try {
    setBusy(true); status("Issuing and recording URL…");
    state.idempotencyKey ||= crypto.randomUUID();
    const result = await api("/api/v1/links", { method:"POST", headers:{"Idempotency-Key":state.idempotencyKey}, body:JSON.stringify(linkInput()) });
    showResult(result, true); await navigator.clipboard.writeText(result.link.finalUrl); state.idempotencyKey = null; status("Issued, logged, and copied.", "success");
  } catch (error) { showResult(error.body || {}); status(error.message, "error"); } finally { setBusy(false); }
}

async function createInitiative() {
  try { const name = $("newInitiativeName").value.trim(); if (!name) return; const result = await api("/api/v1/initiatives", {method:"POST",body:JSON.stringify({name})}); state.initiatives.push(result.initiative); fillSelect($("initiative"),state.initiatives,"No initiative"); $("initiative").value=result.initiative.id; $("newInitiativeName").value=""; status("Initiative created.","success"); }
  catch(error){ status(error.message,"error"); }
}

async function createCampaign() {
  try { const name=$("newCampaignName").value.trim(); if(!name)return; const payload={name,utmCampaign:$("newCampaignSlug").value.trim()||undefined,initiativeId:$("initiative").value||null}; const result=await api("/api/v1/campaigns",{method:"POST",body:JSON.stringify(payload)}); state.campaigns.push(result.campaign); fillSelect($("campaign"),state.campaigns,"Select a campaign…"); $("campaign").value=result.campaign.id; $("newCampaignName").value=""; $("newCampaignSlug").value=""; status("Campaign created and selected.","success"); }
  catch(error){ status(error.message,"error"); }
}

async function initialize() {
  const [managed, saved] = await Promise.all([
    chrome.storage.managed.get("apiBase").catch(() => ({})),
    chrome.storage.local.get({ apiBase: "http://localhost:3000" }),
  ]);
  $("apiBase").value = managed.apiBase || saved.apiBase;
  $("apiBase").disabled = Boolean(managed.apiBase);
  $("saveBase").disabled = Boolean(managed.apiBase);
  if (managed.apiBase) $("connectionDetail").textContent = "Registry URL is managed by Runpod.";
  const session = await chrome.storage.session.get(["apiToken","apiTokenExpiresAt","pendingTarget"]);
  state.token = session.apiToken || null; state.expiresAt = session.apiTokenExpiresAt || 0;
  if (state.expiresAt <= Date.now()) { state.token=null; await chrome.storage.session.remove(["apiToken","apiTokenExpiresAt"]); }
  if (session.pendingTarget?.url) $("destination").value=session.pendingTarget.url;
  $("signedOut").classList.toggle("hidden",!!state.token); $("builder").classList.toggle("hidden",!state.token);
  if (state.token) { try { await api("/api/v1/session"); await loadReferenceData(); $("connectionDetail").textContent="Connected for this browser session."; } catch(error){ state.token=null; await chrome.storage.session.remove(["apiToken","apiTokenExpiresAt"]); $("signedOut").classList.remove("hidden"); $("builder").classList.add("hidden"); status(error.message,"error"); } }
}

$("settingsToggle").addEventListener("click",()=>$("settings").classList.toggle("hidden"));
$("saveBase").addEventListener("click",async()=>{ if ($("apiBase").disabled) return; await chrome.storage.local.set({apiBase:baseUrl()}); state.token=null; await chrome.storage.session.remove(["apiToken","apiTokenExpiresAt"]); await initialize(); status("Registry URL saved. Connect again."); });
$("connect").addEventListener("click",connect); $("connectPrimary").addEventListener("click",connect);
$("capture").addEventListener("click",captureTarget); $("preset").addEventListener("change",applyPreset); $("medium").addEventListener("change",updateSources);
$("preview").addEventListener("click",preview); $("builder").addEventListener("submit",issue);
$("createInitiative").addEventListener("click",createInitiative); $("createCampaign").addEventListener("click",createCampaign);
$("copyResult").addEventListener("click",async()=>{ await navigator.clipboard.writeText($("generatedUrl").value); status("Copied.","success"); });
$("openRegistry").addEventListener("click",()=>chrome.tabs.create({url:`${baseUrl()}/registry${state.lastLinkId?`?q=${encodeURIComponent(state.lastLinkId)}`:""}`}));

initialize();
