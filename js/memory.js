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
  const closeModal = () => { revokePreview(); modal.remove(); };

  modal.querySelector('.popup-close').onclick = closeModal;
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  modal.querySelector('#memory-file').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const preview = modal.querySelector('#memory-preview');
    revokePreview();
    previewBlobUrl = URL.createObjectURL(file);
    preview.innerHTML = file.type.startsWith('video')
      ? `<video src="${previewBlobUrl}" controls style="max-width:100%; border-radius:8px; margin-top:8px"></video>`
      : `<img src="${previewBlobUrl}" style="max-width:100%; border-radius:8px; margin-top:8px" />`;
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

    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';

    try {
      const formData = new FormData();
      formData.append('file', file);

      const uploadRes = await fetch(`${API}/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${Auth.getToken()}` },
        body: formData
      });
      const { url, type, error } = await uploadRes.json();
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

      closeModal();
      showPopup(project);

    } catch (e) {
      errorEl.textContent = 'Upload failed. Try again.';
      errorEl.style.display = 'block';
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Upload';
    }
  };

  document.body.appendChild(modal);
}

/************************************************
 * MEMORY LIGHTBOX
 ************************************************/
function showMemoryLightbox(memories, startIndex, project) {
  let current = startIndex;

  const lightbox = document.createElement('div');
  lightbox.className = 'memory-lightbox';

  const render = () => {
    const m = memories[current];
    lightbox.innerHTML = `
      <div class="lightbox-inner">
        <button class="lightbox-close">✕</button>
        <button class="lightbox-nav prev" ${current === 0 ? 'disabled' : ''}>‹</button>
        <div class="lightbox-media">
          ${m.type === 'video'
            ? `<video src="${esc(m.url)}" controls autoplay></video>`
            : `<img src="${esc(m.url)}" alt="${esc(m.caption)}" />`
          }
          ${m.caption ? `<p class="lightbox-caption">${esc(m.caption)}</p>` : ''}
          <p class="lightbox-counter">${current + 1} / ${memories.length}</p>
        </div>
        <button class="lightbox-nav next" ${current === memories.length - 1 ? 'disabled' : ''}>›</button>
      </div>
    `;

    lightbox.querySelector('.lightbox-close').onclick = () => lightbox.remove();
    lightbox.querySelector('.prev').onclick = () => { if (current > 0) { current--; render(); } };
    lightbox.querySelector('.next').onclick = () => { if (current < memories.length - 1) { current++; render(); } };
    lightbox.onclick = (e) => { if (e.target === lightbox) lightbox.remove(); };
  };

  render();
  document.body.appendChild(lightbox);
}
