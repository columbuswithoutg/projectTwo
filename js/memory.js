/************************************************
 * ADD MEMORY MODAL
 ************************************************/
async function showAddMemoryModal(project) {
  const modal = document.createElement('div');
  modal.className = 'auth-modal';
  modal.innerHTML = `
    <div class="auth-box">
      <button class="popup-close">✕</button>
      <h3>Add Memory</h3>
      <p style="color:#aaa; font-size:0.9rem">Upload a photo or video from watching ${esc(project.title)}</p>
      <input type="file" id="memory-file" accept="image/*,video/*" />
      <input type="text" id="memory-caption" placeholder="Caption (optional)" />
      <div id="memory-preview"></div>
      <p class="auth-error" style="display:none; color:red"></p>
      <button id="memory-upload-btn">Upload</button>
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
      const formData = new FormData();
      formData.append('file', file);

      // XHR (not fetch) so we can surface upload.onprogress.
      const uploadJson = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API}/upload`);
        xhr.setRequestHeader('Authorization', `Bearer ${Auth.getToken()}`);
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setProgress(ev.loaded / ev.total);
        };
        xhr.onload = () => {
          // Bytes are up; Cloudinary may still be processing — show an
          // indeterminate "almost there" state until the response lands.
          setProgress(1);
          progressWrap.classList.add('processing');
          try {
            const json = JSON.parse(xhr.responseText || '{}');
            if (xhr.status >= 200 && xhr.status < 300) resolve(json);
            else reject(new Error(json.error || `HTTP ${xhr.status}`));
          } catch (err) { reject(err); }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(formData);
      });

      const { url, type, error } = uploadJson;
      if (error) throw new Error(error);

      const saveRes = await fetch(`${API}/progress/memory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Auth.getToken()}`
        },
        body: JSON.stringify({ projectId: project.id, url, type, caption })
      });
      const saved = await saveRes.json();

      const entry = state.data.get(project.id);
      if (entry) entry.memories = saved.memories;

      close();
      showPopup(project);

    } catch (e) {
      errorEl.textContent = 'Upload failed. Try again.';
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

  const go = (delta) => {
    const next = current + delta;
    if (next >= 0 && next < memories.length) { current = next; render(); }
  };

  // ArrowLeft / ArrowRight mirror the on-screen prev/next buttons.
  function onKey(e) {
    if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
  }

  // Forwarder so render() can wire the close button before `close` exists
  // (it's only ever invoked on click, by which point close is assigned).
  const dismiss = () => close();

  const render = () => {
    const m = memories[current];
    lightbox.innerHTML = `
      <div class="lightbox-inner">
        <button class="lightbox-close" aria-label="Close">✕</button>
        <button class="lightbox-nav prev" aria-label="Previous" ${current === 0 ? 'disabled' : ''}>‹</button>
        <div class="lightbox-media">
          ${m.type === 'video'
            ? `<video src="${esc(m.url)}" controls autoplay></video>`
            : `<img src="${esc(m.url)}" alt="${esc(m.caption)}" loading="lazy" />`
          }
          ${m.caption ? `<p class="lightbox-caption">${esc(m.caption)}</p>` : ''}
          <p class="lightbox-counter">${current + 1} / ${memories.length}</p>
        </div>
        <button class="lightbox-nav next" aria-label="Next" ${current === memories.length - 1 ? 'disabled' : ''}>›</button>
      </div>
    `;

    lightbox.querySelector('.lightbox-close').onclick = dismiss;
    lightbox.querySelector('.prev').onclick = () => go(-1);
    lightbox.querySelector('.next').onclick = () => go(1);
  };

  render();
  document.body.appendChild(lightbox);

  const close = wireModalDismiss(lightbox, () => {
    document.removeEventListener('keydown', onKey);
    lightbox.remove();
  }, { initialFocus: lightbox.querySelector('.lightbox-close') });

  document.addEventListener('keydown', onKey);
}
