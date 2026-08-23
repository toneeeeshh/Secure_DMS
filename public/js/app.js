const API = '/api';
let TOKEN = localStorage.getItem('dms_token') || null;
let ME = null;
let ROLES = [];
let ROLE_LABELS = {};
let CURRENT_CASE = null;
let CURRENT_DOC = null;

function authHeaders(extra = {}) {
  return TOKEN ? { Authorization: `Bearer ${TOKEN}`, ...extra } : extra;
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { ...(opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...authHeaders(opts.headers) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

/* ---------------- Bootstrap / Auth ---------------- */

async function initAuthScreen() {
  const { needsBootstrap } = await api('/auth/needs-bootstrap');
  const loginForm = document.getElementById('login-form');
  const bootstrapForm = document.getElementById('bootstrap-form');
  const authTitle = document.getElementById('auth-title');
  const authSwitch = document.getElementById('auth-switch');

  function showBootstrap() {
    loginForm.style.display = 'none';
    bootstrapForm.style.display = 'block';
    authTitle.textContent = 'Initialize Registry';
    authSwitch.innerHTML = `Already initialized? <a id="to-login">Sign in instead</a>`;
    document.getElementById('to-login').onclick = showLogin;
  }
  function showLogin() {
    loginForm.style.display = 'block';
    bootstrapForm.style.display = 'none';
    authTitle.textContent = 'Registry Sign-In';
    authSwitch.innerHTML = '';
  }

  if (needsBootstrap) showBootstrap(); else showLogin();

  loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    errEl.textContent = '';
    try {
      const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      TOKEN = data.token;
      localStorage.setItem('dms_token', TOKEN);
      ME = data.user;
      await enterApp();
    } catch (err) { errEl.textContent = err.message; }
  };

  bootstrapForm.onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('bs-name').value;
    const username = document.getElementById('bs-username').value;
    const password = document.getElementById('bs-password').value;
    const errEl = document.getElementById('bootstrap-error');
    errEl.textContent = '';
    try {
      await api('/auth/bootstrap', { method: 'POST', body: JSON.stringify({ name, username, password }) });
      showLogin();
      document.getElementById('login-username').value = username;
    } catch (err) { errEl.textContent = err.message; }
  };
}

async function enterApp() {
  const rolesData = await api('/auth/roles');
  ROLES = rolesData.roles;
  ROLE_LABELS = rolesData.labels || {};

  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('who-name').textContent = ME.name;
  document.getElementById('who-role').textContent = ROLE_LABELS[ME.role] || ME.role;
  document.querySelectorAll('.admin-only').forEach(el => el.style.display = ME.role === 'admin' ? 'block' : 'none');
  showView('cases');
  await loadCases();
}

document.getElementById('logout-btn').onclick = async () => {
  try { await api('/auth/logout', { method: 'POST' }); } catch (e) {}
  TOKEN = null; ME = null;
  localStorage.removeItem('dms_token');
  location.reload();
};

/* ---------------- Navigation ---------------- */

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('view-' + name).style.display = 'block';
  const navBtn = document.querySelector(`.nav-item[data-view="${name}"]`);
  if (navBtn) navBtn.classList.add('active');

  if (name === 'admin-users') loadUsers();
  if (name === 'admin-audit') loadSystemAudit();
  if (name === 'admin-alerts') loadAlerts();
  if (name === 'cases') loadCases();
}
document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view)));

document.getElementById('new-case-btn').onclick = () => showView('new-case');
document.getElementById('back-from-new-case').onclick = () => showView('cases');
document.getElementById('back-from-case').onclick = () => showView('cases');
document.getElementById('back-from-upload').onclick = () => openCase(CURRENT_CASE.id);
document.getElementById('back-to-case').onclick = () => openCase(CURRENT_DOC.caseId);

/* ---------------- Cases ---------------- */

async function loadCases() {
  const { cases } = await api('/cases');
  const list = document.getElementById('case-list');
  list.innerHTML = '';
  if (cases.length === 0) {
    list.innerHTML = `<div class="empty-state">No cases yet. Click "+ New Case" to register one.</div>`;
    return;
  }
  cases.forEach(c => {
    const row = document.createElement('div');
    row.className = 'doc-row';
    row.innerHTML = `
      <div class="doc-row-main">
        <div class="doc-title">${esc(c.title)}</div>
        <div class="doc-meta">${esc(c.caseNumber)} &middot; created by ${esc(c.createdBy)}</div>
        <div class="doc-row-tags">${c.members.map(m => `<span class="tag">${esc(m)}</span>`).join('')}</div>
      </div>
      <div class="doc-row-side">${new Date(c.createdAt).toLocaleDateString()}</div>
    `;
    row.onclick = () => openCase(c.id);
    list.appendChild(row);
  });
}

document.getElementById('new-case-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('new-case-error');
  errEl.textContent = '';
  try {
    const { case: kase } = await api('/cases', {
      method: 'POST',
      body: JSON.stringify({
        caseNumber: document.getElementById('nc-case-number').value,
        title: document.getElementById('nc-title').value,
        description: document.getElementById('nc-desc').value
      })
    });
    e.target.reset();
    openCase(kase.id);
  } catch (err) { errEl.textContent = err.message; }
});

async function openCase(id) {
  const { case: kase, documents } = await api('/cases/' + id);
  CURRENT_CASE = kase;
  showView('case-detail');
  renderCaseDetail(kase, documents);
}

function renderCaseDetail(kase, documents) {
  const canManageMembers = ME.role === 'admin' || kase.createdBy === ME.username;
  const el = document.getElementById('case-detail-content');
  el.innerHTML = `
    <div class="case-header">
      <div class="case-number">${esc(kase.caseNumber)}</div>
      <h2>${esc(kase.title)}</h2>
      <div>Created by ${esc(kase.createdBy)} on ${new Date(kase.createdAt).toLocaleString()}</div>
      ${kase.description ? `<div class="case-desc">${esc(kase.description)}</div>` : ''}
      <div style="margin-top:14px">
        <strong>Authorized members:</strong>
        <div class="case-tags" id="member-list">
          ${kase.members.length === 0 ? '<span style="color:var(--slate-soft);font-size:13px">None yet</span>' : kase.members.map(m => `<span class="tag">${esc(m)} ${canManageMembers ? `<a href="#" data-remove-member="${esc(m)}" style="color:var(--seal);margin-left:4px">&times;</a>` : ''}</span>`).join('')}
        </div>
        ${canManageMembers ? `
        <div style="margin-top:10px;display:flex;gap:8px;max-width:400px">
          <input type="text" id="add-member-input" placeholder="username" />
          <button class="btn btn-primary btn-sm" id="add-member-btn">Add Member</button>
        </div>` : ''}
      </div>
    </div>

    <button class="btn btn-primary" id="upload-into-case-btn" style="margin-bottom:16px">+ Upload Document to this Case</button>

    <h3>Documents</h3>
    <div id="case-doc-list" class="doc-list"></div>
  `;

  const docList = document.getElementById('case-doc-list');
  if (documents.length === 0) {
    docList.innerHTML = `<div class="empty-state">No documents in this case yet.</div>`;
  } else {
    documents.forEach(d => {
      const row = document.createElement('div');
      row.className = 'doc-row';
      row.innerHTML = `
        <div class="doc-row-main">
          <div class="doc-title">${esc(d.title)}</div>
          <div class="doc-meta">${esc(d.documentCode)} &middot; ${esc(d.type)} &middot; v${d.currentVersion}</div>
        </div>
        <div class="doc-row-side">Uploaded by ${esc(d.uploadedBy)}<br/>${new Date(d.createdAt).toLocaleDateString()}</div>
      `;
      row.onclick = () => openDocument(d.id);
      docList.appendChild(row);
    });
  }

  document.getElementById('upload-into-case-btn').onclick = () => {
    document.getElementById('up-case-id').value = kase.id;
    document.getElementById('upload-form').reset();
    document.getElementById('upload-error').textContent = '';
    showView('upload');
  };

  if (canManageMembers) {
    document.getElementById('add-member-btn').onclick = async () => {
      const input = document.getElementById('add-member-input');
      if (!input.value.trim()) return;
      try {
        await api(`/cases/${kase.id}/members`, { method: 'POST', body: JSON.stringify({ username: input.value.trim() }) });
        openCase(kase.id);
      } catch (err) { alert(err.message); }
    };
    el.querySelectorAll('[data-remove-member]').forEach(a => {
      a.onclick = async (e) => {
        e.preventDefault();
        await api(`/cases/${kase.id}/members/${a.dataset.removeMember}`, { method: 'DELETE' });
        openCase(kase.id);
      };
    });
  }
}

/* ---------------- Upload document into case ---------------- */

document.getElementById('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('upload-error');
  errEl.textContent = '';
  const fd = new FormData();
  fd.append('caseId', document.getElementById('up-case-id').value);
  fd.append('title', document.getElementById('up-title').value);
  fd.append('type', document.getElementById('up-type').value);
  fd.append('description', document.getElementById('up-desc').value);
  fd.append('tags', document.getElementById('up-tags').value);
  fd.append('file', document.getElementById('up-file').files[0]);

  try {
    const { document: doc } = await api('/documents', { method: 'POST', body: fd });
    openDocument(doc.id);
  } catch (err) { errEl.textContent = err.message; }
});

/* ---------------- Document detail ---------------- */

async function openDocument(id) {
  const { document: doc } = await api('/documents/' + id);
  CURRENT_DOC = doc;
  showView('detail');
  renderDetail(doc);
  const { logs } = await api(`/documents/${id}/audit`);
  renderMiniAudit(logs);
}

function renderDetail(doc) {
  const canModify = ME.role === 'admin' || ['police_officer', 'investigator', 'forensic_expert'].includes(ME.role);
  const el = document.getElementById('detail-content');
  el.innerHTML = `
    <div class="case-header">
      <div class="case-number">${esc(doc.documentCode)}</div>
      <h2>${esc(doc.title)}</h2>
      <div>${esc(doc.type)} &middot; uploaded by ${esc(doc.uploadedBy)} on ${new Date(doc.createdAt).toLocaleString()}</div>
      <div class="case-tags">${doc.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      ${doc.description ? `<div class="case-desc">${esc(doc.description)}</div>` : ''}
    </div>

    <h3>Version History</h3>
    <div id="version-list"></div>

    ${canModify ? `
    <div style="margin-top:20px">
      <label>Upload new version
        <input type="file" id="new-version-file" />
      </label>
      <button class="btn btn-primary" id="new-version-btn">Upload New Version</button>
      <div class="form-error" id="version-error"></div>
    </div>` : ''}

    <div class="audit-mini">
      <h3>Document Audit Trail</h3>
      <table class="ledger-table"><thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Details</th></tr></thead><tbody id="mini-audit-body"></tbody></table>
    </div>
  `;

  const vList = document.getElementById('version-list');
  doc.versions.slice().reverse().forEach(v => {
    const row = document.createElement('div');
    row.className = 'version-row';
    row.style.flexDirection = 'column';
    row.style.alignItems = 'stretch';
    row.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div class="v-tag">Version ${v.version} ${v.version === doc.currentVersion ? '(current)' : ''}</div>
          <div>${esc(v.originalName)} &middot; ${(v.size / 1024).toFixed(1)} KB &middot; by ${esc(v.uploadedBy)}</div>
          <div class="v-hash">SHA-256: ${v.hash}</div>
        </div>
        <div class="version-actions">
          <span id="stamp-${v.version}"></span>
          <button class="btn btn-ghost btn-sm" data-verify="${v.version}">Verify</button>
          <button class="btn btn-ghost btn-sm" data-demo="${v.version}">Run Tamper Demo</button>
          <a class="btn btn-primary btn-sm" href="#" data-download="${v.version}">Download</a>
        </div>
      </div>
      <div id="demo-result-${v.version}"></div>
    `;
    vList.appendChild(row);
  });

  vList.querySelectorAll('[data-verify]').forEach(btn => btn.onclick = () => verifyVersion(doc.id, btn.dataset.verify));
  vList.querySelectorAll('[data-demo]').forEach(btn => btn.onclick = () => runTamperDemo(doc.id, btn.dataset.demo));
  vList.querySelectorAll('[data-download]').forEach(a => a.onclick = (e) => { e.preventDefault(); downloadVersion(doc.id, a.dataset.download); });

  if (canModify) {
    document.getElementById('new-version-btn').onclick = async () => {
      const fileInput = document.getElementById('new-version-file');
      const errEl = document.getElementById('version-error');
      errEl.textContent = '';
      if (!fileInput.files[0]) { errEl.textContent = 'Choose a file first.'; return; }
      const fd = new FormData();
      fd.append('file', fileInput.files[0]);
      try {
        await api(`/documents/${doc.id}/versions`, { method: 'POST', body: fd });
        await openDocument(doc.id);
      } catch (err) { errEl.textContent = err.message; }
    };
  }
}

async function verifyVersion(docId, version) {
  const stampEl = document.getElementById(`stamp-${version}`);
  stampEl.textContent = 'Checking...';
  try {
    const result = await api(`/documents/${docId}/versions/${version}/verify`);
    stampEl.innerHTML = result.verified
      ? `<span class="stamp stamp-verified">VERIFIED</span>`
      : `<span class="stamp stamp-failed">INTEGRITY COMPROMISED</span>`;
  } catch (err) {
    stampEl.innerHTML = `<span class="stamp stamp-failed">Check Failed</span>`;
  }
}

async function runTamperDemo(docId, version) {
  const resultEl = document.getElementById(`demo-result-${version}`);
  resultEl.innerHTML = `<div class="tamper-demo-box">Running demonstration...</div>`;
  try {
    const result = await api(`/documents/${docId}/versions/${version}/tamper-demo`, { method: 'POST' });
    resultEl.innerHTML = `
      <div class="tamper-demo-box">
        <strong>Tamper Demonstration</strong> &mdash; the real stored file was never touched, only a throwaway copy.
        <div class="hash-line"><strong>Original hash:</strong> ${result.originalHash}</div>
        <div class="hash-line"><strong>Tampered copy hash:</strong> ${result.tamperedHash}</div>
        <span class="stamp ${result.match ? 'stamp-verified' : 'stamp-failed'}">${result.status}</span>
      </div>
    `;
  } catch (err) {
    resultEl.innerHTML = `<div class="tamper-demo-box">Demo failed: ${esc(err.message)}</div>`;
  }
}

async function downloadVersion(docId, version) {
  const res = await fetch(`${API}/documents/${docId}/versions/${version}/download`, { headers: authHeaders() });
  if (!res.ok) { alert('Download failed.'); return; }
  const integrityOk = res.headers.get('X-Integrity-Verified') === 'true';
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="(.+)"/);
  const filename = match ? match[1] : `document-v${version}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  if (!integrityOk) {
    alert('WARNING: This file failed integrity/signature verification. It may have been altered outside the registry.');
  }
}

function renderMiniAudit(logs) {
  const body = document.getElementById('mini-audit-body');
  if (!body) return;
  body.innerHTML = logs.map(l => `
    <tr>
      <td>${new Date(l.timestamp).toLocaleString()}</td>
      <td>${esc(l.user)}</td>
      <td>${esc(l.action)}</td>
      <td>${esc(l.details || '')}</td>
    </tr>
  `).join('');
}

/* ---------------- Search ---------------- */

async function runSearch() {
  const q = document.getElementById('search-q').value.trim();
  const caseNumber = document.getElementById('search-case-id').value.trim();
  const title = document.getElementById('search-case-name').value.trim();
  const documentId = document.getElementById('search-doc-id').value.trim();
  const fileName = document.getElementById('search-filename').value.trim();

  const caseParams = new URLSearchParams();
  if (q) caseParams.set('q', q);
  if (caseNumber) caseParams.set('caseNumber', caseNumber);
  if (title) caseParams.set('title', title);
  const { cases } = await api('/cases?' + caseParams.toString());

  const docParams = new URLSearchParams();
  if (q) docParams.set('q', q);
  if (documentId) docParams.set('documentId', documentId);
  if (fileName) docParams.set('fileName', fileName);
  const { documents } = await api('/documents?' + docParams.toString());

  const caseResults = document.getElementById('search-case-results');
  caseResults.innerHTML = cases.length === 0
    ? `<div class="empty-state">No matching cases.</div>`
    : cases.map(c => `<div class="doc-row" data-case="${c.id}"><div class="doc-row-main"><div class="doc-title">${esc(c.title)}</div><div class="doc-meta">${esc(c.caseNumber)}</div></div></div>`).join('');
  caseResults.querySelectorAll('[data-case]').forEach(row => row.onclick = () => openCase(row.dataset.case));

  const docResults = document.getElementById('search-doc-results');
  docResults.innerHTML = documents.length === 0
    ? `<div class="empty-state">No matching documents.</div>`
    : documents.map(d => `<div class="doc-row" data-doc="${d.id}"><div class="doc-row-main"><div class="doc-title">${esc(d.title)}</div><div class="doc-meta">${esc(d.documentCode)} &middot; ${esc(d.type)}</div></div></div>`).join('');
  docResults.querySelectorAll('[data-doc]').forEach(row => row.onclick = () => openDocument(row.dataset.doc));
}
document.getElementById('search-btn').onclick = runSearch;

/* ---------------- Admin: users ---------------- */

async function loadUsers() {
  const { users, roles, labels } = await api('/users');
  ROLES = roles; ROLE_LABELS = labels;

  const roleSelect = document.getElementById('nu-role');
  roleSelect.innerHTML = `<option value="">Role</option>` + ROLES.map(r => `<option value="${r}">${esc(ROLE_LABELS[r] || r)}</option>`).join('');

  const tbody = document.querySelector('#user-table tbody');
  tbody.innerHTML = users.map(u => `
    <tr>
      <td>${esc(u.name)}</td>
      <td>${esc(u.username)}</td>
      <td>${esc(ROLE_LABELS[u.role] || u.role)}</td>
      <td><span class="badge ${u.active ? 'badge-active' : 'badge-inactive'}">${u.active ? 'Active' : 'Inactive'}</span></td>
      <td>${new Date(u.createdAt).toLocaleDateString()}</td>
      <td>${u.username !== ME.username ? `<button class="btn btn-ghost btn-sm" data-toggle="${esc(u.username)}" data-active="${u.active}">${u.active ? 'Deactivate' : 'Activate'}</button>` : ''}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.onclick = async () => {
      await api(`/users/${btn.dataset.toggle}/active`, { method: 'PATCH', body: JSON.stringify({ active: btn.dataset.active !== 'true' }) });
      loadUsers();
    };
  });
}

document.getElementById('new-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('user-error');
  errEl.textContent = '';
  try {
    await api('/users', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('nu-name').value,
        username: document.getElementById('nu-username').value,
        password: document.getElementById('nu-password').value,
        role: document.getElementById('nu-role').value
      })
    });
    e.target.reset();
    loadUsers();
  } catch (err) { errEl.textContent = err.message; }
});

/* ---------------- Admin: audit log + chain verification ---------------- */

async function loadSystemAudit() {
  const { logs } = await api('/audit');
  const tbody = document.querySelector('#audit-table tbody');
  tbody.innerHTML = logs.map(l => `
    <tr>
      <td>${new Date(l.timestamp).toLocaleString()}</td>
      <td>${esc(l.user)}</td>
      <td>${esc(l.action)}</td>
      <td>${esc(l.caseId || '')}</td>
      <td>${esc(l.documentId || '')}</td>
      <td>${esc(l.details || '')}</td>
    </tr>
  `).join('');
}

document.getElementById('verify-chain-btn').onclick = async () => {
  const statusEl = document.getElementById('chain-status');
  statusEl.textContent = 'Checking chain...';
  const result = await api('/audit/verify-chain');
  statusEl.innerHTML = result.valid
    ? `<span class="chain-ok">&#10003; Chain intact &mdash; ${result.entriesChecked} entries verified, no gaps or alterations detected.</span>`
    : `<span class="chain-broken">&#9888; CHAIN BROKEN at entry #${result.brokenAtId} &mdash; ${esc(result.reason)}</span>`;
};

/* ---------------- Admin: security alerts ---------------- */

async function loadAlerts() {
  const { alerts } = await api('/audit/alerts');
  const el = document.getElementById('alerts-list');
  if (alerts.length === 0) {
    el.innerHTML = `<div class="empty-good">No security alerts. All access attempts have been authorized and all documents verified.</div>`;
    return;
  }
  el.innerHTML = alerts.map(a => `
    <div class="alert-card">
      <div class="alert-msg">${esc(a.message)}</div>
      <div class="alert-meta">${new Date(a.timestamp).toLocaleString()} &middot; user: ${esc(a.user)} ${a.documentId ? `&middot; document: ${esc(a.documentId)}` : ''} ${a.details ? `&middot; ${esc(a.details)}` : ''}</div>
    </div>
  `).join('');
}

/* ---------------- Boot ---------------- */

(async function boot() {
  if (TOKEN) {
    try {
      const { user } = await api('/auth/me');
      ME = user;
      await enterApp();
      return;
    } catch (e) {
      TOKEN = null;
      localStorage.removeItem('dms_token');
    }
  }
  initAuthScreen();
})();
