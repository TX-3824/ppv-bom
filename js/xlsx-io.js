/*
 * 纯前端 .xlsx 读取/写入（基于 JSZip，不依赖网络CDN）
 * 支持导入：sheet名/表头/数据行；支持导出：合法可打开的 xlsx
 */
window.XLSXIO = (function () {
  'use strict';

  var NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  var NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

  function xmlDoc(str) {
    return new DOMParser().parseFromString(str, 'application/xml');
  }

  function colToIdx(ref) {
    var m = String(ref).match(/[A-Z]+/);
    if (!m) return 0;
    var idx = 0;
    for (var i = 0; i < m[0].length; i++) {
      idx = idx * 26 + (m[0].charCodeAt(i) - 64);
    }
    return idx - 1;
  }

  function rowToIdx(ref) {
    var m = String(ref).match(/\d+/);
    return m ? parseInt(m[0], 10) - 1 : 0;
  }

  function txt(elem) {
    var s = '';
    if (elem) {
      var nodes = elem.getElementsByTagNameNS('*', 't');
      for (var i = 0; i < nodes.length; i++) s += nodes[i].textContent || '';
    }
    return s;
  }

  async function parseWorkbook(arrayBuffer) {
    var zip = await JSZip.loadAsync(arrayBuffer);
    var wbXml = zip.file('xl/workbook.xml');
    if (!wbXml) throw new Error('不是有效的 .xlsx 文件（缺少 workbook.xml）');
    var wbDoc = xmlDoc(await wbXml.async('string'));

    var sheetEls = Array.prototype.slice.call(wbDoc.getElementsByTagNameNS('*', 'sheet'));
    var relMap = {};
    var relsFile = zip.file('xl/_rels/workbook.xml.rels');
    if (relsFile) {
      var relsDoc = xmlDoc(await relsFile.async('string'));
      var rels = relsDoc.getElementsByTagNameNS('*', 'Relationship');
      for (var i = 0; i < rels.length; i++) {
        relMap[rels[i].getAttribute('Id')] = rels[i].getAttribute('Target');
      }
    }

    var shared = [];
    var ssFile = zip.file('xl/sharedStrings.xml');
    if (ssFile) {
      var ssDoc = xmlDoc(await ssFile.async('string'));
      var sis = ssDoc.getElementsByTagNameNS('*', 'si');
      for (var j = 0; j < sis.length; j++) shared.push(txt(sis[j]));
    }

    var result = [];
    for (var s = 0; s < sheetEls.length; s++) {
      var meta = sheetEls[s];
      var name = meta.getAttribute('name') || ('Sheet' + (s + 1));
      var rid = meta.getAttributeNS(NS_REL, 'id');
      var target = (rid && relMap[rid]) || ('worksheets/sheet' + (s + 1) + '.xml');
      if (target.indexOf('/') === 0) target = target.slice(1);
      if (target.indexOf('xl/') !== 0) target = 'xl/' + target;
      var wsFile = zip.file(target);
      if (!wsFile) continue;

      var wsDoc = xmlDoc(await wsFile.async('string'));
      var sheetData = wsDoc.getElementsByTagNameNS('*', 'sheetData')[0];
      if (!sheetData) continue;
      var grid = [];
      var rows = sheetData.getElementsByTagNameNS('*', 'row');
      for (var r = 0; r < rows.length; r++) {
        var ri = rowToIdx(rows[r].getAttribute('r') || '1');
        var cells = rows[r].getElementsByTagNameNS('*', 'c');
        for (var c = 0; c < cells.length; c++) {
          var ref = cells[c].getAttribute('r');
          if (!ref) continue;
          var ci = colToIdx(ref);
          var t = cells[c].getAttribute('t') || 'n';
          var val = null;
          var vEl = cells[c].getElementsByTagNameNS('*', 'v')[0];
          if (t === 's') {
            if (vEl) {
              var idx = parseInt(vEl.textContent, 10);
              val = shared[idx] != null ? shared[idx] : '';
            }
          } else if (t === 'inlineStr') {
            val = txt(cells[c].getElementsByTagNameNS('*', 'is')[0]);
          } else if (t === 'str') {
            val = vEl ? vEl.textContent : '';
          } else if (t === 'b') {
            val = vEl && vEl.textContent === '1' ? 'TRUE' : 'FALSE';
          } else if (t === 'e') {
            val = '#ERROR';
          } else if (vEl) {
            var sText = vEl.textContent;
            if (sText !== '' && !isNaN(Number(sText)) && sText.trim() !== '') {
              val = sText.indexOf('.') >= 0 ? parseFloat(sText) : parseInt(sText, 10);
            } else {
              val = sText;
            }
          }
          if (val == null) continue;
          if (!grid[ri]) grid[ri] = [];
          grid[ri][ci] = val;
        }
      }

      var maxR = grid.length;
      var maxC = 0;
      for (var g = 0; g < maxR; g++) {
        if (grid[g]) maxC = Math.max(maxC, grid[g].length);
      }
      var headerRow = -1;
      for (var h = 0; h < maxR; h++) {
        var row = grid[h] || [];
        var filled = 0;
        for (var k = 0; k < row.length; k++) {
          if (row[k] != null && String(row[k]).trim() !== '') filled++;
        }
        if (filled >= 2) { headerRow = h; break; }
      }
      if (headerRow < 0) headerRow = 0;

      var headers = [];
      var hr = grid[headerRow] || [];
      for (var hh = 0; hh < maxC; hh++) {
        headers.push(hr[hh] == null ? '' : String(hr[hh]).trim());
      }
      while (headers.length && headers[headers.length - 1] === '') headers.pop();

      var dataRows = [];
      for (var dr = headerRow + 1; dr < maxR; dr++) {
        var src = grid[dr] || [];
        var rec = [];
        for (var cc = 0; cc < headers.length; cc++) {
          rec.push(src[cc] == null ? null : src[cc]);
        }
        while (rec.length && (rec[rec.length - 1] === null || rec[rec.length - 1] === '')) rec.pop();
        var hasVal = false;
        for (var vv = 0; vv < rec.length; vv++) {
          if (rec[vv] != null && String(rec[vv]).trim() !== '') { hasVal = true; break; }
        }
        if (hasVal) dataRows.push(rec);
      }
      result.push({ name: name, headers: headers, rows: dataRows });
    }
    return result;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function colRef(i) {
    var s = '';
    i = i + 1;
    while (i > 0) {
      var rem = (i - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }

  function sheetCellXml(col, row, val) {
    var ref = colRef(col) + (row + 1);
    if (val == null || val === '') return null;
    if (typeof val === 'number') {
      return '<c r="' + ref + '"><v>' + val + '</v></c>';
    }
    return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + esc(String(val)) + '</t></is></c>';
  }

  function safeSheetName(name) {
    var n = String(name || 'Sheet').replace(/[\\\/\?\*\[\]:]/g, '_').slice(0, 31);
    return n || 'Sheet';
  }

  function buildWorkbook(sheets) {
    var contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>';

    var rootRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="' + NS_PKG_REL + '">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    var sheetXmlParts = [];
    var sheetNames = [];
    for (var i = 0; i < sheets.length; i++) {
      var s = sheets[i];
      sheetNames.push(safeSheetName(s.name));
      var xmlRows = [];
      var allRows = [s.headers].concat(s.rows);
      for (var r = 0; r < allRows.length; r++) {
        var src = allRows[r] || [];
        var cells = [];
        for (var c = 0; c < s.headers.length; c++) {
          var xml = sheetCellXml(c, r, src[c] == null ? null : src[c]);
          if (xml) cells.push(xml);
        }
        xmlRows.push('<row r="' + (r + 1) + '">' + cells.join('') + '</row>');
      }
      sheetXmlParts.push(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="' + NS_MAIN + '" xmlns:xml="http://www.w3.org/XML/1998/namespace">' +
        '<sheetData>' + xmlRows.join('') + '</sheetData>' +
        '</worksheet>'
      );
    }

    var workbookXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="' + NS_MAIN + '" xmlns:r="' + NS_REL + '">' +
      '<sheets>' +
      sheetNames.map(function (n, i) {
        return '<sheet name="' + esc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      }).join('') +
      '</sheets></workbook>';

    var wbRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="' + NS_PKG_REL + '">' +
      sheetNames.map(function (n, i) {
        return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      }).join('') +
      '<Relationship Id="rId' + (sheetNames.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';

    var stylesXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="' + NS_MAIN + '">' +
      '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
      '<borders count="1"><border/></borders>' +
      '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
      '<cellXfs count="1"><xf/></cellXfs>' +
      '</styleSheet>';

    var zip = new JSZip();
    zip.file('[Content_Types].xml', contentTypes);
    zip.file('_rels/.rels', rootRels);
    zip.file('xl/workbook.xml', workbookXml);
    zip.file('xl/_rels/workbook.xml.rels', wbRels);
    zip.file('xl/styles.xml', stylesXml);
    for (var si = 0; si < sheetXmlParts.length; si++) {
      zip.file('xl/worksheets/sheet' + (si + 1) + '.xml', sheetXmlParts[si]);
    }
    return zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      compression: 'DEFLATE'
    });
  }

  return {
    parseWorkbook: parseWorkbook,
    buildWorkbook: buildWorkbook
  };
})();
