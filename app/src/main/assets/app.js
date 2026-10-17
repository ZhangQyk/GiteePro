/* Gitee Pro - 本地 Web 前端 SPA
 * 通过 window.Android 桥接原生网络层，调用 Gitee 开放 API v5。
 * 功能：Cookie/令牌登录、仓库列表/筛选/搜索、仓库新建/删除/Star、
 *      分支切换、目录浏览、文件预览/编辑/新建/上传/删除/下载。
 */
(function () {
  'use strict';

  var API_BASE = 'https://gitee.com/api/v5';
  var Android = window.Android || {};

  // ================= 基础工具 =================
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function $(id) { return document.getElementById(id); }
  function enc(s) { return encodeURIComponent(String(s == null ? '' : s)); }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2200);
  }

  var loadingCount = 0;
  function showLoading() { loadingCount++; $('loading').classList.remove('hidden'); }
  function hideLoading() { loadingCount = Math.max(0, loadingCount - 1); if (!loadingCount) $('loading').classList.add('hidden'); }

  function humanSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  function fmtDate(iso) {
    if (!iso) return '';
    try { return String(iso).slice(0, 10); } catch (e) { return ''; }
  }

  function extOf(name) {
    var i = String(name || '').lastIndexOf('.');
    return i > 0 ? String(name).slice(i + 1).toLowerCase() : '';
  }

  function fileBadge(name) {
    var e = extOf(name);
    var map = { js: 1, ts: 1, jsx: 1, java: 1, kt: 1, py: 1, html: 1, htm: 1, css: 1, json: 1, md: 1, xml: 1, gradle: 1, sh: 1, yml: 1, yaml: 1, txt: 1, png: 1, jpg: 1, jpeg: 1, gif: 1, svg: 1 };
    var key = map[e] ? e : 'file';
    return '<span class="badge badge-' + key + '">' + esc(e ? e.toUpperCase() : 'FILE') + '</span>';
  }

  // ================= 原生桥接（异步 Promise 封装） =================
  var cbSeq = 0;
  var cbRegistry = {};
  window.__giteeCb = function (id, data) {
    var cb = cbRegistry[id];
    if (cb) { delete cbRegistry[id]; cb(data || {}); }
  };

  function api(method, url, body) {
    return new Promise(function (resolve) {
      var id = 'cb' + (++cbSeq);
      cbRegistry[id] = resolve;
      Android.api(method, url, body ? JSON.stringify(body) : '', id);
    });
  }
  function fetchCsrf() {
    return new Promise(function (resolve) {
      var id = 'cb' + (++cbSeq);
      cbRegistry[id] = resolve;
      Android.fetchCsrf(id);
    });
  }
  function downloadFile(url, filename) {
    return new Promise(function (resolve) {
      var id = 'cb' + (++cbSeq);
      cbRegistry[id] = resolve;
      Android.downloadFile(url, filename, id);
    });
  }
  function saveBase64(data, filename) {
    return new Promise(function (resolve) {
      var id = 'cb' + (++cbSeq);
      cbRegistry[id] = resolve;
      Android.saveBase64(data, filename, id);
    });
  }
  function pickFile() {
    return new Promise(function (resolve) {
      var id = 'cb' + (++cbSeq);
      cbRegistry[id] = resolve;
      Android.pickFile(id);
    });
  }


  // 同步桥接方法
  function nativeToast(m) { toast(m); }
  function nativeCopy(t) { try { Android.copyText(t); } catch (e) {} }
  function nativeOpenUrl(u) { try { Android.openUrl(u); } catch (e) {} }
  function nativeOpenFile(p) { try { Android.openFile(p); } catch (e) {} }

  // ================= 请求封装 =================
  function strErr(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }

  async function request(method, url, body) {
    var res = await api(method, url, body);
    var status = res.status;
    var text = res.body || '';
    var json = null;
    try { json = JSON.parse(text); } catch (e) {}
    if (status >= 200 && status < 300) {
      return json !== null ? json : text;
    }
    var jm = json && (json.message || json.error_description || json.error);
    if (!jm && json && json.errors) jm = json.errors;
    var gm = strErr(jm);
    if (gm.length > 180) gm = gm.slice(0, 180) + '…';
    var snip = gm ? '' : String(res.error || text || '').slice(0, 120);
    var shortUrl = url.replace(/access_token=[^&]*/, 'access_token=***');
    var msg = (gm || ('HTTP ' + status)) + (snip ? (' · ' + snip) : '') + ' [' + shortUrl + ']';
    var err = new Error(msg);
    err.status = status;
    throw err;
  }

  function encPath(p) {
    return String(p || '').split('/').map(encodeURIComponent).join('/');
  }
  function repoBase() {
    return API_BASE + '/repos/' + encodeURIComponent(state.repo.owner) + '/' + encodeURIComponent(state.repo.name);
  }
  function currentRef() { return state.ref || state.branch || 'master'; }
  function contentsUrl(path, ref) {
    var u = repoBase() + '/contents';
    if (path) u += '/' + encPath(path);
    u += '?ref=' + encodeURIComponent(ref || currentRef());
    return u;
  }
  function rawUrl(path, ref) {
    return API_BASE + '/repos/' + encodeURIComponent(state.repo.owner) + '/' + encodeURIComponent(state.repo.name) +
      '/raw/' + encodeURIComponent(ref || currentRef()) + '/' + encPath(path);
  }

  function repoOwner(repo) {
    if (!repo) return '';
    var seg = String(repo.full_name || '').split('/');
    return (seg[0] || '') || (repo.owner && repo.owner.login) || (repo.namespace && repo.namespace.path) || '';
  }
  function repoName(repo) {
    if (!repo) return '';
    var seg = String(repo.full_name || '').split('/');
    if (seg.length > 1) return seg.slice(1).join('/');
    return repo.name || repo.path || '';
  }

  // ================= 编码工具 =================
  function utf8ToBase64(s) {
    var bytes = new TextEncoder().encode(s);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function base64ToUtf8(b64) {
    var bin = atob(String(b64 || '').replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    try { return new TextDecoder('utf-8').decode(bytes); } catch (e) { return bin; }
  }
  function looksBinary(content) {
    var n = Math.min(content.length, 8000);
    for (var i = 0; i < n; i++) {
      var c = content.charCodeAt(i);
      if (c === 0) return true;
    }
    return false;
  }

  // ================= 全局状态 =================
  var state = {
    user: null,
    repoFilter: 'all',
    repoPage: 1,
    repoList: [],
    searching: false,
    searchQuery: '',
    repo: null,
    repoTab: 'files',
    ref: '',
    branches: [],
    tags: [],
    branch: '',
    path: '',
    files: [],
    commits: [],
    commitPath: '',
    issues: [],
    issueState: 'open',
    pulls: [],
    prState: 'open',
    readme: null,
    searchResults: [],
    searchMode: false,
    file: null
  };
  var cur = '';

  function showView(name) {
    var id = name.indexOf('view-') === 0 ? name : ('view-' + name);
    ['view-login', 'view-home', 'view-repo', 'view-file'].forEach(function (v) { var el = $(v); if (el) el.classList.add('hidden'); });
    var t = $(id);
    if (t) t.classList.remove('hidden');
    cur = id;
  }

  window.__onBack = function () {
    if (cur === 'view-file') showView('view-repo');
    else if (cur === 'view-repo') showView('view-home');
    else if (cur === 'view-home') nativeToast('已返回顶层');
  };

  // ================= 登录 =================
  function loadAuth() {
    try {
      var o = JSON.parse(Android.loadAuth() || '{}');
      state.cookie = o.cookie || '';
      state.csrf = o.csrf || '';
      state.token = o.token || '';
    } catch (e) {}
  }

  async function tryLogin(silent) {
    showLoading();
    try {
      var u = await request('GET', API_BASE + '/user');
      state.user = u;
      showView('home');
      renderUser();
      renderFilters();
      loadRepos('all', true);
    } catch (e) {
      if (!silent) $('login-msg').textContent = '登录失败：' + e.message;
      showView('login');
    } finally {
      hideLoading();
    }
  }

  // ================= 仓库列表 =================
  var FILTERS = [
    { key: 'all', label: '全部' },
    { key: 'owner', label: '我创建的' },
    { key: 'member', label: '我参与的' },
    { key: 'public', label: '公开' },
    { key: 'private', label: '私有' }
  ];

  function renderFilters() {
    var wrap = $('filter-tabs');
    wrap.innerHTML = '';
    FILTERS.forEach(function (f) {
      var b = document.createElement('span');
      b.className = 'tab' + (state.repoFilter === f.key ? ' active' : '');
      b.textContent = f.label;
      b.onclick = function () { state.searching = false; $('search-input').value = ''; loadRepos(f.key, true); };
      wrap.appendChild(b);
    });
  }

  async function loadRepos(filter, reset) {
    state.repoFilter = filter || state.repoFilter;
    if (reset) { state.repoPage = 1; state.repoList = []; }
    renderFilters();
    showLoading();
    try {
      var url;
      if (state.searching && state.searchQuery) {
        url = API_BASE + '/search/repositories?q=' + encodeURIComponent(state.searchQuery) + '&page=' + state.repoPage + '&per_page=30';
      } else {
        url = API_BASE + '/user/repos?page=' + state.repoPage + '&per_page=30&type=' + state.repoFilter + '&sort=updated&direction=desc';
      }
      var list = await request('GET', url);
      if (!Array.isArray(list)) list = [];
      state.repoList = state.repoPage === 1 ? list : state.repoList.concat(list);
      renderRepoList();
    } catch (e) {
      fail('加载仓库失败：', e);
    } finally {
      hideLoading();
    }
  }

  function repoCardHtml(r) {
    var full = r.full_name || ((r.owner && r.owner.login) + '/' + r.name);
    var desc = r.description || '';
    var lang = r.language || '';
    var priv = r.private ? '<span class="tag tag-pri">私有</span>' : '';
    var fork = r.fork ? '<span class="tag tag-fork">Fork</span>' : '';
    return '<div class="repo-card">' +
      '<div class="repo-card-title">' + esc(full) + ' ' + priv + fork + '</div>' +
      (desc ? '<div class="repo-card-desc">' + esc(desc) + '</div>' : '') +
      '<div class="repo-card-meta">' +
        (lang ? '<span class="repo-lang"><span class="lang-dot"></span>' + esc(lang) + '</span>' : '') +
        '<span>★ ' + (r.stargazers_count || 0) + '</span>' +
        '<span>⑂ ' + (r.forks_count || 0) + '</span>' +
        '<span>更新 ' + fmtDate(r.updated_at) + '</span>' +
      '</div></div>';
  }

  function renderRepoList() {
    var box = $('repo-list');
    if (!state.repoList.length) { box.innerHTML = '<div class="empty">暂无仓库</div>'; return; }
    var html = '';
    state.repoList.forEach(function (r) { html += repoCardHtml(r); });
    box.innerHTML = html;
    var cards = box.querySelectorAll('.repo-card');
    for (var i = 0; i < cards.length; i++) {
      (function (card, repo) {
        card.onclick = function () { openRepo(repo); };
        var t;
        card.addEventListener('touchstart', function () { t = setTimeout(function () { repoMenu(repo); }, 520); });
        card.addEventListener('touchend', function () { clearTimeout(t); });
        card.addEventListener('touchmove', function () { clearTimeout(t); });
      })(cards[i], state.repoList[i]);
    }
  }

  function renderUser() {
    var u = state.user || {};
    $('user-name').textContent = u.name || u.login || '未登录';
    $('user-login').textContent = u.login ? ('@' + u.login) : '';
    if (u.avatar_url) $('user-avatar').style.backgroundImage = 'url(' + u.avatar_url + ')';
  }

  function applyTheme() {
    var saved = '';
    try { saved = Android.loadTheme() || ''; } catch (e) {}
    applyDark(saved === 'dark');
    updateThemeBtn();
  }

  function applyDark(dark) {
    if (dark) document.body.classList.add('dark');
    else document.body.classList.remove('dark');
    try { Android.setStatusBar(dark); } catch (e) {}
  }

  function updateThemeBtn() {
    var b = $('btn-theme');
    if (!b) return;
    b.textContent = document.body.classList.contains('dark') ? '日间' : '夜间';
  }

  function toggleTheme() {
    var dark = !document.body.classList.contains('dark');
    applyDark(dark);
    try { Android.saveTheme(dark ? 'dark' : 'light'); } catch (e) {}
    updateThemeBtn();
  }

  // ================= 仓库详情 =================
  async function openRepo(repo) {
    state.repo = {
      owner: repoOwner(repo),
      name: repoName(repo),
      full_name: repo.full_name,
      default_branch: repo.default_branch || 'master',
      html_url: repo.html_url,
      private: !!repo.private
    };
    state.branch = repo.default_branch || 'master';
    state.ref = state.branch;
    state.path = '';
    state.files = [];
    state.file = null;
    state.repoTab = 'files';
    state.commits = [];
    state.commitPath = '';
    state.issues = [];
    state.pulls = [];
    state.tags = [];
    state.readme = null;
    state.searchResults = [];
    state.searchMode = false;
    showView('repo');
    $('repo-name').textContent = repo.full_name;
    $('repo-desc').textContent = repo.description || '';
    $('code-searchbar').classList.add('hidden');
    $('code-query').value = '';
    renderRepoMeta(repo);
    updateStarBtn();
    renderRepoTabs();
    setRepoTab('files');
    await loadBranches();
    await loadTags();
    await loadFiles();
  }

  function renderRepoMeta(repo) {
    var parts = [];
    parts.push('<span>⭐ ' + (repo.stargazers_count || 0) + '</span>');
    parts.push('<span>⑂ ' + (repo.forks_count || 0) + '</span>');
    if (repo.language) parts.push('<span>' + esc(repo.language) + '</span>');
    if (repo.license) parts.push('<span>' + esc(repo.license) + '</span>');
    parts.push('<span>默认分支 ' + esc(state.branch) + '</span>');
    $('repo-meta').innerHTML = parts.join('');
  }

  async function updateStarBtn() {
    try {
      var starred = await isStarred();
      $('repo-star').textContent = starred ? '★' : '☆';
    } catch (e) {}
  }

  async function isStarred() {
    var u = API_BASE + '/user/starred/' + encodeURIComponent(state.repo.owner) + '/' + encodeURIComponent(state.repo.name);
    var res = await api('GET', u, '');
    return res.status === 204;
  }

  async function toggleStar() {
    var u = API_BASE + '/user/starred/' + encodeURIComponent(state.repo.owner) + '/' + encodeURIComponent(state.repo.name);
    try {
      if (await isStarred()) { await api('DELETE', u, ''); nativeToast('已取消 Star'); }
      else { await api('PUT', u, ''); nativeToast('已 Star'); }
      updateStarBtn();
    } catch (e) { fail('操作失败：', e); }
  }

  async function loadBranches() {
    try {
      var arr = await request('GET', repoBase() + '/branches');
      state.branches = Array.isArray(arr) ? arr : [];
    } catch (e) {
      state.branches = [];
      fail('加载分支失败：', e);
    }
    if (!state.branches.length) state.branches = [{ name: state.branch || state.repo.default_branch || 'master' }];
    renderBranchSelect();
  }

  function renderBranchSelect() {
    var sel = $('branch-select');
    sel.innerHTML = '';
    state.branches.forEach(function (b) {
      var op = document.createElement('option');
      op.value = b.name;
      op.textContent = b.name;
      sel.appendChild(op);
    });
    sel.value = state.ref || state.branch;
  }

  async function loadFiles() {
    showLoading();
    try {
      var data = await request('GET', contentsUrl(state.path));
      if (Array.isArray(data)) state.files = data;
      else state.files = [data];
      renderFiles();
      renderBreadcrumb();
    } catch (e) {
      state.files = [];
      renderFiles();
      renderBreadcrumb();
      fail('加载目录失败：', e);
    } finally {
      hideLoading();
    }
  }

  function renderBreadcrumb() {
    var bc = $('breadcrumb');
    bc.innerHTML = '';
    var root = document.createElement('span');
    root.className = 'crumb';
    root.textContent = '根';
    root.onclick = function () { state.path = ''; loadFiles(); };
    bc.appendChild(root);
    var parts = state.path ? state.path.split('/').filter(Boolean) : [];
    var acc = '';
    parts.forEach(function (p) {
      var sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = ' / ';
      bc.appendChild(sep);
      acc = acc ? acc + '/' + p : p;
      (function (a) {
        var b = document.createElement('span');
        b.className = 'crumb';
        b.textContent = p;
        b.onclick = function () { state.path = a; loadFiles(); };
        bc.appendChild(b);
      })(acc);
    });
  }

  function renderFiles() {
    var box = $('file-list');
    if (!state.files.length) { box.innerHTML = '<div class="empty">空目录</div>'; return; }
    var items = state.files.slice().sort(function (a, b) {
      if (a.type === 'dir' && b.type !== 'dir') return -1;
      if (a.type !== 'dir' && b.type === 'dir') return 1;
      return String(a.name).localeCompare(String(b.name));
    });
    var html = '';
    items.forEach(function (it) {
      var icon = it.type === 'dir' ? '<span class="file-icon">📁</span>' : '<span class="file-icon">' + fileBadge(it.name) + '</span>';
      html += '<div class="file-row">' + icon + '<span class="file-name">' + esc(it.name) + '</span></div>';
    });
    box.innerHTML = html;
    var rows = box.querySelectorAll('.file-row');
    for (var i = 0; i < rows.length; i++) {
      (function (row, it) {
        row.onclick = function () { it.type === 'dir' ? enterDir(it) : openFile(it); };
        var t;
        row.addEventListener('touchstart', function () { t = setTimeout(function () { if (it.type !== 'dir') fileMenu(it); }, 520); });
        row.addEventListener('touchend', function () { clearTimeout(t); });
        row.addEventListener('touchmove', function () { clearTimeout(t); });
      })(rows[i], items[i]);
    }
  }

  function enterDir(item) {
    state.path = item.path || item.name;
    loadFiles();
  }

  // ================= 仓库 Tabs（README / 提交 / Issue / PR / 搜索） =================
  var REPO_TABS = [
    { key: 'files', label: '文件' },
    { key: 'readme', label: 'README' },
    { key: 'commits', label: '提交' },
    { key: 'issues', label: 'Issue' },
    { key: 'pulls', label: 'Pull' }
  ];

  function renderRepoTabs() {
    var wrap = $('repo-tabs');
    wrap.innerHTML = '';
    REPO_TABS.forEach(function (t) {
      var b = document.createElement('span');
      b.className = 'repo-tab' + (state.repoTab === t.key ? ' active' : '');
      b.textContent = t.label;
      b.onclick = function () { if (t.key === 'commits') state.commitPath = ''; setRepoTab(t.key); };
      wrap.appendChild(b);
    });
  }

  function setRepoTab(key) {
    state.repoTab = key;
    renderRepoTabs();
    REPO_TABS.forEach(function (t) {
      var p = $('pane-' + t.key);
      if (p) p.classList.toggle('hidden', t.key !== key);
    });
    if (key === 'readme') loadReadme();
    else if (key === 'commits') loadCommits(state.commitPath);
    else if (key === 'issues') loadIssues();
    else if (key === 'pulls') loadPulls();
  }

  // ---- README ----
  async function readmeMarkdown() {
    try {
      var d = await request('GET', API_BASE + '/repos/' + enc(state.repo.owner) + '/' + enc(state.repo.name) + '/readme?ref=' + encodeURIComponent(currentRef()));
      if (d && typeof d.content === 'string') return base64ToUtf8(d.content);
    } catch (e) {}
    try {
      var list = await request('GET', contentsUrl('', currentRef()));
      var readme = (Array.isArray(list) ? list : []).filter(function (f) { return f.type === 'file' && /^readme(\.md|\.markdown|\.txt)?$/i.test(f.name); })[0];
      if (readme) {
        var d2 = await request('GET', contentsUrl(readme.path, currentRef()));
        if (d2 && typeof d2.content === 'string') return base64ToUtf8(d2.content);
      }
    } catch (e) {}
    return null;
  }

  async function loadReadme() {
    if (!state.repo) return;
    var box = $('readme-content');
    try {
      var md = await readmeMarkdown();
      state.readme = md;
      if (md == null) { box.innerHTML = '<div class="empty">暂无 README</div>'; return; }
      box.innerHTML = mdToHtml(md);
      bindMdLinks(box);
    } catch (e) {
      box.innerHTML = '<div class="empty">加载 README 失败</div>';
    }
  }

  function bindMdLinks(box) {
    var webBase = 'https://gitee.com/' + enc(state.repo.owner) + '/' + enc(state.repo.name);
    var rawBase = webBase + '/raw/' + encodeURIComponent(currentRef()) + '/';
    var links = box.getElementsByTagName('a');
    for (var i = 0; i < links.length; i++) {
      (function (a) {
        a.addEventListener('click', function (e) {
          e.preventDefault();
          var h = a.getAttribute('href') || '';
          if (h.indexOf('http') !== 0) h = webBase + '/' + h.replace(/^\.\//, '');
          nativeOpenUrl(h);
        });
      })(links[i]);
    }
    var imgs = box.getElementsByTagName('img');
    for (var j = 0; j < imgs.length; j++) {
      var src = imgs[j].getAttribute('src') || '';
      if (src && src.indexOf('http') !== 0) imgs[j].setAttribute('src', rawBase + src.replace(/^\.\//, ''));
    }
  }

  function mdToHtml(md) {
    var lines = esc(String(md || '')).split('\n');
    var html = [];
    var list = null;
    var code = false;
    function endList() { if (list) { html.push('</' + list + '>'); list = null; } }
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      if (/^\s*```/.test(raw)) {
        endList();
        if (code) { html.push('</pre>'); code = false; } else { html.push('<pre>'); code = true; }
        continue;
      }
      if (code) { html.push(raw); continue; }
      var h = raw.match(/^(#{1,6})\s+(.*)$/);
      if (h) { endList(); html.push('<h' + h[1].length + '>' + inlineMd(h[2]) + '</h' + h[1].length + '>'); continue; }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(raw)) { endList(); html.push('<hr>'); continue; }
      if (/^\s*>\s?/.test(raw)) { endList(); html.push('<blockquote>' + inlineMd(raw.replace(/^\s*>\s?/, '')) + '</blockquote>'); continue; }
      var ul = raw.match(/^\s*[-*+]\s+(.*)$/);
      if (ul) { if (list !== 'ul') { endList(); html.push('<ul>'); list = 'ul'; } html.push('<li>' + inlineMd(ul[1]) + '</li>'); continue; }
      var ol = raw.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ol) { if (list !== 'ol') { endList(); html.push('<ol>'); list = 'ol'; } html.push('<li>' + inlineMd(ol[1]) + '</li>'); continue; }
      if (/^\s*$/.test(raw)) { endList(); continue; }
      endList();
      html.push('<p>' + inlineMd(raw) + '</p>');
    }
    endList();
    if (code) html.push('</pre>');
    return html.join('\n');
  }

  function inlineMd(s) {
    var t = String(s == null ? '' : s);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2">');
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*\n][^*]*)\*/g, '$1<em>$2</em>');
    return t;
  }

  // ---- 提交 ----
  async function loadCommits(path) {
    state.commitPath = path || '';
    showLoading();
    try {
      var u = repoBase() + '/commits?ref=' + encodeURIComponent(currentRef()) + '&per_page=50';
      if (state.commitPath) u += '&path=' + encodeURIComponent(state.commitPath);
      var arr = await request('GET', u);
      state.commits = Array.isArray(arr) ? arr : [];
      renderCommits();
    } catch (e) {
      state.commits = [];
      renderCommits();
      fail('加载提交失败：', e);
    } finally { hideLoading(); }
  }

  function renderCommits() {
    var box = $('commit-list');
    if (!state.commits.length) { box.innerHTML = '<div class="empty">' + (state.commitPath ? '该文件暂无提交' : '暂无提交') + '</div>'; return; }
    var html = '';
    state.commits.forEach(function (c) {
      var m = (c.commit && c.commit.message) || '';
      var first = m.split('\n')[0];
      var author = (c.commit && c.commit.author && c.commit.author.name) || (c.author && c.author.login) || (c.committer && c.committer.login) || '';
      var date = (c.commit && c.commit.author && c.commit.author.date) || '';
      html += '<div class="row-sub commit-row">' +
        '<div class="row-title">' + esc(first) + '</div>' +
        '<div class="row-meta">' + esc(author) + (date ? ' · ' + esc(fmtDate(date)) : '') + ' · ' + esc(String(c.sha || '').slice(0, 8)) + '</div>' +
      '</div>';
    });
    box.innerHTML = html;
    var rows = box.querySelectorAll('.commit-row');
    for (var i = 0; i < rows.length; i++) {
      (function (row, c) {
        row.onclick = function () { nativeOpenUrl('https://gitee.com/' + enc(state.repo.owner) + '/' + enc(state.repo.name) + '/commit/' + c.sha); };
      })(rows[i], state.commits[i]);
    }
  }

  // ---- Issue ----
  var ISSUE_STATES = [
    { key: 'open', label: '开启' },
    { key: 'closed', label: '已关闭' },
    { key: 'all', label: '全部' }
  ];
  function renderIssueFilter() {
    var wrap = $('issue-filter');
    wrap.innerHTML = '';
    ISSUE_STATES.forEach(function (s) {
      var b = document.createElement('span');
      b.className = 'subtab' + (state.issueState === s.key ? ' active' : '');
      b.textContent = s.label;
      b.onclick = function () { state.issueState = s.key; loadIssues(); };
      wrap.appendChild(b);
    });
  }
  async function loadIssues() {
    renderIssueFilter();
    showLoading();
    try {
      var q = '/issues?per_page=50&sort=updated';
      if (state.issueState !== 'all') q += '&state=' + state.issueState;
      var arr = await request('GET', repoBase() + q);
      state.issues = Array.isArray(arr) ? arr : [];
      renderIssues();
    } catch (e) {
      state.issues = [];
      renderIssues();
      fail('加载 Issue 失败：', e);
    } finally { hideLoading(); }
  }
  function renderIssues() {
    var box = $('issue-list');
    if (!state.issues.length) { box.innerHTML = '<div class="empty">暂无 Issue</div>'; return; }
    var html = '';
    state.issues.forEach(function (it) {
      var closed = it.state === 'closed';
      html += '<div class="row-sub issue-row">' +
        '<span class="issue-state' + (closed ? ' closed' : '') + '">' + (closed ? '已关闭' : '开启') + '</span>' +
        '<div class="row-title">#' + (it.number != null ? it.number : '') + ' ' + esc(it.title) + '</div>' +
        '<div class="row-meta">' + esc((it.user && it.user.login) || '') + ' · ' + esc(fmtDate(it.created_at)) + ' · 评论 ' + (it.comments || 0) + '</div>' +
      '</div>';
    });
    box.innerHTML = html;
    var rows = box.querySelectorAll('.issue-row');
    for (var i = 0; i < rows.length; i++) {
      (function (row, it) {
        row.onclick = function () { if (it.html_url) nativeOpenUrl(it.html_url); };
      })(rows[i], state.issues[i]);
    }
  }
  function newIssueModal() {
    openModal('新建 Issue',
      '<label>标题</label><input id="ni-title" type="text" placeholder="Issue 标题">' +
      '<label>描述</label><textarea id="ni-body" rows="8" placeholder="（可选）"></textarea>',
      [
        { text: '取消', cls: 'btn-plain', onClick: closeModal },
        { text: '创建', cls: 'btn-primary', onClick: async function () {
            var title = $('ni-title').value.trim();
            var body = $('ni-body').value;
            if (!title) { nativeToast('请输入标题'); return; }
            closeModal();
            showLoading();
            try {
              await request('POST', repoBase() + '/issues', { title: title, body: body });
              nativeToast('已创建');
              loadIssues();
            } catch (e) { fail('创建失败：', e); } finally { hideLoading(); }
        }}
      ]);
  }

  // ---- Pull ----
  function renderPrFilter() {
    var wrap = $('pr-filter');
    wrap.innerHTML = '';
    ISSUE_STATES.forEach(function (s) {
      var b = document.createElement('span');
      b.className = 'subtab' + (state.prState === s.key ? ' active' : '');
      b.textContent = s.label;
      b.onclick = function () { state.prState = s.key; loadPulls(); };
      wrap.appendChild(b);
    });
  }
  async function loadPulls() {
    renderPrFilter();
    showLoading();
    try {
      var q = '/pulls?per_page=50&sort=updated';
      if (state.prState !== 'all') q += '&state=' + state.prState;
      var arr = await request('GET', repoBase() + q);
      state.pulls = Array.isArray(arr) ? arr : [];
      renderPulls();
    } catch (e) {
      state.pulls = [];
      renderPulls();
      fail('加载 Pull 失败：', e);
    } finally { hideLoading(); }
  }
  function renderPulls() {
    var box = $('pull-list');
    if (!state.pulls.length) { box.innerHTML = '<div class="empty">暂无 Pull Request</div>'; return; }
    var html = '';
    state.pulls.forEach(function (it) {
      var merged = !!it.merged;
      var closed = it.state === 'closed';
      var st = merged ? '已合并' : (closed ? '已关闭' : '开启');
      html += '<div class="row-sub issue-row">' +
        '<span class="issue-state' + (merged || closed ? ' closed' : '') + '">' + st + '</span>' +
        '<div class="row-title">#' + (it.number != null ? it.number : '') + ' ' + esc(it.title) + '</div>' +
        '<div class="row-meta">' + esc((it.user && it.user.login) || '') + ' · ' + esc(fmtDate(it.created_at)) + '</div>' +
      '</div>';
    });
    box.innerHTML = html;
    var rows = box.querySelectorAll('.issue-row');
    for (var i = 0; i < rows.length; i++) {
      (function (row, it) {
        row.onclick = function () { if (it.html_url) nativeOpenUrl(it.html_url); };
      })(rows[i], state.pulls[i]);
    }
  }

  // ---- 标签 ----
  async function loadTags() {
    try {
      var arr = await request('GET', repoBase() + '/tags');
      state.tags = Array.isArray(arr) ? arr : [];
    } catch (e) { state.tags = []; }
    renderTagSelect();
  }
  function renderTagSelect() {
    var sel = $('tag-select');
    sel.innerHTML = '';
    var none = document.createElement('option');
    none.value = '';
    none.textContent = '（无）';
    sel.appendChild(none);
    state.tags.forEach(function (t) {
      var op = document.createElement('option');
      op.value = t.name;
      op.textContent = t.name;
      sel.appendChild(op);
    });
    sel.value = '';
  }

  // ---- 代码搜索（文件名全库 + 当前目录内容） ----
  function toggleCodeSearch() {
    var bar = $('code-searchbar');
    bar.classList.toggle('hidden');
    if (!bar.classList.contains('hidden')) { setRepoTab('files'); $('code-query').focus(); }
    else if (state.searchMode) { state.searchMode = false; loadFiles(); }
  }
  async function runCodeSearch() {
    var q = $('code-query').value.trim();
    if (!q) { nativeToast('请输入搜索内容'); return; }
    showLoading();
    try {
      var results = [];
      try {
        var t = await request('GET', repoBase() + '/git/trees/' + encodeURIComponent(currentRef()) + '?recursive=1');
        var tree = (t && t.tree) || (Array.isArray(t) ? t : []);
        tree.forEach(function (n) {
          if (n && n.type === 'blob' && String(n.path || '').toLowerCase().indexOf(q.toLowerCase()) >= 0) results.push({ path: n.path, kind: 'name' });
        });
      } catch (e) {}
      var files = state.files.filter(function (f) { return f.type === 'file'; });
      for (var i = 0; i < files.length && i < 30; i++) {
        try {
          var d = await request('GET', contentsUrl(files[i].path));
          var txt = base64ToUtf8(d && d.content);
          if (txt.toLowerCase().indexOf(q.toLowerCase()) >= 0 && !results.some(function (r) { return r.path === files[i].path && r.kind === 'content'; })) {
            results.push({ path: files[i].path, kind: 'content' });
          }
        } catch (e) {}
      }
      state.searchResults = results.slice(0, 100);
      renderSearchResults(q);
    } catch (e) {
      state.searchResults = [];
      renderSearchResults(q);
      fail('搜索失败：', e);
    } finally { hideLoading(); }
  }

  function renderSearchResults(q) {
    state.searchMode = true;
    var bc = $('breadcrumb');
    bc.innerHTML = '';
    var a = document.createElement('span');
    a.className = 'crumb';
    a.textContent = '搜索 · ' + q;
    bc.appendChild(a);
    var clr = document.createElement('span');
    clr.className = 'crumb';
    clr.textContent = '✕ 清除';
    clr.onclick = function () { state.searchMode = false; $('code-searchbar').classList.add('hidden'); $('code-query').value = ''; loadFiles(); };
    bc.appendChild(clr);
    var box = $('file-list');
    if (!state.searchResults.length) { box.innerHTML = '<div class="empty">无结果</div>'; return; }
    var html = '';
    state.searchResults.forEach(function (r) {
      html += '<div class="file-row"><span class="file-icon">' + fileBadge(r.path) + '</span><span class="file-name">' + esc(r.path) + '</span></div>';
    });
    box.innerHTML = html;
    var rows = box.querySelectorAll('.file-row');
    for (var i = 0; i < rows.length; i++) {
      (function (row, r) {
        row.onclick = function () { openSearchResult(r); };
      })(rows[i], state.searchResults[i]);
    }
  }

  async function openSearchResult(r) {
    var p = r && r.path;
    if (!p) return;
    var parts = String(p).split('/');
    var dir = parts.slice(0, -1).join('/');
    state.path = dir;
    state.searchMode = false;
    $('code-searchbar').classList.add('hidden');
    $('code-query').value = '';
    await loadFiles();
    openFile({ path: p, name: parts[parts.length - 1], type: 'file' });
  }

  // ---- 重命名 / 历史 / 复制内容 ----
  function renameItem(item) {
    var parts = String(item.path || item.name).split('/');
    var oldDir = parts.slice(0, -1).join('/');
    var oldName = parts[parts.length - 1];
    openModal('重命名文件',
      '当前：<b>' + esc(item.path) + '</b>' +
      '<label>新名称 / 新路径</label><input id="rn-name" type="text" value="' + esc(oldName) + '" placeholder="新文件名或完整新路径">',
      [
        { text: '取消', cls: 'btn-plain', onClick: closeModal },
        { text: '重命名', cls: 'btn-primary', onClick: async function () {
            var v = $('rn-name').value.trim();
            if (!v) { nativeToast('请输入新名称'); return; }
            var newRel = v.indexOf('/') >= 0 ? v : (oldDir ? oldDir + '/' + v : v);
            if (newRel === (item.path || item.name)) { closeModal(); return; }
            closeModal();
            showLoading();
            try {
              await doRename(item.path || item.name, newRel);
              nativeToast('已重命名');
              state.path = oldDir;
              await loadFiles();
            } catch (e) { fail('重命名失败：', e); } finally { hideLoading(); }
        }}
      ]);
  }
  async function doRename(oldPath, newPath) {
    var d = await request('GET', contentsUrl(oldPath));
    var content = (d && d.content) || '';
    var msg = '重命名 ' + oldPath + ' 到 ' + newPath;
    await request('POST', contentsUrl(newPath), { content: content, message: msg, branch: state.branch });
    var sha = (d && d.sha) || '';
    await request('DELETE', contentsUrl(oldPath) + '&message=' + encodeURIComponent(msg) + '&sha=' + encodeURIComponent(sha));
  }
  function fileHistory(item) {
    setRepoTab('commits');
    loadCommits(item.path || item.name);
  }
  async function copyContent(item) {
    showLoading();
    try {
      var d = await request('GET', contentsUrl(item.path || item.name));
      var txt = base64ToUtf8(d && d.content);
      nativeCopy(txt);
      nativeToast('已复制文件内容');
    } catch (e) { fail('复制失败：', e); } finally { hideLoading(); }
  }

  // ================= 文件查看 / 编辑 =================
  async function openFile(item) {
    showLoading();
    try {
      var data = await request('GET', contentsUrl(item.path));
      state.file = {
        path: item.path,
        name: item.name,
        sha: (data && data.sha) || '',
        size: (data && data.size) || 0,
        content: base64ToUtf8(data && data.content)
      };
      showView('file');
      renderFile();
    } catch (e) {
      fail('读取文件失败：', e);
    } finally {
      hideLoading();
    }
  }

  function renderFile() {
    $('file-name').textContent = state.file.name;
    $('file-size').textContent = humanSize(state.file.size);
    var c = $('file-content');
    var content = state.file.content || '';
    exitEditMode();
    if (looksBinary(content)) {
      $('file-edit').classList.add('hidden');
      c.innerHTML = '<div class="binary-note">二进制文件，无法预览<br><br><button class="btn-mini" onclick="window.__dlCurrent()">下载到本地</button></div>';
    } else {
      $('file-edit').classList.remove('hidden');
      var shown = content;
      var cap = '';
      if (content.length > 200000) { shown = content.slice(0, 200000); cap = '<div class="cap-note">内容过长，仅显示前 200KB</div>'; }
      c.innerHTML = cap + renderCode(shown);
    }
  }

  function renderCode(src) {
    var lines = src.split('\n');
    var out = ['<pre class="code">'];
    for (var i = 0; i < lines.length; i++) {
      out.push('<div class="ln"><span class="lnn">' + (i + 1) + '</span><span class="lnc">' + (highlightLine(lines[i]) || '&nbsp;') + '</span></div>');
    }
    out.push('</pre>');
    return out.join('');
  }

  function highlightLine(line) {
    var html = '';
    var i = 0, n = line.length, start = 0;
    while (i < n) {
      if (line[i] === '/' && line[i + 1] === '/') {
        html += esc(line.slice(start, i));
        html += '<span class="tok-com">' + esc(line.slice(i)) + '</span>';
        return html;
      }
      if (line[i] === '/' && line[i + 1] === '*') {
        var end = line.indexOf('*/', i + 2);
        end = end >= 0 ? end + 2 : n;
        html += esc(line.slice(start, i));
        html += '<span class="tok-com">' + esc(line.slice(i, end)) + '</span>';
        start = end; i = end;
        continue;
      }
      var ch = line[i];
      if (ch === '"' || ch === "'") {
        var j = i + 1;
        while (j < n) {
          if (line[j] === '\\') { j += 2; continue; }
          if (line[j] === ch) { j++; break; }
          j++;
        }
        html += esc(line.slice(start, i));
        html += '<span class="tok-str">' + esc(line.slice(i, j)) + '</span>';
        start = j; i = j;
        continue;
      }
      i++;
    }
    html += esc(line.slice(start));
    return html;
  }

  function enterEditMode() {
    $('file-editbar').classList.remove('hidden');
    $('file-content').innerHTML = '<textarea id="file-edit-ta" class="editor" spellcheck="false"></textarea>';
    $('file-edit-ta').value = state.file.content || '';
  }

  function exitEditMode() {
    $('file-editbar').classList.add('hidden');
  }

  async function saveFile() {
    var content = $('file-edit-ta').value;
    var msg = $('commit-msg').value.trim() || ('更新 ' + state.file.name);
    showLoading();
    try {
      await request('PUT', contentsUrl(state.file.path), {
        content: utf8ToBase64(content),
        message: msg,
        sha: state.file.sha,
        branch: state.branch
      });
      nativeToast('已保存');
      var item = { path: state.file.path, name: state.file.name };
      await openFile(item);
    } catch (e) {
      fail('保存失败：', e);
    } finally {
      hideLoading();
    }
  }

  // ================= 下载 =================
  window.__dlCurrent = async function () {
    if (!state.file) return;
    await downloadPath(state.file.path, state.file.name);
  };

  async function downloadItem(item) {
    await downloadPath(item.path, item.name);
  }

  async function downloadPath(path, name) {
    showLoading();
    try {
      // 优先用 contents 接口的 base64 内容（走 access_token，私库/文件最稳定）
      var rInfo = await request('GET', contentsUrl(path));
      if (rInfo && typeof rInfo.content === 'string' && rInfo.content) {
        var r1 = await saveBase64(rInfo.content, name);
        if (r1 && r1.ok) { nativeToast('已保存：' + r1.path); return; }
        if (r1 && r1.error) { fail('下载失败：', new Error(r1.error)); return; }
      }
      // 回退：raw 直链（大文件 / 二进制可能没有 content 字段）
      var r2 = await downloadFile(rawUrl(path), name);
      if (r2 && r2.ok) nativeToast('已保存：' + r2.path);
      else fail('下载失败：', new Error((r2 && r2.error) || '网络错误'));
    } catch (e) {
      fail('下载失败：', e);
    } finally {
      hideLoading();
    }
  }

  // ================= 弹窗 =================
  function openModal(title, bodyHtml, actions) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = bodyHtml || '';
    var act = $('modal-actions');
    act.innerHTML = '';
    (actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.className = 'btn ' + (a.cls || '');
      b.textContent = a.text;
      b.onclick = a.onClick;
      act.appendChild(b);
    });
    $('modal-mask').classList.remove('hidden');
  }
  function closeModal() { $('modal-mask').classList.add('hidden'); }

  function fail(prefix, e) {
    var msg = prefix + ((e && typeof e.message === 'string' && e.message) ? e.message : String(e == null ? '' : e));
    openModal('出错了',
      '<div class="err-box">' + esc(msg) + '</div>',
      [
        { text: '复制', cls: 'btn-plain', onClick: function () { nativeCopy(msg); } },
        { text: '关闭', cls: 'btn-primary', onClick: closeModal }
      ]);
  }

  // ================= 文件操作 =================
  function fileMenu(item) {
    openModal(item.name,
      '<div class="menu-list">' +
        '<div class="menu-item" data-a="edit">编辑</div>' +
        '<div class="menu-item" data-a="download">下载</div>' +
        '<div class="menu-item" data-a="copy">复制内容</div>' +
        '<div class="menu-item" data-a="history">文件历史</div>' +
        '<div class="menu-item" data-a="path">复制路径</div>' +
        '<div class="menu-item" data-a="rename">重命名</div>' +
        '<div class="menu-item danger" data-a="del">删除</div>' +
      '</div>',
      [{ text: '关闭', cls: 'btn-plain', onClick: closeModal }]);
    var items = $('modal-body').querySelectorAll('.menu-item');
    for (var i = 0; i < items.length; i++) {
      (function (el) {
        el.onclick = function () {
          var a = el.getAttribute('data-a');
          closeModal();
          if (a === 'edit') openFile(item);
          else if (a === 'download') downloadItem(item);
          else if (a === 'copy') copyContent(item);
          else if (a === 'history') fileHistory(item);
          else if (a === 'path') nativeCopy(item.path);
          else if (a === 'rename') renameItem(item);
          else if (a === 'del') deleteItem(item);
        };
      })(items[i]);
    }
  }

  function deleteItem(item) {
    openModal('删除文件',
      '确定删除 <b>' + esc(item.path) + '</b> ？' +
      '<input id="del-msg" type="text" placeholder="提交信息（可选）">',
      [
        { text: '取消', cls: 'btn-plain', onClick: closeModal },
        {
          text: '删除', cls: 'btn-danger',
          onClick: async function () {
            var msg = $('del-msg').value.trim() || ('删除 ' + item.path);
            closeModal();
            showLoading();
            try {
              var sha = '';
              try { var d = await request('GET', contentsUrl(item.path)); sha = (d && d.sha) || ''; } catch (e) {}
              var delUrl = contentsUrl(item.path) + '&message=' + encodeURIComponent(msg) + '&sha=' + encodeURIComponent(sha);
              await request('DELETE', delUrl, null);
              nativeToast('已删除');
              showView('repo');
              loadFiles();
            } catch (e) {
              fail('删除失败：', e);
            } finally {
              hideLoading();
            }
          }
        }
      ]);
  }

  function newFileModal() {
    var dir = state.path ? state.path + '/' : '';
    openModal('新建文件',
      '<label>路径（相对当前目录）</label><input id="nf-path" type="text" placeholder="如 src/App.java">' +
      '<label>内容</label><textarea id="nf-content" rows="10"></textarea>' +
      '<label>提交信息</label><input id="nf-msg" type="text" placeholder="新建文件">',
      [
        { text: '取消', cls: 'btn-plain', onClick: closeModal },
        {
          text: '创建', cls: 'btn-primary',
          onClick: async function () {
            var rel = $('nf-path').value.trim();
            var content = $('nf-content').value;
            var msg = $('nf-msg').value.trim() || ('新建 ' + rel);
            if (!rel) { nativeToast('请输入文件名'); return; }
            closeModal();
            showLoading();
            try {
              await request('POST', contentsUrl(dir + rel), {
                content: utf8ToBase64(content),
                message: msg,
                branch: state.branch
              });
              nativeToast('已创建');
              loadFiles();
            } catch (e) {
              fail('创建失败：', e);
            } finally {
              hideLoading();
            }
          }
        }
      ]);
  }

  async function uploadFile() {
    try {
      var f = await pickFile();
      if (!f || !f.ok) { if (f && f.error && f.error !== 'cancelled') fail('选择文件失败：', new Error(f.error || '无法读取所选文件')); return; }
      showLoading();
      var rel = (state.path ? state.path + '/' : '') + f.name;
      await createOrUpdateFile(rel, f.base64, '上传 ' + f.name);
      nativeToast('已上传');
      loadFiles();
    } catch (e) {
      fail('上传失败：', e);
    } finally {
      hideLoading();
    }
  }

  async function createOrUpdateFile(rel, contentB64, message) {
    var url = contentsUrl(rel);
    var existing = null;
    try { existing = await request('GET', url); } catch (e) { existing = null; }
    if (existing && existing.sha) {
      return await request('PUT', url, { content: contentB64, message: message, sha: existing.sha, branch: state.branch });
    }
    return await request('POST', url, { content: contentB64, message: message, branch: state.branch });
  }

  // ================= 仓库菜单 / 新建 / 删除 =================
  function repoMenu(repo) {
    openModal(repo.full_name,
      '<div class="menu-list">' +
        '<div class="menu-item" data-a="browser">在浏览器打开</div>' +
        '<div class="menu-item" data-a="clone">复制克隆地址</div>' +
        '<div class="menu-item danger" data-a="del">删除仓库</div>' +
      '</div>',
      [{ text: '关闭', cls: 'btn-plain', onClick: closeModal }]);
    var items = $('modal-body').querySelectorAll('.menu-item');
    for (var i = 0; i < items.length; i++) {
      (function (el) {
        el.onclick = function () {
          var a = el.getAttribute('data-a');
          closeModal();
          if (a === 'browser') nativeOpenUrl(repo.html_url);
          else if (a === 'clone') nativeCopy('https://gitee.com/' + repoOwner(repo) + '/' + repoName(repo) + '.git');
          else if (a === 'del') deleteRepoFlow(repo);
        };
      })(items[i]);
    }
  }

  function deleteRepoFlow(repo) {
    openModal('删除仓库',
      '确定删除仓库 <b>' + esc(repo.full_name) + '</b> ？此操作不可恢复。<br>输入仓库名确认：' +
      '<input id="dr-name" type="text" placeholder="' + esc(repo.name) + '">',
      [
        { text: '取消', cls: 'btn-plain', onClick: closeModal },
        {
          text: '删除', cls: 'btn-danger',
          onClick: async function () {
            var v = $('dr-name').value.trim();
            if (v !== repo.name) { nativeToast('仓库名不一致'); return; }
            closeModal();
            showLoading();
            try {
              await request('DELETE', API_BASE + '/repos/' + encodeURIComponent(repoOwner(repo)) + '/' + encodeURIComponent(repoName(repo)));
              nativeToast('已删除');
              loadRepos(state.repoFilter, true);
            } catch (e) {
              fail('删除失败：', e);
            } finally {
              hideLoading();
            }
          }
        }
      ]);
  }

  function newRepoModal() {
    openModal('新建仓库',
      '<label>仓库名称（仅限字母 / 数字 / - _ .）</label><input id="nr-name" type="text" placeholder="my-repo">' +
      '<label>描述</label><input id="nr-desc" type="text" placeholder="（可选）">' +
      '<label class="chk"><input type="checkbox" id="nr-private"> 私有仓库</label>' +
      '<label class="chk"><input type="checkbox" id="nr-init"> 初始化 README</label>' +
      '<label>语言（用于 .gitignore，可选）</label><input id="nr-gi" type="text" placeholder="如 Java / Python">',
      [
        { text: '取消', cls: 'btn-plain', onClick: closeModal },
        {
          text: '创建', cls: 'btn-primary',
          onClick: async function () {
            var name = $('nr-name').value.trim();
            var desc = $('nr-desc').value.trim();
            var priv = $('nr-private').checked;
            var init = $('nr-init').checked;
            var gi = $('nr-gi').value.trim();
            if (!name) { nativeToast('请输入仓库名'); return; }
            closeModal();
            showLoading();
            try {
              var body = { name: name, description: desc, private: priv, auto_init: init };
              if (gi) body.gitignore_template = gi;
              await request('POST', API_BASE + '/user/repos', body);
              nativeToast('已创建');
              loadRepos(state.repoFilter, true);
            } catch (e) {
              fail('创建失败：', e);
            } finally {
              hideLoading();
            }
          }
        }
      ]);
  }

  // ================= 事件绑定 =================
  function bind() {
    $('login-btn').onclick = async function () {
      var token = $('login-token').value.trim();
      if (!token) { $('login-msg').textContent = '请填写私人令牌'; return; }
      $('login-msg').textContent = '';
      try { Android.saveAuth('', '', token); } catch (e) {}
      loadAuth();
      await tryLogin(false);
    };

    $('get-token-btn').onclick = function () {
      nativeOpenUrl('https://gitee.com/profile/personal_access_tokens');
    };

    $('btn-theme').onclick = toggleTheme;

    $('btn-logout').onclick = function () {
      openModal('退出登录', '确定退出当前账号吗？',
        [
          { text: '取消', cls: 'btn-plain', onClick: closeModal },
          { text: '退出', cls: 'btn-danger', onClick: function () {
              closeModal();
              try { Android.clearAuth(); } catch (e) {}
              state.user = null;
              state.repoList = [];
              $('login-token').value = '';
              showView('login');
          }}
        ]);
    };

    $('btn-new-repo').onclick = newRepoModal;

    $('search-btn').onclick = function () {
      var q = $('search-input').value.trim();
      if (!q) { state.searching = false; loadRepos(state.repoFilter, true); return; }
      state.searching = true;
      state.searchQuery = q;
      loadRepos(state.repoFilter, true);
    };
    $('search-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') $('search-btn').onclick();
    });

    $('repo-back').onclick = function () { showView('home'); };
    $('repo-star').onclick = toggleStar;
    $('repo-menu').onclick = function () { repoMenu(state.repo); };
    $('repo-search-toggle').onclick = toggleCodeSearch;
    $('repo-refresh').onclick = function () { loadBranches(); loadTags(); loadFiles(); loadReadme(); };
    $('branch-select').onchange = function () { state.branch = this.value; state.ref = this.value; loadFiles(); loadReadme(); };
    $('tag-select').onchange = function () { state.ref = this.value || state.branch; loadFiles(); loadReadme(); };
    $('code-search-btn').onclick = runCodeSearch;
    $('code-query').addEventListener('keydown', function (e) { if (e.key === 'Enter') runCodeSearch(); });
    $('new-issue-btn').onclick = newIssueModal;
    $('fab-new-file').onclick = newFileModal;
    $('fab-upload').onclick = uploadFile;

    $('file-back').onclick = function () { showView('repo'); };
    $('file-download').onclick = window.__dlCurrent;
    $('file-edit').onclick = enterEditMode;
    $('file-del').onclick = function () { deleteItem({ path: state.file.path, name: state.file.name }); };
    $('file-save').onclick = saveFile;

    $('modal-mask').onclick = function (e) { if (e.target === this) closeModal(); };
  }

  // ================= 初始化 =================
  function init() {
    bind();
    applyTheme();
    loadAuth();
    var b = $('boot');
    if (b) b.classList.add('hidden');
    // 回填登录框
    $('login-token').value = state.token || '';
    if (state.cookie || state.token) {
      tryLogin(true);
    } else {
      showView('login');
    }
  }

  init();
})();
