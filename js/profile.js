if (!Auth.isLoggedIn()) {
  window.location.href = '/index.html';
}

// --- DOM refs ---
const avatarImg      = document.getElementById('profile-avatar-img');
const avatarInitials = document.getElementById('profile-avatar-initials');
const usernameEl     = document.getElementById('profile-username');
const statWatched    = document.getElementById('stat-watched');
const statSessions   = document.getElementById('stat-sessions');
const statChars      = document.getElementById('stat-characters');
const statMemories   = document.getElementById('stat-memories');
const coWatcherWrap  = document.getElementById('profile-cowatcher');
const coWatcherName  = document.getElementById('cowatcher-name');
const changeBtn      = document.getElementById('change-avatar-btn');
const pickerWrap     = document.getElementById('avatar-picker');
const pickerGrid     = document.getElementById('avatar-picker-grid');
const pickerEmpty    = document.getElementById('avatar-picker-empty');

// --- Helpers ---
function setAvatar(src, username) {
  if (src) {
    avatarImg.src = src;
    avatarImg.alt = username;
    avatarImg.style.display = 'block';
    avatarInitials.style.display = 'none';
  } else {
    avatarImg.style.display = 'none';
    avatarInitials.textContent = (username || '?')[0].toUpperCase();
    avatarInitials.style.display = 'flex';
  }
}

function countUnlockedCharacters(watchedIds) {
  return characters.filter(c => watchedIds.has(c.debut)).length;
}

// --- Load profile from API ---
async function loadProfile() {
  const res = await fetch(`${API}/profile`, {
    headers: { Authorization: `Bearer ${Auth.getToken()}` }
  });
  const data = await res.json();
  if (data.error) return;

  usernameEl.textContent = data.username;
  setAvatar(data.profilePicture, data.username);

  statWatched.textContent  = data.stats.totalWatched;
  statSessions.textContent = data.stats.totalSessions;
  statMemories.textContent = data.stats.totalMemories;

  if (data.stats.topCoWatcher) {
    coWatcherName.textContent = data.stats.topCoWatcher;
    coWatcherWrap.style.display = 'block';
  }

  // Fetch watched IDs to count unlocked characters
  try {
    const progRes = await fetch(`${API}/progress/load`, {
      headers: { Authorization: `Bearer ${Auth.getToken()}` }
    });
    const prog = await progRes.json();
    const watchedIds = new Set(
      (prog.watchedProjects || []).filter(e => e.count > 0).map(e => e.projectId)
    );
    statChars.textContent = countUnlockedCharacters(watchedIds);

    // Build avatar picker with unlocked characters
    buildAvatarPicker(watchedIds, data.profilePicture);
  } catch {
    statChars.textContent = '?';
  }
}

// --- Avatar picker ---
function buildAvatarPicker(watchedIds, currentPic) {
  const unlocked = characters.filter(c => watchedIds.has(c.debut));

  if (!unlocked.length) {
    pickerEmpty.style.display = 'block';
    return;
  }

  pickerGrid.innerHTML = '';
  unlocked.forEach(c => {
    const src = `assets/characters/${c.image}`;
    const btn = document.createElement('button');
    btn.className = 'avatar-option' + (src === currentPic ? ' selected' : '');
    btn.title = c.name;

    const img = document.createElement('img');
    img.src = src;
    img.alt = c.name;
    btn.appendChild(img);

    btn.onclick = () => selectAvatar(src, btn);
    pickerGrid.appendChild(btn);
  });
}

async function selectAvatar(src, btn) {
  const res = await fetch(`${API}/profile/picture`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Auth.getToken()}`
    },
    body: JSON.stringify({ profilePicture: src })
  });
  const data = await res.json();
  if (data.error) return;

  setAvatar(src, usernameEl.textContent);

  // Update selected state in grid
  pickerGrid.querySelectorAll('.avatar-option').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
}

// --- Toggle picker visibility ---
changeBtn.addEventListener('click', () => {
  const willOpen = pickerWrap.hidden;
  pickerWrap.hidden = !willOpen;
  changeBtn.textContent = willOpen ? '✕' : '✎';
  if (willOpen) pickerWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

// --- Init ---
loadProfile();
