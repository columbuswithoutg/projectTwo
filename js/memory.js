/************************************************
 * MEMORY UPLOAD — POST /api/upload (Cloudinary) with progress.
 * XHR (not fetch) so upload.onprogress works. onProgress(frac 0..1);
 * onProcessing() fires once the bytes are up while Cloudinary still
 * processes. Resolves { url, type }. Shared by the Add Memory modal and
 * the post composer (js/post-composer.js).
 ************************************************/
function uploadMemoryFile(file, { onProgress, onProcessing } = {}) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${Auth.getToken()}`);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) onProgress(ev.loaded / ev.total);
    };
    xhr.upload.onload = () => { if (onProgress) onProgress(1); if (onProcessing) onProcessing(); };
    xhr.onload = () => {
      // XHR bypasses Auth.fetch: a dead session still goes to /login once
      // (the returned promise never settles) instead of an upload error toast.
      if (xhr.status === 401) { Auth.endSession(); return; }
      try {
        const json = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300 && json.url) resolve({ url: json.url, type: json.type });
        else reject(new Error(json.error || `Upload failed (HTTP ${xhr.status})`));
      } catch (err) { reject(err); }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(formData);
  });
}

/************************************************
 * ADD MEMORY MODAL
 ************************************************/
async function showAddMemoryModal(project) {
  const modal = document.createElement('div');
  modal.className = 'auth-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'add-memory-heading');
  modal.innerHTML = `
    <div class="auth-box">
      <button class="popup-close" type="button" aria-label="Close">✕</button>
      <h3 id="add-memory-heading">Add memory</h3>
      <p class="dialog-muted">Upload a photo or video from watching ${esc(project.title)}</p>
      <label class="visually-hidden" for="memory-file">Photo or video</label>
      <input type="file" id="memory-file" accept="image/*,video/*,.heic,.heif" />
      <label class="visually-hidden" for="memory-caption">Caption</label>
      <input type="text" id="memory-caption" placeholder="Caption (optional)" maxlength="280" />
      <div id="memory-preview"></div>
      <p class="auth-error" role="alert" style="display:none"></p>
      <button id="memory-upload-btn" type="button">Upload</button>
    </div>
  `;

  // Blob URLs created for local file preview — must be revoked to avoid
  // leaking memory until tab close.
  let previewBlobUrl = null;
  const revokePreview = () => {
    if (previewBlobUrl) {
      URL.revokeObjectURL(previewBlobUrl);
      previewBlobUrl = null;
    }
  };
  document.body.appendChild(modal);
  const close = wireModalDismiss(modal, () => { revokePreview(); modal.remove(); }, {
    initialFocus: modal.querySelector('.popup-close')
  });
  modal.querySelector('.popup-close').onclick = close;

  modal.querySelector('#memory-file').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const preview = modal.querySelector('#memory-preview');
    revokePreview();
    previewBlobUrl = URL.createObjectURL(file);
    preview.innerHTML = file.type.startsWith('video')
      ? `<video src="${previewBlobUrl}" controls style="max-width:100%; border-radius:8px; margin-top:8px"></video>`
      : `<img src="${previewBlobUrl}" style="max-width:100%; border-radius:8px; margin-top:8px" loading="lazy" />`;
  };

  modal.querySelector('#memory-upload-btn').onclick = async () => {
    const file = modal.querySelector('#memory-file').files[0];
    const caption = modal.querySelector('#memory-caption').value.trim();
    const errorEl = modal.querySelector('.auth-error');
    const uploadBtn = modal.querySelector('#memory-upload-btn');

    if (!file) {
      errorEl.textContent = 'Please select a file.';
      errorEl.style.display = 'block';
      return;
    }

    errorEl.style.display = 'none';
    uploadBtn.disabled = true;
    uploadBtn.classList.add('loading');
    uploadBtn.textContent = 'Uploading…';

    // Determinate progress bar — large videos can take many seconds, and a
    // disabled button alone reads as "frozen". Show real upload progress.
    const progressWrap = document.createElement('div');
    progressWrap.className = 'memory-upload-progress';
    progressWrap.innerHTML = '<div class="memory-upload-bar"></div>';
    uploadBtn.before(progressWrap);
    const bar = progressWrap.querySelector('.memory-upload-bar');
    const setProgress = (frac) => { bar.style.width = Math.round(frac * 100) + '%'; };
    setProgress(0);

    const resetButton = () => {
      uploadBtn.disabled = false;
      uploadBtn.classList.remove('loading');
      uploadBtn.textContent = 'Upload';
      progressWrap.remove();
    };

    try {
      // Bytes up → Cloudinary may still be processing: show an
      // indeterminate "almost there" state until the response lands.
      const { url, type } = await uploadMemoryFile(file, {
        onProgress: setProgress,
        onProcessing: () => progressWrap.classList.add('processing')
      });

      const saveRes = await Auth.fetch(`${API}/progress/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, url, type, caption })
      });
      // The save used to be trusted blindly: a cap / validation error closed
      // the dialog as if it had worked and wiped the local memory list.
      let saved = null;
      try { saved = await saveRes.json(); } catch (_) {}
      if (!saveRes.ok || !saved || saved.error || !Array.isArray(saved.memories)) {
        throw new Error((saved && saved.error) || 'Couldn’t save the memory. Try again.');
      }

      const entry = state.data.get(project.id);
      if (entry) entry.memories = saved.memories;

      close();
      showPopup(project);

    } catch (e) {
      errorEl.textContent = (e && e.message) || 'Upload failed. Try again.';
      errorEl.style.display = 'block';
      resetButton();
    }
  };
}

/************************************************
 * MEMORY LIGHTBOX
 ************************************************/
function showMemoryLightbox(memories, startIndex, project) {
  let current = startIndex;

  const lightbox = document.createElement('div');
  lightbox.className = 'memory-lightbox';
  lightbox.setAttribute('role', 'dialog');
  lightbox.setAttribute('aria-modal', 'true');
  lightbox.setAttribute('aria-label', 'Memory');
  // The shell is built ONCE; only the media swaps. Re-rendering the whole
  // box on every step destroyed the focused Prev / Next button, so keyboard
  // users dropped to the page after one press.
  lightbox.innerHTML = `
    <div class="lightbox-inner">
      <button class="lightbox-close" type="button" aria-label="Close">✕</button>
      <button class="lightbox-nav prev" type="button" aria-label="Previous">‹</button>
      <div class="lightbox-media"></div>
      <button class="lightbox-nav next" type="button" aria-label="Next">›</button>
    </div>
  `;
  const media = lightbox.querySelector('.lightbox-media');
  const prev = lightbox.querySelector('.prev');
  const next = lightbox.querySelector('.next');
  const closeBtn = lightbox.querySelector('.lightbox-close');

  const render = () => {
    const m = memories[current];
    media.innerHTML = `
      ${m.type === 'video'
        ? `<video src="${esc(m.url)}" controls autoplay></video>`
        : `<img src="${esc(m.url)}" alt="${esc(m.caption)}" loading="lazy" />`
      }
      ${m.caption ? `<p class="lightbox-caption">${esc(m.caption)}</p>` : ''}
      <p class="lightbox-counter">${current + 1} / ${memories.length}</p>
    `;
    prev.disabled = current === 0;
    next.disabled = current === memories.length - 1;
    // A button that just became disabled can't keep focus — hand it on.
    if (document.activeElement === prev && prev.disabled) (next.disabled ? closeBtn : next).focus();
    if (document.activeElement === next && next.disabled) (prev.disabled ? closeBtn : prev).focus();
  };

  const go = (delta) => {
    const n = current + delta;
    if (n >= 0 && n < memories.length) { current = n; render(); }
  };
  prev.onclick = () => go(-1);
  next.onclick = () => go(1);

  // ArrowLeft / ArrowRight mirror the on-screen prev/next buttons.
  function onKey(e) {
    if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
  }

  render();
  document.body.appendChild(lightbox);

  const close = wireModalDismiss(lightbox, () => {
    document.removeEventListener('keydown', onKey);
    lightbox.remove();
  }, { initialFocus: closeBtn });
  closeBtn.onclick = close;

  document.addEventListener('keydown', onKey);
}
