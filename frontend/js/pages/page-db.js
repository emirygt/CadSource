// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
//  DB SAYFASI
// ══════════════════════════════════════════════════════════════════════════════
const dbState = {
  files: [],
  isZip: false,
  archiveEntries: [],
  archivePreviewErrors: [],
  archivePreviewLoading: false,
  archivePreviewReqId: 0,
  uploadQueue: [],
  page: 1,
  perPage: 20,
  total: 0,
  search: '',
  searchTimer: null,
  uploading: false,
  previewUrls: [],
  dropPreviewUrl: null,
  selectedIds: new Set(),
  pageIds: [],
};

const productsState = {
  draft: {
    page: 1,
    perPage: 20,
    total: 0,
    search: '',
    searchTimer: null,
    selectedIds: new Set(),
    pageIds: [],
  },
  approved: {
    page: 1,
    perPage: 20,
    total: 0,
    search: '',
    searchTimer: null,
    selectedIds: new Set(),
    pageIds: [],
  },
};

function updateDbApprovalSelectionUi() {
  const selected = dbState.selectedIds.size;
  const info = document.getElementById('dbSelectedApproveInfo');
  const applyBtn = document.getElementById('dbApplyStatusBtn');
  const reindexBtn = document.getElementById('dbReindexBtn');
  if (info) info.textContent = `${selected} ${t('common.selected')}`;
  if (applyBtn) applyBtn.disabled = selected === 0;
  if (reindexBtn) reindexBtn.disabled = selected === 0;

  const allBox = document.getElementById('dbSelectAll');
  if (!allBox) return;
  const pageIds = dbState.pageIds;
  if (!pageIds.length) {
    allBox.checked = false;
    allBox.indeterminate = false;
    return;
  }
  const hit = pageIds.filter(id => dbState.selectedIds.has(id)).length;
  allBox.checked = hit === pageIds.length;
  allBox.indeterminate = hit > 0 && hit < pageIds.length;
}

function toggleDbSelect(fileId, checked) {
  const id = Number(fileId);
  if (!id) return;
  if (checked) dbState.selectedIds.add(id);
  else dbState.selectedIds.delete(id);
  updateDbApprovalSelectionUi();
}

function toggleDbSelectAll(checked) {
  dbState.pageIds.forEach(id => {
    if (checked) dbState.selectedIds.add(id);
    else dbState.selectedIds.delete(id);
  });
  updateDbApprovalSelectionUi();
  dbState.pageIds.forEach(id => {
    const el = document.getElementById(`dbSel_${id}`);
    if (el) el.checked = checked;
  });
}

function isDbImageFile(file) {
  return /\.(jpg|jpeg|png)$/i.test(file.name || '');
}

function resetDbDropIndicator() {
  const drop = document.getElementById('dbDrop');
  const title = document.getElementById('dbDropTitle');
  const sub = document.getElementById('dbDropSub');
  const preview = document.getElementById('dbDropPreview');
  const previewImg = document.getElementById('dbDropPreviewImg');
  const previewName = document.getElementById('dbDropPreviewName');
  drop.classList.remove('loaded');
  title.textContent = t('db.drop_title');
  sub.textContent = t('db.drop_sub');
  preview.style.display = 'none';
  previewImg.removeAttribute('src');
  previewName.textContent = '';
  if (dbState.dropPreviewUrl) {
    URL.revokeObjectURL(dbState.dropPreviewUrl);
    dbState.dropPreviewUrl = null;
  }
}

function setDbDropIndicator(files, isZip) {
  resetDbDropIndicator();
  if (!files.length) return;

  const drop = document.getElementById('dbDrop');
  const title = document.getElementById('dbDropTitle');
  const sub = document.getElementById('dbDropSub');
  const preview = document.getElementById('dbDropPreview');
  const previewImg = document.getElementById('dbDropPreviewImg');
  const previewName = document.getElementById('dbDropPreviewName');

  drop.classList.add('loaded');
  title.textContent = `${files.length} ${currentLang === 'tr' ? 'dosya seçildi' : 'file(s) selected'}`;
  sub.textContent = isZip ? (currentLang === 'tr' ? 'Arşiv seçildi, içindeki dosyalar yüklenecek' : 'Archive selected, files inside will be uploaded') : t('db.upload_btn');

  if (!isZip) {
    const imageFile = files.find(isDbImageFile);
    if (imageFile) {
      dbState.dropPreviewUrl = URL.createObjectURL(imageFile);
      previewImg.src = dbState.dropPreviewUrl;
      previewName.textContent = imageFile.name;
      preview.style.display = 'block';
    }
  }
}

function clearDbImagePreview() {
  dbState.previewUrls.forEach(url => URL.revokeObjectURL(url));
  dbState.previewUrls = [];
  const wrap = document.getElementById('dbImagePreview');
  const grid = document.getElementById('dbImagePreviewGrid');
  if (grid) grid.innerHTML = '';
  if (wrap) wrap.style.display = 'none';
}

function renderDbImagePreview(files) {
  clearDbImagePreview();
  const images = files.filter(isDbImageFile);
  if (!images.length) return;

  const wrap = document.getElementById('dbImagePreview');
  const grid = document.getElementById('dbImagePreviewGrid');
  if (!wrap || !grid) return;

  const MAX_PREVIEW = 6;
  images.slice(0, MAX_PREVIEW).forEach(file => {
    const url = URL.createObjectURL(file);
    dbState.previewUrls.push(url);

    const item = document.createElement('div');
    item.className = 'db-image-preview-item';

    const img = document.createElement('img');
    img.className = 'db-image-preview-thumb';
    img.src = url;
    img.alt = file.name;
    item.appendChild(img);

    const name = document.createElement('div');
    name.className = 'db-image-preview-name';
    name.textContent = file.name;
    item.appendChild(name);

    grid.appendChild(item);
  });

  if (images.length > MAX_PREVIEW) {
    const more = document.createElement('div');
    more.className = 'db-image-preview-item';
    more.innerHTML = `<div class="db-image-preview-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--text2)">+${images.length - MAX_PREVIEW}</div>`;
    const name = document.createElement('div');
    name.className = 'db-image-preview-name';
    name.textContent = 'daha fazla';
    more.appendChild(name);
    grid.appendChild(more);
  }

  wrap.style.display = 'block';
}

// Drag & drop
function dbDragOver(e) { e.preventDefault(); document.getElementById('dbDrop').classList.add('drag'); }
function dbDragLeave() { document.getElementById('dbDrop').classList.remove('drag'); }
function dbDropped(e) {
  e.preventDefault(); dbDragLeave();
  dbFilesSelected({ target: { files: e.dataTransfer.files } });
}

function dbFmtBytes(n) {
  const size = Number(n || 0);
  if (size <= 0) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function dbQueueLabel(status) {
  if (status === 'uploading') return 'Yükleniyor';
  if (status === 'uploaded') return 'Yüklendi';
  if (status === 'error') return 'Hata';
  return 'Sırada';
}

function renderDbArchivePreview() {
  const wrap = document.getElementById('dbArchivePreview');
  const list = document.getElementById('dbArchiveList');
  const count = document.getElementById('dbArchiveCount');
  if (!wrap || !list || !count) return;

  if (!dbState.isZip) {
    wrap.style.display = 'none';
    list.innerHTML = '';
    count.textContent = '';
    return;
  }

  wrap.style.display = 'block';
  list.innerHTML = '';

  if (dbState.archivePreviewLoading) {
    count.textContent = t('common.reading');
    const item = document.createElement('div');
    item.className = 'db-archive-item';
    item.innerHTML = `<span class="db-archive-name">Arşiv içeriği okunuyor...</span><span class="db-archive-meta">Bekleyin</span>`;
    list.appendChild(item);
    return;
  }

  count.textContent = `${dbState.archiveEntries.length} dosya`;
  if (!dbState.archiveEntries.length) {
    const item = document.createElement('div');
    item.className = 'db-archive-item';
    item.innerHTML = `<span class="db-archive-name">Desteklenen dosya bulunamadı.</span><span class="db-archive-meta">DXF/DWG/PDF/JPG/PNG</span>`;
    list.appendChild(item);
  } else {
    dbState.archiveEntries.forEach(entry => {
      const row = document.createElement('div');
      row.className = 'db-archive-item';

      const name = document.createElement('span');
      name.className = 'db-archive-name';
      name.textContent = entry.name;

      const meta = document.createElement('span');
      meta.className = 'db-archive-meta';
      meta.textContent = `${entry.archive} • ${dbFmtBytes(entry.size)}`;

      row.appendChild(name);
      row.appendChild(meta);
      list.appendChild(row);
    });
  }

  dbState.archivePreviewErrors.forEach(err => {
    const row = document.createElement('div');
    row.className = 'db-archive-item';

    const name = document.createElement('span');
    name.className = 'db-archive-name';
    name.textContent = `${err.archive}: arşiv okunamadı`;

    const meta = document.createElement('span');
    meta.className = 'db-archive-meta';
    meta.textContent = err.reason || 'Hata';

    row.appendChild(name);
    row.appendChild(meta);
    list.appendChild(row);
  });
}

function renderDbUploadQueue() {
  const wrap = document.getElementById('dbUploadQueue');
  if (!wrap) return;
  if (!dbState.uploadQueue.length) {
    wrap.style.display = 'none';
    wrap.innerHTML = '';
    return;
  }

  wrap.style.display = 'block';
  wrap.innerHTML = '';

  dbState.uploadQueue.forEach(item => {
    const row = document.createElement('div');
    row.className = 'db-upload-queue-item';

    const left = document.createElement('div');
    left.className = 'db-uq-left';

    const name = document.createElement('div');
    name.className = 'db-uq-name';
    name.textContent = item.filename;
    left.appendChild(name);

    const sub = document.createElement('div');
    sub.className = 'db-uq-archive';
    if (item.status === 'error' && item.detail) {
      sub.textContent = item.detail;
    } else if (item.archive) {
      sub.textContent = item.archive;
    } else {
      sub.textContent = 'Doğrudan yükleme';
    }
    left.appendChild(sub);

    const status = document.createElement('span');
    status.className = `db-uq-status ${item.status || 'queued'}`;
    status.textContent = dbQueueLabel(item.status);

    row.appendChild(left);
    row.appendChild(status);
    wrap.appendChild(row);
  });
}

function initDbUploadQueueFromSelection() {
  if (dbState.isZip) {
    if (dbState.archiveEntries.length > 0) {
      dbState.uploadQueue = dbState.archiveEntries.map((entry, idx) => ({
        id: `arc-${idx}-${entry.archive}-${entry.name}`,
        filename: entry.name,
        archive: entry.archive,
        status: 'queued',
        detail: '',
      }));
    } else {
      // Önizleme henüz yoksa arşiv bazlı fallback satırı göster.
      dbState.uploadQueue = dbState.files.map((f, idx) => ({
        id: `arcfallback-${idx}-${f.name}`,
        filename: f.name,
        archive: '',
        status: 'queued',
        detail: '',
      }));
    }
  } else {
    dbState.uploadQueue = dbState.files.map((f, idx) => ({
      id: `direct-${idx}-${f.name}`,
      filename: f.name,
      archive: '',
      fileRef: f,
      status: 'queued',
      detail: '',
    }));
  }
  renderDbUploadQueue();
}

function markQueueUploadingForArchive(archiveName) {
  dbState.uploadQueue.forEach(item => {
    if (item.archive === archiveName && item.status === 'queued') {
      item.status = 'uploading';
      item.detail = '';
    }
  });
  renderDbUploadQueue();
}

function applyArchiveResultToQueue(archiveName, errors = []) {
  const errCount = {};
  const errReason = {};
  errors.forEach(err => {
    const key = String(err?.filename || '').trim();
    if (!key) return;
    errCount[key] = (errCount[key] || 0) + 1;
    if (!errReason[key]) errReason[key] = String(err?.reason || 'İşlenemedi');
  });

  dbState.uploadQueue.forEach(item => {
    if (item.archive !== archiveName) return;
    if (item.status !== 'uploading' && item.status !== 'queued') return;
    const key = item.filename;
    if ((errCount[key] || 0) > 0) {
      item.status = 'error';
      item.detail = errReason[key] || 'İşlenemedi';
      errCount[key] -= 1;
    } else {
      item.status = 'uploaded';
      item.detail = '';
    }
  });
  renderDbUploadQueue();
}

function markArchiveQueueAsError(archiveName, reason) {
  dbState.uploadQueue.forEach(item => {
    if (item.archive !== archiveName) return;
    if (item.status === 'uploaded' || item.status === 'error') return;
    item.status = 'error';
    item.detail = reason || 'İşlenemedi';
  });
  renderDbUploadQueue();
}

function markDirectBatchUploading(batch) {
  batch.forEach(file => {
    const item = dbState.uploadQueue.find(q => q.fileRef === file);
    if (!item) return;
    item.status = 'uploading';
    item.detail = '';
  });
  renderDbUploadQueue();
}

function applyDirectBatchResult(batch, errors = []) {
  const errCount = {};
  const errReason = {};
  errors.forEach(err => {
    const key = String(err?.filename || '').trim();
    if (!key) return;
    errCount[key] = (errCount[key] || 0) + 1;
    if (!errReason[key]) errReason[key] = String(err?.reason || 'İşlenemedi');
  });

  batch.forEach(file => {
    const item = dbState.uploadQueue.find(q => q.fileRef === file);
    if (!item) return;
    const key = file.name;
    if ((errCount[key] || 0) > 0) {
      item.status = 'error';
      item.detail = errReason[key] || 'İşlenemedi';
      errCount[key] -= 1;
    } else {
      item.status = 'uploaded';
      item.detail = '';
    }
  });
  renderDbUploadQueue();
}

function markDirectBatchAsError(batch, reason) {
  batch.forEach(file => {
    const item = dbState.uploadQueue.find(q => q.fileRef === file);
    if (!item) return;
    if (item.status === 'uploaded' || item.status === 'error') return;
    item.status = 'error';
    item.detail = reason || 'İşlenemedi';
  });
  renderDbUploadQueue();
}

async function loadArchivePreviewForSelectedFiles() {
  const reqId = ++dbState.archivePreviewReqId;
  dbState.archivePreviewLoading = true;
  dbState.archiveEntries = [];
  dbState.archivePreviewErrors = [];
  renderDbArchivePreview();

  const entries = [];
  const errors = [];
  await ensureApiBase(true);

  for (const archiveFile of dbState.files) {
    const fd = new FormData();
    fd.append('file', archiveFile);
    try {
      const r = await fetch(`${API}/index/archive/preview`, { method: 'POST', headers: authH(), body: fd });
      if (r.status === 401) { logout(); return; }
      const data = await parseApiJsonResponse(r, `${archiveFile.name} arşiv önizlemesi alınamadı`);
      (data.entries || []).forEach(en => {
        entries.push({
          archive: archiveFile.name,
          name: String(en.name || ''),
          ext: String(en.ext || ''),
          size: Number(en.size || 0),
        });
      });
    } catch (err) {
      errors.push({
        archive: archiveFile.name,
        reason: err?.message || 'Arşiv okunamadı',
      });
    }
  }

  // Kullanıcı bu arada farklı dosya seçtiyse eski sonucu uygulama.
  if (reqId !== dbState.archivePreviewReqId) return;

  dbState.archivePreviewLoading = false;
  dbState.archiveEntries = entries;
  dbState.archivePreviewErrors = errors;
  renderDbArchivePreview();
  initDbUploadQueueFromSelection();
}

async function dbFilesSelected(e) {
  const rawFiles = Array.from(e.target.files);
  const zips = rawFiles.filter(f => /\.(zip|rar)$/i.test(f.name));
  const cads = rawFiles.filter(f => /\.(dwg|dxf|pdf|jpg|jpeg|png)$/i.test(f.name));

  // ZIP ve CAD aynı anda seçilmesin
  if (zips.length > 0 && cads.length > 0) {
    resetDbDropIndicator();
    clearDbImagePreview();
    dbState.archiveEntries = [];
    dbState.archivePreviewErrors = [];
    dbState.archivePreviewLoading = false;
    dbState.uploadQueue = [];
    renderDbArchivePreview();
    renderDbUploadQueue();
    alert('Arşiv (ZIP/RAR) ile DWG/DXF/PDF dosyalarını aynı anda seçemezsiniz. Sadece arşiv veya sadece CAD dosyaları seçin.');
    document.getElementById('dbFileInput').value = '';
    return;
  }

  const all = zips.length > 0 ? zips : cads;
  dbState.files = all;
  dbState.isZip = zips.length > 0;

  const sel = document.getElementById('dbSelectedFiles');
  const chips = document.getElementById('dbFileChips');
  const btn = document.getElementById('dbUploadBtn');
  const clearBtn = document.getElementById('dbClearBtn');
  if (all.length === 0) {
    resetDbDropIndicator();
    clearDbImagePreview();
    dbState.archiveEntries = [];
    dbState.archivePreviewErrors = [];
    dbState.archivePreviewLoading = false;
    dbState.uploadQueue = [];
    renderDbArchivePreview();
    renderDbUploadQueue();
    sel.style.display = 'none';
    btn.disabled = true;
    clearBtn.style.display = 'none';
    return;
  }

  const label = dbState.isZip
    ? `${all.length} arşiv seçildi (ZIP/RAR — içindeki CAD dosyaları indexlenecek)`
    : `${all.length} dosya seçildi`;
  document.getElementById('dbSelectedCount').textContent = label;
  chips.innerHTML = all.slice(0, 30).map(f => `<span class="db-file-chip">${f.name}</span>`).join('')
    + (all.length > 30 ? `<span class="db-file-chip">+${all.length-30} daha</span>` : '');
  sel.style.display = 'block';
  setDbDropIndicator(all, dbState.isZip);
  btn.disabled = dbState.isZip;
  clearBtn.style.display = '';
  // Progress sıfırla
  document.getElementById('dbProgress').style.display = 'none';
  document.getElementById('dbProgressBar').style.width = '0%';
  document.getElementById('dbOkCount').textContent = '0';
  document.getElementById('dbFailCount').textContent = '0';
  document.getElementById('dbErrorList').innerHTML = '';
  dbState.archiveEntries = [];
  dbState.archivePreviewErrors = [];
  dbState.archivePreviewLoading = false;
  dbState.uploadQueue = [];
  renderDbImagePreview(dbState.isZip ? [] : all);
  renderDbArchivePreview();
  initDbUploadQueueFromSelection();
  if (dbState.isZip) {
    await loadArchivePreviewForSelectedFiles();
    btn.disabled = dbState.files.length === 0;
  }
  setDbUploadStatus();
}

function clearDbSelection() {
  dbState.files = [];
  dbState.isZip = false;
  dbState.archiveEntries = [];
  dbState.archivePreviewErrors = [];
  dbState.archivePreviewLoading = false;
  dbState.uploadQueue = [];
  resetDbDropIndicator();
  document.getElementById('dbSelectedFiles').style.display = 'none';
  document.getElementById('dbUploadBtn').disabled = true;
  document.getElementById('dbClearBtn').style.display = 'none';
  document.getElementById('dbProgress').style.display = 'none';
  document.getElementById('dbFileInput').value = '';
  clearDbImagePreview();
  renderDbArchivePreview();
  renderDbUploadQueue();
  setDbUploadStatus();
}

function setDbUploadStatus(type = '', message = '') {
  const el = document.getElementById('dbUploadStatus');
  if (!el) return;
  if (!type || !message) {
    el.style.display = 'none';
    el.className = 'db-upload-status';
    el.textContent = '';
    return;
  }
  el.className = `db-upload-status ${type}`;
  el.style.display = 'flex';
  el.innerHTML = '';
  if (type === 'loading') {
    const spinner = document.createElement('span');
    spinner.className = 'db-mini-spinner';
    el.appendChild(spinner);
  }
  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);
}

async function startDbUpload() {
  if (!dbState.files.length || dbState.uploading) return;
  dbState.uploading = true;
  const btn = document.getElementById('dbUploadBtn');
  const clearBtn = document.getElementById('dbClearBtn');
  const input = document.getElementById('dbFileInput');
  const drop = document.getElementById('dbDrop');
  btn.disabled = true;
  clearBtn.disabled = true;
  input.disabled = true;
  drop.style.pointerEvents = 'none';
  drop.style.opacity = '0.7';
  document.getElementById('dbProgress').style.display = 'block';
  document.getElementById('dbErrorList').innerHTML = '';
  setDbUploadStatus('loading', 'Dosyalar yükleniyor ve indeksleniyor...');
  if (!dbState.uploadQueue.length) initDbUploadQueueFromSelection();
  dbState.uploadQueue.forEach(item => { item.status = 'queued'; item.detail = ''; });
  renderDbUploadQueue();

  const catId = document.getElementById('dbCategorySelect').value;
  const skipClip = true;
  const qp = new URLSearchParams();
  if (catId) qp.set('category_id', catId);
  qp.set('skip_clip', skipClip);
  const catParam = '?' + qp.toString();
  let ok = 0, fail = 0;
  let firstErr = '';

  try {
    await ensureApiBase(true);
    if (dbState.isZip) {
      // Arşiv modu: her ZIP/RAR dosyasını ayrı ayrı gönder
      const total = dbState.files.length;
      for (let i = 0; i < total; i++) {
        const f = dbState.files[i];
        document.getElementById('dbProgressLabel').textContent = `Arşiv işleniyor: ${f.name} (${i+1}/${total})`;
        document.getElementById('dbProgressBar').style.width = Math.round((i / total) * 100) + '%';
        markQueueUploadingForArchive(f.name);

        const fd = new FormData();
        fd.append('file', f);
        try {
          const r = await fetch(`${API}/index/bulk-zip${catParam}`, { method: 'POST', headers: authH(), body: fd });
          if (r.status === 401) { logout(); return; }
          const d = await parseApiJsonResponse(r, `${f.name} yüklenemedi`);
          ok += d.success || 0;
          fail += d.failed || 0;
          applyArchiveResultToQueue(f.name, d.errors || []);
          (d.errors || []).forEach(err => {
            if (!firstErr && err?.reason) firstErr = err.reason;
            const el = document.createElement('div');
            el.className = 'db-error-item';
            el.textContent = `${err.filename}: ${err.reason}`;
            document.getElementById('dbErrorList').appendChild(el);
          });
        } catch (err) {
          // Arşiv seviyesinde hata aldıysa bu arşive ait satırları hata olarak işaretle.
          const pendingInArchive = dbState.uploadQueue.filter(q =>
            q.archive === f.name && (q.status === 'queued' || q.status === 'uploading')
          ).length;
          fail += Math.max(pendingInArchive, 1);
          markArchiveQueueAsError(f.name, err?.message || 'İşlenemedi');
          if (!firstErr) firstErr = err?.message || 'İşlenemedi';
          const el = document.createElement('div');
          el.className = 'db-error-item';
          el.textContent = `${f.name}: ${err?.message || 'İşlenemedi'}`;
          document.getElementById('dbErrorList').appendChild(el);
        }
        document.getElementById('dbOkCount').textContent = ok;
        document.getElementById('dbFailCount').textContent = fail;
      }
      document.getElementById('dbProgressBar').style.width = '100%';
    } else {
      // Normal mod: 10'lu batch
      const BATCH = 10;
      const total = dbState.files.length;
      let done = 0;
      for (let i = 0; i < total; i += BATCH) {
        const batch = dbState.files.slice(i, i + BATCH);
        markDirectBatchUploading(batch);
        const fd = new FormData();
        batch.forEach(f => fd.append('files', f));
        try {
          const r = await fetch(`${API}/index/bulk${catParam}`, { method: 'POST', headers: authH(), body: fd });
          if (r.status === 401) { logout(); return; }
          const d = await parseApiJsonResponse(r, 'Toplu yükleme hatası');
          ok += d.success || 0;
          fail += d.failed || 0;
          done += batch.length;
          applyDirectBatchResult(batch, d.errors || []);
          (d.errors || []).forEach(err => {
            if (!firstErr && err?.reason) firstErr = err.reason;
            const el = document.createElement('div');
            el.className = 'db-error-item';
            el.textContent = `${err.filename}: ${err.reason}`;
            document.getElementById('dbErrorList').appendChild(el);
          });
        } catch (err) {
          fail += batch.length; done += batch.length;
          markDirectBatchAsError(batch, err?.message || 'İşlenemedi');
          if (!firstErr) firstErr = err?.message || 'İşlenemedi';
          batch.forEach(file => {
            const el = document.createElement('div');
            el.className = 'db-error-item';
            el.textContent = `${file.name}: ${err?.message || 'İşlenemedi'}`;
            document.getElementById('dbErrorList').appendChild(el);
          });
        }
        const pct = Math.round(done / total * 100);
        document.getElementById('dbProgressBar').style.width = pct + '%';
        document.getElementById('dbProgressLabel').textContent = `${done} / ${total} dosya işlendi`;
        document.getElementById('dbOkCount').textContent = ok;
        document.getElementById('dbFailCount').textContent = fail;
      }
    }

    document.getElementById('dbProgressLabel').textContent = `Tamamlandı — ${ok} başarılı, ${fail} hatalı`;
    if (fail === 0) {
      setDbUploadStatus('success', `Yükleme tamamlandı. ${ok} dosya başarıyla indekslendi.`);
    } else if (ok > 0) {
      setDbUploadStatus('warn', `Yükleme tamamlandı. ${ok} başarılı, ${fail} hatalı.`);
    } else {
      const msg = firstErr
        ? `Yükleme tamamlanamadı. ${firstErr}`
        : 'Yükleme tamamlanamadı. Dosyalar işlenemedi.';
      setDbUploadStatus('error', msg);
    }
    loadStats();
    loadDbFiles();
  } catch (e) {
    setDbUploadStatus('error', e?.message || 'Yükleme sırasında beklenmeyen bir hata oluştu.');
  } finally {
    dbState.uploading = false;
    btn.disabled = dbState.files.length === 0;
    clearBtn.disabled = false;
    input.disabled = false;
    drop.style.pointerEvents = '';
    drop.style.opacity = '';
  }
}

async function pollUploadJob(jobId) {
  let last = null;
  for (let i = 0; i < 720; i++) {
    const r = await fetch(`${API}/jobs/${jobId}`, { headers: authH() });
    if (r.status === 401) { logout(); return null; }
    const data = await parseApiJsonResponse(r, 'Job durumu alinamadi');
    const job = data.job || {};
    last = data;
    const total = job.total_items || 0;
    const processed = job.processed_items || 0;
    const pct = total ? Math.round(processed / total * 100) : 0;
    document.getElementById('dbProgressBar').style.width = pct + '%';
    document.getElementById('dbProgressLabel').textContent = `Job #${jobId}: ${processed} / ${total} işlendi (${job.status})`;
    document.getElementById('dbOkCount').textContent = job.succeeded_items || 0;
    document.getElementById('dbFailCount').textContent = job.failed_items || 0;
    if (['succeeded', 'failed', 'cancelled'].includes(job.status)) return data;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return last;
}

async function startDbUpload() {
  if (!dbState.files.length || dbState.uploading) return;
  dbState.uploading = true;
  const btn = document.getElementById('dbUploadBtn');
  const clearBtn = document.getElementById('dbClearBtn');
  const input = document.getElementById('dbFileInput');
  const drop = document.getElementById('dbDrop');
  btn.disabled = true;
  clearBtn.disabled = true;
  input.disabled = true;
  drop.style.pointerEvents = 'none';
  drop.style.opacity = '0.7';
  document.getElementById('dbProgress').style.display = 'block';
  document.getElementById('dbErrorList').innerHTML = '';
  document.getElementById('dbProgressBar').style.width = '0%';
  document.getElementById('dbOkCount').textContent = '0';
  document.getElementById('dbFailCount').textContent = '0';
  setDbUploadStatus('loading', 'Dosyalar job kuyruğuna alınıyor...');
  if (!dbState.uploadQueue.length) initDbUploadQueueFromSelection();
  dbState.uploadQueue.forEach(item => { item.status = 'queued'; item.detail = 'job kuyruğunda'; });
  renderDbUploadQueue();

  try {
    await ensureApiBase(true);
    const fd = new FormData();
    dbState.files.forEach(f => fd.append('files', f));
    const qp = new URLSearchParams();
    const catId = document.getElementById('dbCategorySelect').value;
    if (catId) qp.set('category_id', catId);
    qp.set('skip_clip', 'true');
    const r = await fetch(`${API}/jobs/upload?${qp.toString()}`, { method: 'POST', headers: authH(), body: fd });
    if (r.status === 401) { logout(); return; }
    const created = await parseApiJsonResponse(r, 'Upload job baslatilamadi');
    setDbUploadStatus('loading', `Upload job #${created.job_id} başladı. CLIP otomatik arkada tamamlanacak.`);
    const finalData = await pollUploadJob(created.job_id);
    const job = finalData?.job || {};
    const items = finalData?.items || [];
    items.forEach(item => {
      const q = dbState.uploadQueue.find(x => x.filename === item.filename || x.name === item.filename || x.entryName === item.filename);
      if (q) { q.status = item.status === 'succeeded' ? 'uploaded' : (item.status === 'failed' ? 'error' : item.status); q.detail = item.message || ''; }
    });
    renderDbUploadQueue();
    if (job.status === 'succeeded') {
      setDbUploadStatus('success', `Upload tamamlandı. ${job.succeeded_items || 0} dosya işlendi.`);
    } else if (job.status === 'failed') {
      setDbUploadStatus('warn', `Upload job tamamlandı: ${job.succeeded_items || 0} başarılı, ${job.failed_items || 0} hatalı.`);
    } else {
      setDbUploadStatus('warn', `Upload job durumu: ${job.status || 'bilinmiyor'}.`);
    }
    await Promise.all([loadStats(), loadDbFiles(), loadActivityLog()]);
    _checkUploadDuplicates(items);
  } catch (e) {
    setDbUploadStatus('error', e?.message || 'Upload job baslatilamadi.');
  } finally {
    dbState.uploading = false;
    btn.disabled = dbState.files.length === 0;
    clearBtn.disabled = false;
    input.disabled = false;
    drop.style.pointerEvents = '';
    drop.style.opacity = '';
  }
}

async function _checkUploadDuplicates(items) {
  const succeededIds = items.filter(i => i.status === 'succeeded' && i.file_id).map(i => i.file_id);
  if (!succeededIds.length) return;
  try {
    const r = await fetch(`${API}/files?duplicate_status=exact_duplicate,revision_candidate&per_page=1`, { headers: authH() });
    if (!r.ok) return;
    const data = await r.json();
    const dupTotal = data.total || 0;
    if (dupTotal > 0) {
      const banner = document.createElement('div');
      banner.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);background:#fef9c3;border:1px solid #fde047;border-radius:10px;padding:10px 20px;font-size:13px;color:#854d0e;z-index:9999;display:flex;align-items:center;gap:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1)';
      banner.innerHTML = `⚠️ <strong>${dupTotal}</strong> dosya duplicate/revizyon adayı. <button onclick="navGo('duplicates',document.getElementById('nav-duplicates'));this.closest('div').remove()" style="background:#854d0e;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer">Görüntüle</button> <button onclick="this.closest('div').remove()" style="background:transparent;border:none;font-size:16px;cursor:pointer;color:#854d0e;margin-left:4px">×</button>`;
      document.body.appendChild(banner);
      setTimeout(() => banner.remove(), 10000);
    }
  } catch {}
}

// Dosya listesi
function dbSearchDebounce() {
  clearTimeout(dbState.searchTimer);
  dbState.searchTimer = setTimeout(() => {
    dbState.search = document.getElementById('dbSearchBox').value.trim();
    dbState.page = 1;
    loadDbFiles();
  }, 400);
}

let dbStatusFilter = '';

function toggleDbUploadPanel() {
  const panel = document.getElementById('dbUploadPanel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

const flFolderNames = { all: 'All Files', uploaded: 'New', draft: 'Review Queue', approved: 'Approved Catalog' };
function flSetFolder(status, el) {
  dbStatusFilter = status === 'all' ? '' : status;
  document.querySelectorAll('.fl-folder-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  const title = document.getElementById('flFolderTitle');
  if (title) title.firstChild.textContent = flFolderNames[status] + ' ';
  dbState.page = 1;
  loadDbFiles();
}

function _buildDbFilterParams() {
  const params = new URLSearchParams();
  const fmts = Array.from(document.querySelectorAll('.db-fmt-filter:checked')).map(el => el.value);
  if (fmts.length) params.set('file_format', fmts.join(','));
  const cat = document.getElementById('dbFilterCategory')?.value;
  if (cat) params.set('category_id', cat);
  const dup = document.getElementById('dbFilterDup')?.value;
  if (dup) params.set('duplicate_status', dup);
  const prev = document.getElementById('dbFilterPreview')?.value;
  if (prev) params.set('has_preview', prev);
  const clip = document.getElementById('dbFilterClip')?.value;
  if (clip) params.set('has_clip', clip);
  const missingAttrs = document.getElementById('dbFilterMissingAttrs')?.checked;
  if (missingAttrs) params.set('has_missing_attrs', 'true');
  const cnt = fmts.length + (cat?1:0) + (dup?1:0) + (prev?1:0) + (clip?1:0) + (missingAttrs?1:0);
  const badge = document.getElementById('dbFilterToggleBadge');
  const active = document.getElementById('dbFilterActiveCount');
  if (badge) { badge.textContent = cnt; badge.style.display = cnt ? 'inline' : 'none'; }
  if (active) active.textContent = cnt ? `${cnt} filtre aktif` : '';
  return params;
}

function toggleDbFilterBar() {
  const bar = document.getElementById('dbFilterBar');
  if (!bar) return;
  bar.style.display = bar.style.display === 'none' ? 'flex' : 'none';
}

function applyDbFilters() {
  dbState.page = 1;
  loadDbFiles();
}

function clearDbFilters() {
  document.querySelectorAll('.db-fmt-filter').forEach(el => el.checked = false);
  ['dbFilterCategory','dbFilterDup','dbFilterPreview','dbFilterClip'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const ma = document.getElementById('dbFilterMissingAttrs'); if (ma) ma.checked = false;
  applyDbFilters();
}

async function loadDbFiles() {
  const { page, perPage, search } = dbState;
  const statusParam = dbStatusFilter ? '&status=' + dbStatusFilter : '';
  const extraParams = _buildDbFilterParams().toString();
  const url = `${API}/files?page=${page}&per_page=${perPage}${search ? '&search='+encodeURIComponent(search) : ''}${statusParam}${extraParams ? '&'+extraParams : ''}`;
  try {
    const r = await fetch(url, { headers: authH() });
    if (r.status === 401) { logout(); return; }
    const d = await r.json();
    dbState.total = d.total;
    renderDbTable(d.files);
    renderDbPagination(d.total, d.page, d.per_page);
    document.getElementById('dbTotalBadge').textContent = `(${d.total.toLocaleString('tr')} kayıt)`;
    const countEl = document.getElementById('flCountAll');
    if (countEl && !dbStatusFilter) countEl.textContent = d.total;
    const storageEl = document.getElementById('flStorageFiles');
    if (storageEl && !dbStatusFilter) { storageEl.textContent = d.total; }
    const bar = document.getElementById('flStorageBar');
    if (bar) bar.style.width = Math.min(100, (d.total / 2000) * 100) + '%';
  } catch {
    dbState.pageIds = [];
    updateDbApprovalSelectionUi();
    document.getElementById('dbTableBody').innerHTML = '<tr><td colspan="11" class="db-empty">Veriler yüklenemedi.</td></tr>';
  }
}

async function toggleFileFavorite(event, fileId) {
  event?.stopPropagation();
  try {
    const r = await fetch(`${API}/files/${fileId}/favorite`, { method: 'POST', headers: authH() });
    if (r.status === 401) { logout(); return; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || 'Favori güncellenemedi');
    const isFavorite = !!d.is_favorite;
    const dbHasFile = dbLastFiles.some(f => Number(f.id) === Number(fileId));
    if (dbHasFile) {
      dbLastFiles = dbLastFiles.map(f => Number(f.id) === Number(fileId) ? { ...f, is_favorite: isFavorite } : f);
      renderDbTable(dbLastFiles);
    }
    if (searchState.results?.results?.some(f => Number(f.id) === Number(fileId))) {
      searchState.results.results = searchState.results.results.map(f => Number(f.id) === Number(fileId) ? { ...f, is_favorite: isFavorite } : f);
      renderResults(searchState.results);
    }
  } catch (err) {
    alert(err.message || 'Favori güncellenemedi');
  }
}

let dbViewMode = 'list';
let dbLastFiles = [];

function setDbViewMode(mode) {
  dbViewMode = mode;
  document.getElementById('flViewGrid').classList.toggle('active', mode === 'grid');
  document.getElementById('flViewList').classList.toggle('active', mode === 'list');
  document.getElementById('dbListView').style.display = mode === 'list' ? '' : 'none';
  document.getElementById('dbGridView').style.display = mode === 'grid' ? '' : 'none';
  renderDbTable(dbLastFiles);
}

const fmtBadgeStyle = {
  dxf: 'background:#e0f2fe;color:#0369a1',
  dwg: 'background:#ede9fe;color:#6d28d9',
  pdf: 'background:#fee2e2;color:#b91c1c',
  jpg: 'background:#fef9c3;color:#a16207',
  jpeg:'background:#fef9c3;color:#a16207',
  png: 'background:#f0fdf4;color:#166534',
};

function favoriteIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.7l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 17l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8L12 3.7z"></path></svg>`;
}

function favoriteButton(file, extraClass = '') {
  const active = file?.is_favorite ? ' active' : '';
  const title = file?.is_favorite ? 'Favorilerden çıkar' : 'Favorilere ekle';
  return `<button class="file-fav-btn${extraClass ? ' '+extraClass : ''}${active}" title="${title}" onclick="toggleFileFavorite(event, ${file.id})">${favoriteIcon()}</button>`;
}

function renderDbTable(files) {
  dbLastFiles = files;
  const tbody = document.getElementById('dbTableBody');
  dbState.pageIds = files.map(f => Number(f.id)).filter(Boolean);
  if (!files.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="db-empty">Henüz kalıp yok. Yükle sekmesinden ekleyin.</td></tr>`;
    document.getElementById('dbGridView').innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px;color:#94a3b8;font-size:14px">No files found.</div>`;
    updateDbApprovalSelectionUi();
    return;
  }
  if (dbViewMode === 'grid') {
    const docIcon = `<svg viewBox="0 0 48 56" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="46" height="54" rx="6" fill="#f1f5f9" stroke="#e2e8f0" stroke-width="1.5"/><rect x="8" y="18" width="32" height="3" rx="1.5" fill="#cbd5e1"/><rect x="8" y="26" width="24" height="3" rx="1.5" fill="#cbd5e1"/><rect x="8" y="34" width="28" height="3" rx="1.5" fill="#cbd5e1"/><rect x="8" y="42" width="18" height="3" rx="1.5" fill="#e2e8f0"/></svg>`;
    document.getElementById('dbGridView').innerHTML = files.map(f => {
      const fmt = (f.file_format || '').toLowerCase();
      const badgeStyle = fmtBadgeStyle[fmt] || 'background:#f1f5f9;color:#475569';
      const date = f.indexed_at ? new Date(f.indexed_at).toLocaleDateString('tr-TR') : '—';
      const sizeParts = (f.bbox_width && f.bbox_height) ? `${f.bbox_width.toFixed(0)}×${f.bbox_height.toFixed(0)}` : '';
      const meta = [sizeParts, date].filter(Boolean).join(' • ');
      const catTag = f.category_name
        ? `<span class="fl-card-tag" style="background:${f.category_color||'#6366f1'}18;color:${f.category_color||'#6366f1'}">${f.category_name}</span>` : '';
      const thumb = f.jpg_preview
        ? `<img src="${f.jpg_preview}" style="max-width:100%;max-height:72px;object-fit:contain;border-radius:6px">`
        : docIcon;
      const attrObj = f.attributes || {};
      const attrChipsGrid = Object.entries(attrObj).filter(([,v]) => v !== null && v !== '' && v !== false).slice(0, 4).map(([k,v]) =>
        `<span style="font-size:9px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:3px;padding:1px 5px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">${escHtml(k)}: <b>${escHtml(String(v))}</b></span>`
      ).join('');
      const missingG = _fileMissingAttrs(f);
      const warnBadge = missingG.length ? `<span title="Eksik alanlar: ${missingG.join(', ')}" style="position:absolute;top:6px;left:6px;background:#dc2626;color:#fff;font-size:9px;font-weight:700;border-radius:4px;padding:1px 5px;z-index:2;cursor:default">⚠ ${missingG.length}</span>` : '';
      return `<div class="fl-card" style="position:relative${missingG.length ? ';border-color:#fca5a5' : ''}" onclick="showDetailModal(${f.id})">
        ${warnBadge}
        ${favoriteButton(f, 'fl-card-favorite')}
        <span class="fl-card-badge" style="${badgeStyle}">${fmt.toUpperCase()}</span>
        <div class="fl-card-menu" onclick="event.stopPropagation()">
          <button title="Download" onclick="downloadFile(${f.id},'${f.filename.replace(/'/g,"\\'")}')">↓</button>
        </div>
        <div class="fl-card-icon">${thumb}</div>
        <div class="fl-card-name" title="${f.filepath}">${f.filename}</div>
        <div class="fl-card-meta">${meta}</div>
        <div class="fl-card-tags">${catTag}${attrChipsGrid ? '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:3px">'+attrChipsGrid+'</div>' : ''}</div>
      </div>`;
    }).join('');
    updateDbApprovalSelectionUi();
    return;
  }
  const fmtColor = { dwg: 'fmt-dwg', dxf: 'fmt-dxf', pdf: 'fmt-pdf' };
  tbody.innerHTML = files.map(f => {
    const fmt = (f.file_format || '').toLowerCase();
    const date = f.indexed_at ? new Date(f.indexed_at).toLocaleDateString('tr-TR') : '—';
    const size = (f.bbox_width && f.bbox_height)
      ? `${f.bbox_width.toFixed(0)}×${f.bbox_height.toFixed(0)}`
      : '—';
    const status = (f.approval_status || (f.approved ? 'approved' : 'uploaded')).toLowerCase();
    const approvedBadge = statusBadge(status);
    const checked = dbState.selectedIds.has(Number(f.id)) ? 'checked' : '';
    const catBadge = f.category_name
      ? `<span style="background:${f.category_color||'#6366f1'}18;color:${f.category_color||'#6366f1'};font-size:11px;font-weight:600;padding:2px 9px;border-radius:6px;white-space:nowrap">${f.category_name}</span>`
      : `<span style="color:#c8c4bc;font-size:13px">—</span>`;
    const thumb = f.jpg_preview
      ? `<img src="${f.jpg_preview}" style="width:44px;height:32px;object-fit:contain;border-radius:6px;border:1px solid #e8e4dd;background:#f7f5f2;cursor:pointer" onclick="event.stopPropagation();showDetailModal(${f.id})" title="Önizle">`
      : `<div style="width:44px;height:32px;border-radius:6px;border:1px solid #e8e4dd;background:#f2f0ec;display:flex;align-items:center;justify-content:center"><span style="font-size:9px;color:#a3a09a;font-weight:600">${fmt.toUpperCase()}</span></div>`;
    const hasData = f.has_file_data;
    const attrObj = f.attributes || {};
    const missing = _fileMissingAttrs(f);
    const hasMissing = missing.length > 0;
    const attrCells = _dbAttrDefs.map(def => {
      const v = attrObj[def.name];
      const isEmpty = v === null || v === undefined || String(v).trim() === '' || v === false;
      if (isEmpty) {
        return def.required
          ? `<td style="white-space:nowrap"><span style="background:#fee2e2;color:#991b1b;font-size:10px;font-weight:600;padding:2px 7px;border-radius:5px;letter-spacing:0.02em">⚠ eksik</span></td>`
          : `<td style="color:#d1cdc5;font-size:13px">—</td>`;
      }
      const display = v === true ? 'Evet' : v === false ? 'Hayır' : String(v);
      return `<td style="font-size:12px;color:#374151;white-space:nowrap;max-width:140px;overflow:hidden;text-overflow:ellipsis" title="${escHtml(display)}">${escHtml(display)}</td>`;
    }).join('');
    const totalCols = 11 + _dbAttrDefs.length;
    return `<tr class="clickable-row" onclick="showDetailModal(${f.id})" style="${hasMissing ? 'border-left:3px solid #fca5a5' : ''}">
      <td style="text-align:center" onclick="event.stopPropagation()"><input id="dbSel_${f.id}" type="checkbox" ${checked} onchange="toggleDbSelect(${f.id}, this.checked)" style="accent-color:var(--blue);cursor:pointer"></td>
      <td style="padding:4px 8px">${thumb}</td>
      <td><div class="td-filename" title="${f.filepath}">${f.filename}</div></td>
      <td><span class="td-format ${fmtColor[fmt]||''}">${fmt.toUpperCase()}</span></td>
      <td>${catBadge}</td>
      <td>${(f.entity_count||0).toLocaleString('tr')}</td>
      <td>${f.layer_count||0}</td>
      <td>${size}</td>
      <td>${approvedBadge}</td>
      <td class="td-date">${date}</td>
      ${attrCells}
      <td style="display:flex;gap:6px;align-items:center" onclick="event.stopPropagation()">
        ${favoriteButton(f)}
        <button class="del-btn" style="background:#f2f0ec;color:#374151;border-color:#e3dfd8" onclick="downloadFile(${f.id},'${f.filename.replace(/'/g,"\\'")}')">↓</button>
        <button class="del-btn" onclick="deleteFile(${f.id},'${f.filename.replace(/'/g,"\\'")}')">Sil</button>
      </td>
    </tr>`;
  }).join('');
  updateDbApprovalSelectionUi();
}

function renderDbPagination(total, page, perPage) {
  const pages = Math.ceil(total / perPage);
  const pg = document.getElementById('dbPagination');
  if (pages <= 1) { pg.style.display = 'none'; return; }
  pg.style.display = 'flex';
  document.getElementById('dbPageInfo').textContent = `Sayfa ${page} / ${pages}`;
  document.getElementById('dbPrevBtn').disabled = page <= 1;
  document.getElementById('dbNextBtn').disabled = page >= pages;
}

function dbChangePage(dir) {
  const pages = Math.ceil(dbState.total / dbState.perPage);
  dbState.page = Math.max(1, Math.min(pages, dbState.page + dir));
  loadDbFiles();
}

function statusLabel(status) {
  const s = (status || '').toLowerCase();
  if (s === 'approved') return 'Approved';
  if (s === 'draft') return 'Review';
  return 'New';
}

function statusBadge(status) {
  const s = (status || '').toLowerCase();
  if (s === 'approved') {
    return '<span style="background:#d1fae5;color:#065f46;font-size:11px;font-weight:600;padding:2px 9px;border-radius:6px;white-space:nowrap;letter-spacing:0.02em">Approved</span>';
  }
  if (s === 'draft') {
    return '<span style="background:#fef3c7;color:#92400e;font-size:11px;font-weight:600;padding:2px 9px;border-radius:6px;white-space:nowrap;letter-spacing:0.02em">Review</span>';
  }
  return '<span style="background:#f3f4f6;color:#6b7280;font-size:11px;font-weight:600;padding:2px 9px;border-radius:6px;white-space:nowrap;letter-spacing:0.02em">New</span>';
}

function normalizedStatus(file) {
  const raw = (file?.approval_status || (file?.approved ? 'approved' : 'uploaded') || '').toLowerCase();
  if (raw === 'approved') return 'approved';
  if (raw === 'draft') return 'draft';
  return 'uploaded';
}

async function setFilesStatus(fileIds, status) {
  const payload = {
    file_ids: fileIds.map(x => Number(x)).filter(x => Number.isInteger(x) && x > 0),
    status,
  };
  if (!payload.file_ids.length) return { updated_count: 0 };
  const r = await fetch(`${API}/files/approve/bulk`, {
    method: 'POST',
    headers: { ...authH(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (r.status === 401) { logout(); throw new Error('Oturum sona erdi'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.detail || 'Toplu durum işlemi başarısız');
  return d;
}

async function applyStatusToDbSelection() {
  const ids = Array.from(dbState.selectedIds);
  if (!ids.length) return;
  const status = document.getElementById('dbBulkStatusSelect')?.value || 'draft';
  try {
    await setFilesStatus(ids, status);
    dbState.selectedIds.clear();
    productsState.draft.selectedIds.clear();
    productsState.approved.selectedIds.clear();
    updateDbApprovalSelectionUi();
    updateApprovedSelectionUi();
    await Promise.all([loadDbFiles(), loadApprovedFiles()]);
  } catch (err) {
    alert(err.message || 'Toplu durum işlemi başarısız.');
  }
}

async function enqueueSelectedReindex() {
  const ids = Array.from(dbState.selectedIds);
  if (!ids.length) return;
  try {
    const r = await fetch(`${API}/jobs/reindex`, {
      method: 'POST',
      headers: { ...authH(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_ids: ids }),
    });
    if (r.status === 401) { logout(); return; }
    const d = await parseApiJsonResponse(r, 'Re-index job baslatilamadi');
    setDbUploadStatus('success', `Re-index job kuyruğa alındı (#${d.job_id}).`);
    dbState.selectedIds.clear();
    updateDbApprovalSelectionUi();
    loadActivityLog();
  } catch (err) {
    setDbUploadStatus('error', err?.message || 'Re-index job baslatilamadi.');
  }
}

async function enqueueClipBackfill() {
  const ids = Array.from(dbState.selectedIds);
  try {
    const r = await fetch(`${API}/jobs/clip-backfill`, {
      method: 'POST',
      headers: { ...authH(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_ids: ids }),
    });
    if (r.status === 401) { logout(); return; }
    const d = await parseApiJsonResponse(r, 'CLIP backfill job baslatilamadi');
    setDbUploadStatus('success', `CLIP backfill kuyruğa alındı (#${d.job_id}, ${d.total_items || 0} dosya).`);
    loadActivityLog();
  } catch (err) {
    setDbUploadStatus('error', err?.message || 'CLIP backfill job baslatilamadi.');
  }
}

function getProductsColumn(kind) {
  return productsState[kind];
}

function productSearchDebounce(kind) {
  const st = getProductsColumn(kind);
  clearTimeout(st.searchTimer);
  st.searchTimer = setTimeout(() => {
    const input = document.getElementById(`${kind}SearchBox`);
    st.search = input ? input.value.trim() : '';
    st.page = 1;
    loadProductFiles(kind);
  }, 400);
}

function updateProductSelectionUi(kind) {
  const st = getProductsColumn(kind);
  const info = document.getElementById(`${kind}SelectedInfo`);
  const btn = document.getElementById(kind === 'draft' ? 'draftToApprovedBtn' : 'approvedToDraftBtn');
  const selected = st.selectedIds.size;
  if (info) info.textContent = `${selected} ${t('common.selected')}`;
  if (btn) btn.disabled = selected === 0;

  const allBox = document.getElementById(`${kind}SelectAll`);
  if (!allBox) return;
  if (!st.pageIds.length) {
    allBox.checked = false;
    allBox.indeterminate = false;
    return;
  }
  const hit = st.pageIds.filter(id => st.selectedIds.has(id)).length;
  allBox.checked = hit === st.pageIds.length;
  allBox.indeterminate = hit > 0 && hit < st.pageIds.length;
}

function updateApprovedSelectionUi() {
  updateProductSelectionUi('draft');
  updateProductSelectionUi('approved');
}

function toggleProductSelect(kind, fileId, checked) {
  const st = getProductsColumn(kind);
  const id = Number(fileId);
  if (!id) return;
  if (checked) st.selectedIds.add(id);
  else st.selectedIds.delete(id);
  updateProductSelectionUi(kind);
}

function toggleProductSelectAll(kind, checked) {
  const st = getProductsColumn(kind);
  st.pageIds.forEach(id => {
    if (checked) st.selectedIds.add(id);
    else st.selectedIds.delete(id);
  });
  updateProductSelectionUi(kind);
  st.pageIds.forEach(id => {
    const el = document.getElementById(`${kind}Sel_${id}`);
    if (el) el.checked = checked;
  });
}

async function loadProductFiles(kind) {
  const st = getProductsColumn(kind);
  const url = `${API}/files?page=${st.page}&per_page=${st.perPage}&status=${kind}${st.search ? '&search=' + encodeURIComponent(st.search) : ''}`;
  try {
    const r = await fetch(url, { headers: authH() });
    if (r.status === 401) { logout(); return; }
    const d = await r.json();
    const sourceFiles = d.files || [];
    const strictFiles = sourceFiles.filter(f => normalizedStatus(f) === kind);
    const hasForeignStatus = sourceFiles.some(f => normalizedStatus(f) !== kind);
    const totalForPagination = (!hasForeignStatus && typeof d.total === 'number')
      ? d.total
      : strictFiles.length;
    st.total = totalForPagination;
    renderProductTable(kind, strictFiles);
    renderProductPagination(kind, totalForPagination, d.page || 1, d.per_page || st.perPage);
    const badge = document.getElementById(`${kind}TotalBadge`);
    if (badge) badge.textContent = `(${totalForPagination.toLocaleString('en-US')} items)`;
  } catch {
    st.pageIds = [];
    updateProductSelectionUi(kind);
    const tbody = document.getElementById(`${kind}TableBody`);
    if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="db-empty">Veriler yüklenemedi.</td></tr>';
  }
}

function renderProductTable(kind, files) {
  const st = getProductsColumn(kind);
  const tbody = document.getElementById(`${kind}TableBody`);
  if (!tbody) return;
  st.pageIds = files.map(f => Number(f.id)).filter(Boolean);
  if (!files.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="db-empty">${kind === 'draft' ? 'Review Queue' : 'Approved Catalog'} is empty.</td></tr>`;
    updateProductSelectionUi(kind);
    return;
  }

  const fmtColor = { dwg: 'fmt-dwg', dxf: 'fmt-dxf', pdf: 'fmt-pdf' };
  tbody.innerHTML = files.map(f => {
    const fmt = (f.file_format || '').toLowerCase();
    const dateRaw = kind === 'approved' ? (f.approved_at || f.indexed_at) : f.indexed_at;
    const date = dateRaw ? new Date(dateRaw).toLocaleDateString('tr-TR') : '—';
    const size = (f.bbox_width && f.bbox_height)
      ? `${f.bbox_width.toFixed(0)}×${f.bbox_height.toFixed(0)}`
      : '—';
    const checked = st.selectedIds.has(Number(f.id)) ? 'checked' : '';
    const catBadge = f.category_name
      ? `<span style="background:${f.category_color||'#6366f1'}18;color:${f.category_color||'#6366f1'};font-size:11px;font-weight:600;padding:2px 9px;border-radius:6px;white-space:nowrap">${f.category_name}</span>`
      : `<span style="color:#c8c4bc;font-size:13px">—</span>`;
    const thumb = f.jpg_preview
      ? `<img src="${f.jpg_preview}" style="width:44px;height:32px;object-fit:contain;border-radius:6px;border:1px solid #e8e4dd;background:#f7f5f2;cursor:pointer" onclick="event.stopPropagation();showDetailModal(${f.id})" title="Önizle">`
      : `<div style="width:44px;height:32px;border-radius:6px;border:1px solid #e8e4dd;background:#f2f0ec;display:flex;align-items:center;justify-content:center"><span style="font-size:9px;color:#a3a09a;font-weight:600">${fmt.toUpperCase()}</span></div>`;
    return `<tr class="clickable-row" onclick="showDetailModal(${f.id})">
      <td style="text-align:center" onclick="event.stopPropagation()"><input id="${kind}Sel_${f.id}" type="checkbox" ${checked} onchange="toggleProductSelect('${kind}', ${f.id}, this.checked)" style="accent-color:var(--blue);cursor:pointer"></td>
      <td style="padding:4px 8px">${thumb}</td>
      <td><div class="td-filename" title="${f.filepath}">${f.filename}</div></td>
      <td><span class="td-format ${fmtColor[fmt]||''}">${fmt.toUpperCase()}</span></td>
      <td>${catBadge}</td>
      <td>${(f.entity_count||0).toLocaleString('tr')}</td>
      <td>${f.layer_count||0}</td>
      <td>${size}</td>
      <td class="td-date">${date}</td>
      <td style="display:flex;gap:6px;align-items:center" onclick="event.stopPropagation()">
        <button class="del-btn" style="background:rgba(59,130,246,0.12);color:var(--blue);border-color:rgba(59,130,246,0.3)" onclick="downloadFile(${f.id},'${f.filename.replace(/'/g,"\\'")}')">↓</button>
      </td>
    </tr>`;
  }).join('');
  updateProductSelectionUi(kind);
}

function renderProductPagination(kind, total, page, perPage) {
  const pg = document.getElementById(`${kind}Pagination`);
  if (!pg) return;
  const pages = Math.ceil(total / perPage);
  if (pages <= 1) { pg.style.display = 'none'; return; }
  pg.style.display = 'flex';
  document.getElementById(`${kind}PageInfo`).textContent = `Sayfa ${page} / ${pages}`;
  document.getElementById(`${kind}PrevBtn`).disabled = page <= 1;
  document.getElementById(`${kind}NextBtn`).disabled = page >= pages;
}

function productChangePage(kind, dir) {
  const st = getProductsColumn(kind);
  const pages = Math.ceil(st.total / st.perPage);
  st.page = Math.max(1, Math.min(pages, st.page + dir));
  loadProductFiles(kind);
}

async function moveProductSelection(kind) {
  const st = getProductsColumn(kind);
  const ids = Array.from(st.selectedIds);
  if (!ids.length) return;
  const target = kind === 'draft' ? 'approved' : 'draft';
  try {
    await setFilesStatus(ids, target);
    productsState.draft.selectedIds.clear();
    productsState.approved.selectedIds.clear();
    ids.forEach(id => dbState.selectedIds.delete(id));
    updateApprovedSelectionUi();
    updateDbApprovalSelectionUi();
    await Promise.all([loadProductFiles('draft'), loadProductFiles('approved'), loadDbFiles()]);
  } catch (err) {
    alert(err.message || 'Durum taşıma işlemi başarısız.');
  }
}

async function loadApprovedFiles() {
  await Promise.all([loadProductFiles('draft'), loadProductFiles('approved')]);
}

async function deleteFile(id, name) {
  if (!confirm(`"${name}" silinsin mi?`)) return;
  try {
    const r = await fetch(`${API}/files/${id}`, { method: 'DELETE', headers: authH() });
    if (r.status === 401) { logout(); return; }
    if (!r.ok) throw new Error();
    dbState.selectedIds.delete(Number(id));
    productsState.draft.selectedIds.delete(Number(id));
    productsState.approved.selectedIds.delete(Number(id));
    updateDbApprovalSelectionUi();
    updateApprovedSelectionUi();
    loadStats();
    loadDbFiles();
    loadApprovedFiles();
  } catch {
    alert('Silme başarısız.');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════

