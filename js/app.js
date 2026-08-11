(function () {
  'use strict';

  var STORE_KEY = 'ppv_bom_store_v1';
  var DATA = null;
  var currentSheet = null;

  var caches = new WeakMap();

  function $(sel) { return document.querySelector(sel); }

  function norm(s) {
    return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9\u4E00-\u9FA5]/g, '');
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  function colIdx(sheet, names) {
    var headers = sheet.headers || [];
    for (var i = 0; i < headers.length; i++) {
      var h = norm(headers[i]);
      for (var j = 0; j < names.length; j++) {
        if (h === norm(names[j])) return i;
      }
    }
    return -1;
  }

  function getVal(sheet, row, names) {
    var i = colIdx(sheet, names);
    return i < 0 ? null : (row[i] == null ? null : row[i]);
  }

  function sheetCache(sheet, kind) {
    var c = caches.get(sheet);
    if (!c) { c = {}; caches.set(sheet, c); }
    if (!c[kind]) {
      var col = kind === 'parts' ? colIdx(sheet, ['零件号'])
        : kind === 'stations' ? colIdx(sheet, ['工位'])
        : kind === 'modes' ? colIdx(sheet, ['上线方式', '上料方式'])
        : colIdx(sheet, ['物料属性']);
      c[kind] = buildCache(sheet, col, kind);
    }
    return c[kind];
  }

  function buildCache(sheet, col, kind) {
    var map = new Map();
    for (var r = 0; r < sheet.rows.length; r++) {
      var raw = sheet.rows[r][col];
      if (raw == null) continue;
      var s = String(raw).trim();
      if (!s) continue;
      if (kind === 'parts') {
        if (!map.has(norm(s))) map.set(norm(s), s);
      } else {
        map.set(norm(s), s);
      }
    }
    var arr = [];
    map.forEach(function (v, k) { arr.push({ np: k, raw: v }); });
    arr.sort(function (a, b) { return b.raw.length - a.raw.length; });
    return arr;
  }

  /* ---------------- 数据 ---------------- */

  function loadData() {
    var stored = null;
    try { stored = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { stored = null; }
    if (stored && stored.sheets && stored.sheets.length) {
      DATA = stored;
    } else if (window.PPV_BOM_DATA) {
      DATA = window.PPV_BOM_DATA;
    } else {
      DATA = { sheets: [] };
    }
  }

  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(DATA)); } catch (e) { /* 存储满或不可用 */ }
  }

  /* ---------------- 页面 ---------------- */

  function showView(name) {
    var views = document.querySelectorAll('.view');
    for (var i = 0; i < views.length; i++) views[i].classList.remove('active');
    $('#view-' + name).classList.add('active');
    window.scrollTo(0, 0);
    if (name === 'home') refreshHome();
    if (name === 'query') enterQuery();
    if (name === 'ai') enterAI();
  }

  function refreshHome() {
    var sel = $('#sheet-select');
    var prev = sel.value;
    sel.innerHTML = '';
    for (var i = 0; i < DATA.sheets.length; i++) {
      var opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = DATA.sheets[i].name;
      sel.appendChild(opt);
    }
    if (prev && DATA.sheets[Number(prev)]) sel.value = prev;
    var total = 0;
    DATA.sheets.forEach(function (s) { total += s.rows.length; });
    $('#total-info').textContent = '当前共 ' + DATA.sheets.length + ' 个BOM表 · ' + total + ' 条数据';
  }

  function enterQuery() {
    if (!currentSheet) {
      var i = Number($('#sheet-select').value);
      currentSheet = DATA.sheets[i] || DATA.sheets[0];
    }
    $('#query-sheet-name').textContent = currentSheet.name;
    $('#search-result').innerHTML = '';
    $('#part-input').value = '';
    $('#part-input').focus();
  }

  function enterAI() {
    $('#ai-sheet-name').textContent = currentSheet ? currentSheet.name : '';
    $('#ai-answer').innerHTML = '';
    renderExamples();
  }

  /* ---------------- 零件查询 ---------------- */

  function doSearch() {
    var q = $('#part-input').value.trim();
    if (!q) { toast('请输入零件号'); return; }
    var nq = norm(q);
    if (nq.length < 2) { toast('至少输入 2 个字符'); return; }
    if (!currentSheet) { toast('请先在首页选择BOM表'); return; }
    var pi = colIdx(currentSheet, ['零件号']);
    if (pi < 0) { toast('当前表没有“零件号”列'); return; }

    var matches = [];
    for (var r = 0; r < currentSheet.rows.length; r++) {
      var raw = currentSheet.rows[r][pi];
      if (raw == null) continue;
      var np = norm(raw);
      var pos = np.indexOf(nq);
      if (pos >= 0) {
        matches.push({ r: r, raw: String(raw), np: np, pos: pos, exact: np === nq, pi: pi });
      }
    }
    matches.sort(function (a, b) {
      return (b.exact - a.exact) || (a.pos - b.pos) || (a.np.length - b.np.length);
    });
    renderResults(q, matches, matches.length);
  }

  function renderResults(q, matches, total) {
    var box = $('#search-result');
    if (!matches.length) {
      box.innerHTML = '<div class="empty-tip">未找到与“' + esc(q) + '”匹配的零件号<br>请检查输入，或确认是否选择了正确的BOM表</div>';
      return;
    }
    var limit = 300;
    var shown = matches.slice(0, limit);
    var html = '<div class="result-head">共找到 <b>' + total + '</b> 条';
    if (total > limit) html += '（显示前 ' + limit + ' 条）';
    html += '</div>';
    var rx = new RegExp(escRegex(q), 'i');
    for (var i = 0; i < shown.length; i++) {
      var row = currentSheet.rows[shown[i].r];
      var partHtml = esc(shown[i].raw).replace(rx, function (m) { return '<mark>' + esc(m) + '</mark>'; });
      html += '<div class="result-card">';
      var headers = currentSheet.headers;
      for (var h = 0; h < headers.length; h++) {
        var val = row[h];
        if (val == null || String(val).trim() === '') continue;
        var vHtml = (h === shown[i].pi ? partHtml : esc(String(val)));
        html += '<div class="result-row"><span class="k">' + esc(headers[h]) + '</span><span class="v">' + vHtml + '</span></div>';
      }
      html += '</div>';
    }
    box.innerHTML = html;
  }

  /* ---------------- AI 问答 ---------------- */

  var EXAMPLES = [
    '该BOM一共有多少零件号条目数',
    '该BOM以物料属性分类，各物料属性各有多少条目数',
    '该BOM中SAP和专用件各有多少条目数',
    '该BOM中零件共涉及多少个工位，具体工位有哪些',
    '该BOM中上线方式为部装超市料架有多少条目数',
    '该BOM中上线方式为产线流利架有多少条目数',
    '该BOM中上线方式为翻DOLLY平板有多少条目数',
    '该BOM中上线方式为拣配小车上线有多少条目数',
    '该BOM中上线方式为线旁小料盒有多少条目数',
    '该BOM中哪些零件号有变化点备注，备注信息分别是什么',
    '某零件号的零件名称是什么',
    '某零件号的物料属性是什么',
    '某零件号是专用件还是SAP件',
    '某零件号的安装工位有哪些',
    '某零件号的上料方式是什么',
    '某零件号的手工BOM储位是什么',
    '某工位需安装哪些零件号，共计多少条目数',
    '某工位以物料属性分类，各物料属性各有多少条目数',
    '某工位以上线方式分类，各上线方式各有多少条目数'
  ];

  function firstPartRaw(sheet) {
    var pi = colIdx(sheet, ['零件号']);
    if (pi < 0) return 'S00068381+02';
    for (var i = 0; i < sheet.rows.length; i++) {
      if (sheet.rows[i][pi] != null && String(sheet.rows[i][pi]).trim()) return String(sheet.rows[i][pi]).trim();
    }
    return 'S00068381+02';
  }

  function firstStationRaw(sheet) {
    var si = colIdx(sheet, ['工位']);
    if (si < 0) return '2010';
    for (var i = 0; i < sheet.rows.length; i++) {
      if (sheet.rows[i][si] != null && String(sheet.rows[i][si]).trim()) return String(sheet.rows[i][si]).trim();
    }
    return '2010';
  }

  function renderExamples() {
    var box = $('#example-list');
    var fp = firstPartRaw(currentSheet);
    var fs = firstStationRaw(currentSheet);
    box.innerHTML = '';
    EXAMPLES.forEach(function (tpl) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'example-chip';
      var display = tpl;
      if (tpl.indexOf('某零件号') >= 0) display = tpl.split('某零件号').join(fp);
      if (tpl.indexOf('某工位') >= 0) display = tpl.split('某工位').join(fs + '工位');
      chip.textContent = display;
      chip.addEventListener('click', function () {
        $('#ai-input').value = display;
        doAsk();
      });
      box.appendChild(chip);
    });
  }

  function extractPart(q, sheet) {
    var parts = sheetCache(sheet, 'parts');
    if (!parts.length) return null;
    var tokens = q.split(/[^A-Za-z0-9]+/).filter(function (t) { return /[A-Za-z0-9]/.test(t); }).map(norm);
    var cands = new Set();
    for (var win = tokens.length; win >= 1; win--) {
      for (var i = 0; i + win <= tokens.length; i++) {
        cands.add(tokens.slice(i, i + win).join(''));
      }
    }
    var sorted = Array.from(cands).filter(function (c) { return /\d/.test(c) && c.length >= 4; })
      .sort(function (a, b) { return b.length - a.length; });
    for (var k = 0; k < sorted.length; k++) {
      for (var p = 0; p < parts.length; p++) {
        if (parts[p].np.indexOf(sorted[k]) >= 0 || sorted[k].indexOf(parts[p].np) >= 0) {
          return parts[p];
        }
      }
    }
    return null;
  }

  function extractStation(q, sheet) {
    var stations = sheetCache(sheet, 'stations');
    var nq = norm(q);
    for (var i = 0; i < stations.length; i++) {
      if (nq.indexOf(stations[i].np) >= 0) return stations[i].raw;
    }
    return null;
  }

  function groupCounts(sheet, names) {
    var idx = colIdx(sheet, names);
    var m = new Map();
    for (var r = 0; r < sheet.rows.length; r++) {
      var v = sheet.rows[r][idx];
      var key = v == null || String(v).trim() === '' ? '(空)' : String(v).trim();
      m.set(key, (m.get(key) || 0) + 1);
    }
    var arr = Array.from(m.entries()).sort(function (a, b) { return b[1] - a[1]; });
    return arr;
  }

  function fmtGroups(arr, unit) {
    return arr.map(function (kv) { return kv[0] + '：' + kv[1] + ' ' + unit; }).join('\n');
  }

  function partRows(sheet, np) {
    var pi = colIdx(sheet, ['零件号']);
    var out = [];
    for (var r = 0; r < sheet.rows.length; r++) {
      if (sheet.rows[r][pi] != null && norm(sheet.rows[r][pi]) === np) out.push(sheet.rows[r]);
    }
    return out;
  }

  function uniqVals(rows, names) {
    var idx = colIdx(currentSheet, names);
    if (idx < 0) return [];
    var seen = [];
    rows.forEach(function (row) {
      var v = row[idx];
      if (v == null || String(v).trim() === '') return;
      var s = String(v).trim();
      if (seen.indexOf(s) < 0) seen.push(s);
    });
    return seen;
  }

  function partSummaryText(pn, sheet) {
    var rows = partRows(sheet, pn.np);
    if (!rows.length) return '未找到零件号：' + pn.raw;
    var lines = [];
    lines.push('零件号：' + pn.raw);
    var name = uniqVals(rows, ['零件名称']);
    if (name.length) lines.push('零件名称：' + name.join('、'));
    var mat = uniqVals(rows, ['物料属性']);
    if (mat.length) lines.push('物料属性：' + mat.join('、'));
    var sap = uniqVals(rows, ['SAP件/专用件']);
    if (sap.length) lines.push('SAP件/专用件：' + sap.join('、'));
    var qty = uniqVals(rows, ['装配数量', '单机用量']);
    if (qty.length) lines.push('装配数量：' + qty.join('、'));
    var station = uniqVals(rows, ['工位']);
    if (station.length) lines.push('工位：' + station.join('、'));
    var mode = uniqVals(rows, ['上线方式', '上料方式']);
    if (mode.length) lines.push('上线方式：' + mode.join('、'));
    var store = uniqVals(rows, ['手工BOM储位']);
    if (store.length) lines.push('手工BOM储位：' + store.join('、'));
    var rm = uniqVals(rows, ['变化点备注']);
    if (rm.length) lines.push('变化点备注：' + rm.join('、'));
    if (lines.length === 1) lines.push('该零件号暂无其他明细信息');
    return lines.join('\n');
  }

  function answerAI(question, sheet) {
    var q = String(question || '').trim();
    var nq = norm(q);
    if (!q) return '请输入问题。';
    if (nq.indexOf('某零件号') >= 0) return '请把“某零件号”替换成具体零件号，例如 ' + firstPartRaw(sheet) + '，再提问。';
    if (nq.indexOf('某工位') >= 0) return '请把“某工位”替换成具体工位号，例如 ' + firstStationRaw(sheet) + '，再提问。';

    var pn = extractPart(q, sheet);
    var st = extractStation(q, sheet);

    var hasStationWord = nq.indexOf('工位') >= 0;
    var isStationQuery = st && (
      nq.indexOf('需安装') >= 0 || nq.indexOf('安装哪些') >= 0 || nq.indexOf('以物料属性分类') >= 0 ||
      nq.indexOf('以' + '上线方式分类') >= 0 || nq.indexOf('上料方式分类') >= 0
    );

    if (isStationQuery) {
      return stationAnswer(q, nq, st, sheet);
    }

    if (pn) {
      return partQuestionAnswer(q, nq, pn, sheet);
    }

    // ---- 整表统计 ----
    if (nq.indexOf('零件号') >= 0 && nq.indexOf('条目') >= 0 && (nq.indexOf('一共') >= 0 || nq.indexOf('总共') >= 0 || nq.indexOf('总数') >= 0)) {
      return 'BOM表：' + sheet.name + '\n总条目数：' + sheet.rows.length + ' 条\n唯一零件号：' + sheetCache(sheet, 'parts').length + ' 个';
    }
    if (nq.indexOf('物料属性') >= 0 && nq.indexOf('分类') >= 0) {
      return '物料属性分布（共 ' + sheet.rows.length + ' 条）：\n' + fmtGroups(groupCounts(sheet, ['物料属性']), '条');
    }
    if (nq.indexOf('SAP') >= 0 && nq.indexOf('专用件') >= 0 && nq.indexOf('各') >= 0) {
      return 'SAP件/专用件分布（共 ' + sheet.rows.length + ' 条）：\n' + fmtGroups(groupCounts(sheet, ['SAP件/专用件']), '条');
    }
    if (hasStationWord && nq.indexOf('多少个') >= 0 && (nq.indexOf('具体') >= 0 || nq.indexOf('涉及') >= 0)) {
      var sts = sheetCache(sheet, 'stations');
      return '共涉及 ' + sts.length + ' 个工位：\n' + sts.map(function (s) { return s.raw; }).join('、');
    }
    if ((nq.indexOf('上线方式') >= 0 || nq.indexOf('上料方式') >= 0) && (nq.indexOf('多少') >= 0 || nq.indexOf('几条') >= 0)) {
      return modeCountAnswer(q, nq, sheet);
    }
    if (nq.indexOf('变化点备注') >= 0 && (nq.indexOf('哪些') >= 0 || nq.indexOf('什么') >= 0)) {
      return remarkAnswer(sheet);
    }
    if (nq.indexOf('上线方式') >= 0 || nq.indexOf('上料方式') >= 0) {
      return modeCountAnswer(q, nq, sheet);
    }

    return '暂未理解该问题，可参考下方示例提问：\n· 该BOM一共有多少零件号条目数\n· ' + firstPartRaw(sheet) + '的零件名称是什么\n· ' + firstStationRaw(sheet) + '工位需安装哪些零件号';
  }

  function stationAnswer(q, nq, st, sheet) {
    var si = colIdx(sheet, ['工位']);
    var rows = [];
    for (var r = 0; r < sheet.rows.length; r++) {
      if (sheet.rows[r][si] != null && norm(sheet.rows[r][si]) === norm(st)) rows.push(sheet.rows[r]);
    }
    if (nq.indexOf('需安装') >= 0 || nq.indexOf('安装哪些') >= 0) {
      var pi = colIdx(sheet, ['零件号']);
      var seen = [];
      rows.forEach(function (row) {
        var v = row[pi];
        if (v == null) return;
        var s = String(v).trim();
        if (seen.indexOf(s) < 0) seen.push(s);
      });
      var head = '工位 ' + st + ' 共 ' + rows.length + ' 条条目、' + seen.length + ' 个零件号：';
      var list = seen.slice(0, 60).join('\n');
      if (seen.length > 60) list += '\n…等共 ' + seen.length + ' 个';
      return head + '\n' + list;
    }
    if (nq.indexOf('物料属性') >= 0 && nq.indexOf('分类') >= 0) {
      var m = new Map();
      var mi = colIdx(sheet, ['物料属性']);
      rows.forEach(function (row) {
        var v = row[mi];
        var key = v == null || String(v).trim() === '' ? '(空)' : String(v).trim();
        m.set(key, (m.get(key) || 0) + 1);
      });
      var arr = Array.from(m.entries()).sort(function (a, b) { return b[1] - a[1]; });
      return '工位 ' + st + ' 物料属性分布（共 ' + rows.length + ' 条）：\n' + fmtGroups(arr, '条');
    }
    var modeArr = [];
    var moi = colIdx(sheet, ['上线方式', '上料方式']);
    var mm = new Map();
    rows.forEach(function (row) {
      var v = row[moi];
      var key = v == null || String(v).trim() === '' ? '(空)' : String(v).trim();
      mm.set(key, (mm.get(key) || 0) + 1);
    });
    modeArr = Array.from(mm.entries()).sort(function (a, b) { return b[1] - a[1]; });
    return '工位 ' + st + ' 上线方式分布（共 ' + rows.length + ' 条）：\n' + fmtGroups(modeArr, '条');
  }

  function partQuestionAnswer(q, nq, pn, sheet) {
    var rows = partRows(sheet, pn.np);
    if (nq.indexOf('零件名称') >= 0) {
      var name = uniqVals(rows, ['零件名称']);
      return '零件号 ' + pn.raw + ' 的零件名称：' + (name.join('、') || '（无）');
    }
    if (nq.indexOf('物料属性') >= 0) {
      var mat = uniqVals(rows, ['物料属性']);
      return '零件号 ' + pn.raw + ' 的物料属性：' + (mat.join('、') || '（无）');
    }
    if ((nq.indexOf('SAP') >= 0 || nq.indexOf('专用件') >= 0) && (nq.indexOf('还是') >= 0 || nq.indexOf('是什么') >= 0)) {
      var sap = uniqVals(rows, ['SAP件/专用件']);
      return '零件号 ' + pn.raw + ' 属于：' + (sap.join('、') || '（无）');
    }
    if (nq.indexOf('工位') >= 0) {
      var sts = uniqVals(rows, ['工位']);
      return '零件号 ' + pn.raw + ' 的安装工位：' + (sts.join('、') || '（无）');
    }
    if (nq.indexOf('上料方式') >= 0 || nq.indexOf('上线方式') >= 0) {
      var mode = uniqVals(rows, ['上线方式', '上料方式']);
      return '零件号 ' + pn.raw + ' 的上料方式：' + (mode.join('、') || '（无）');
    }
    if (nq.indexOf('储位') >= 0) {
      var store = uniqVals(rows, ['手工BOM储位']);
      return '零件号 ' + pn.raw + ' 的手工BOM储位：' + (store.join('、') || '（无）');
    }
    return partSummaryText(pn, sheet);
  }

  function modeCountAnswer(q, nq, sheet) {
    var modes = sheetCache(sheet, 'modes');
    var target = null;
    var m = q.match(/为\s*([^，。,。！？!?有共多少]+)/);
    if (m) {
      var rawVal = m[1].trim();
      var nv = norm(rawVal);
      var exact = null;
      var contains = null;
      for (var i = 0; i < modes.length; i++) {
        if (nv && modes[i].np === nv) { exact = modes[i].raw; break; }
        if (nv && (modes[i].np.indexOf(nv) >= 0 || nv.indexOf(modes[i].np) >= 0)) {
          if (!contains || modes[i].raw.length < contains.length) contains = modes[i].raw;
        }
      }
      target = exact || contains;
      if (!target && rawVal && nv.length >= 2) target = rawVal;
    }
    var all = groupCounts(sheet, ['上线方式', '上料方式']);
    if (target) {
      var found = all.filter(function (kv) { return kv[0] === target || norm(kv[0]) === norm(target); });
      if (found.length) {
        return '上线方式“' + target + '”共有 ' + found[0][1] + ' 条条目';
      }
      return '未找到上线方式“' + target + '”。当前BOM上线方式分布：\n' + fmtGroups(all, '条');
    }
    return '当前BOM上线方式分布（共 ' + sheet.rows.length + ' 条）：\n' + fmtGroups(all, '条');
  }

  function remarkAnswer(sheet) {
    var pi = colIdx(sheet, ['零件号']);
    var ri = colIdx(sheet, ['变化点备注']);
    var list = [];
    for (var r = 0; r < sheet.rows.length; r++) {
      var rm = sheet.rows[r][ri];
      if (rm != null && String(rm).trim()) {
        list.push(String(sheet.rows[r][pi] == null ? '' : sheet.rows[r][pi]).trim() + ' → ' + String(rm).trim());
      }
    }
    if (!list.length) return '当前BOM（' + sheet.name + '）没有变化点备注。';
    var head = '当前BOM共有 ' + list.length + ' 条变化点备注：';
    return head + '\n' + list.slice(0, 50).join('\n') + (list.length > 50 ? '\n…共 ' + list.length + ' 条' : '');
  }

  function doAsk() {
    var q = $('#ai-input').value.trim();
    if (!q) { toast('请输入问题'); return; }
    if (!currentSheet) { toast('请先在首页选择BOM表'); return; }
    var t0 = performance.now();
    var ans = answerAI(q, currentSheet);
    var ms = (performance.now() - t0).toFixed(1);
    var box = $('#ai-answer');
    box.innerHTML =
      '<div class="ai-ans-head"><span>AI回复</span><span class="ms">用时 ' + ms + ' 毫秒</span></div>' +
      '<pre class="ai-ans-text">' + esc(ans) + '</pre>' +
      '<div class="ai-ans-head" style="margin-top:6px"><span></span><button class="ai-ans-copy" id="btn-copy-ans" type="button">复制答案</button></div>';
    $('#btn-copy-ans').addEventListener('click', function () {
      var ta = document.createElement('textarea');
      ta.value = ans;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('答案已复制'); } catch (e) { toast('复制失败，请手动选择复制'); }
      document.body.removeChild(ta);
    });
  }

  /* ---------------- 语音输入 ---------------- */

  function bindMic(btnSel, inputSel, onFinal) {
    var btn = $(btnSel);
    var input = $(inputSel);
    if (!btn || !input) return;
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      btn.title = '当前浏览器不支持语音输入';
      return;
    }
    btn.addEventListener('click', function () {
      if (btn.classList.contains('listening')) {
        try { rec.stop(); } catch (e) { /* ignore */ }
        return;
      }
      var rec = new SR();
      rec.lang = 'zh-CN';
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.continuous = false;
      var active = false;
      rec.onstart = function () {
        active = true;
        btn.classList.add('listening');
        toast('正在聆听，请说话…');
      };
      rec.onresult = function (e) {
        var interim = '';
        var final = '';
        for (var i = 0; i < e.results.length; i++) {
          var t = e.results[i][0].transcript;
          if (e.results[i].isFinal) final += t; else interim += t;
        }
        input.value = final || interim;
      };
      rec.onend = function () {
        btn.classList.remove('listening');
        if (active && input.value.trim()) onFinal();
      };
      rec.onerror = function (e) {
        btn.classList.remove('listening');
        if (e.error === 'not-allowed') toast('麦克风权限被拒绝，请允许后重试');
        else if (e.error !== 'aborted') toast('语音识别失败：' + e.error);
      };
      try { rec.start(); } catch (e) { /* ignore */ }
    });
  }

  /* ---------------- 导入 / 导出 ---------------- */

  function handleImport(file) {
    var status = $('#import-status');
    status.textContent = '正在解析 ' + file.name + ' …';
    file.arrayBuffer()
      .then(XLSXIO.parseWorkbook)
      .then(function (sheets) {
        if (!sheets.length) throw new Error('未解析到有效sheet');
        var added = [];
        sheets.forEach(function (s) {
          var idx = -1;
          for (var i = 0; i < DATA.sheets.length; i++) {
            if (DATA.sheets[i].name === s.name) { idx = i; break; }
          }
          if (idx >= 0) DATA.sheets[idx] = s; else DATA.sheets.push(s);
          added.push(s.name + '（' + s.rows.length + '条）');
        });
        persist();
        refreshHome();
        status.textContent = '导入成功：' + added.join('、') + '。已加入首页下拉框。';
        toast('导入成功：' + added.join('、'));
      })
      .catch(function (err) {
        status.textContent = '导入失败：' + err.message;
        toast('导入失败，请确认是 .xlsx 文件');
      });
  }

  function handleExport() {
    if (!currentSheet) { toast('请先选择BOM表'); return; }
    var t0 = performance.now();
    XLSXIO.buildWorkbook([currentSheet])
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = currentSheet.name + '-BOM.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
        toast('已导出 ' + a.download + '（' + currentSheet.rows.length + '条）');
      })
      .catch(function (err) {
        toast('导出失败：' + err.message);
      });
  }

  /* ---------------- 事件绑定 ---------------- */

  function bindEvents() {
    $('#btn-enter').addEventListener('click', function () {
      var i = Number($('#sheet-select').value);
      currentSheet = DATA.sheets[i] || DATA.sheets[0];
      if (!currentSheet) { toast('暂无BOM数据'); return; }
      showView('query');
    });

    document.querySelectorAll('.back').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = btn.getAttribute('data-goto');
        if (target === 'home') currentSheet = null;
        showView(target);
      });
    });

    $('#btn-search').addEventListener('click', doSearch);
    $('#part-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
    });

    $('#btn-goto-ai').addEventListener('click', function () {
      if (!currentSheet) { toast('请先选择BOM表'); return; }
      showView('ai');
    });
    $('#btn-ask').addEventListener('click', doAsk);
    $('#ai-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doAsk(); }
    });

    $('#btn-export').addEventListener('click', handleExport);

    $('#file-input').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      handleImport(f);
      e.target.value = '';
    });

    $('#btn-reset').addEventListener('click', function () {
      if (!confirm('确定恢复为初始BOM数据吗？导入的数据将被清除。')) return;
      try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
      loadData();
      refreshHome();
      toast('已恢复初始数据');
    });

    bindMic('#btn-mic-search', '#part-input', doSearch);
    bindMic('#btn-mic-ai', '#ai-input', doAsk);
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    loadData();
    refreshHome();
    bindEvents();
    showView('home');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
