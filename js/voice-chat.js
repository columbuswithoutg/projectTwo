/************************************************
 * VOICE CHAT — WebRTC proximity voice for /world and /home.
 *
 * Used by:
 *   - js/views/world.js       → scope: 'world'
 *   - js/views/home.js        → scope: 'home'
 *   - js/views/friend-home.js → scope: 'home'
 *
 * Architecture: P2P mesh. Every voice-enabled peer in the same room
 * opens an RTCPeerConnection with every other voice-enabled peer.
 * Audio never touches the server — only signaling (SDP offer/answer,
 * ICE candidates) is relayed through Socket.IO `voice:signal` events.
 *
 * Distance-based volume: a 100ms loop reads the local player's position
 * from Playground3D.getLocalState() and each remote's interpolated
 * position from Playground3D.getRemotePlayers(), then sets the per-peer
 * GainNode using a linear falloff (full at 0u → silent at 25u).
 *
 * Diagnostics: handle._diag() returns a live snapshot of per-peer state
 * (connection state, ICE state, inbound audio level, getStats() byte
 * counters). VoiceManager.openDebugPanel(handle, anchorEl) shows it as
 * a floating overlay (right-click 🎙️ button in the views). Console
 * logs every state transition with [Voice:scope:peer] prefixes.
 *
 * Depends on globals: io socket (passed in), Playground3D.
 ************************************************/
const VoiceManager = (() => {

  const FALLOFF_MAX = 25;       // world units; gain reaches 0 here
  const GAIN_RAMP_TIME = 0.05;  // seconds (setTargetAtTime time constant)
  const UPDATE_INTERVAL_MS = 100;
  const STATS_INTERVAL_MS = 5000;
  const SPEAKING_RMS_THRESHOLD = 0.01;
  // voice:announce is retried until the server's voice:peers reply
  // confirms membership — covers lost replies and the home-scope race
  // where the async home:join hasn't landed when we announce.
  const ANNOUNCE_RETRY_MS = 2000;
  const ANNOUNCE_MAX_TRIES = 5;

  // Default config — STUN only. The actual config used for new
  // RTCPeerConnections is fetched per-session from /api/config/voice-turn
  // in boot() and assigned to the inner `_iceConfig`. If that fetch fails
  // (offline / endpoint missing on older deploys), this default is used as
  // the fallback. To enable TURN for cross-NAT pairs (cellular, strict
  // NAT, corporate firewalls), set TURN_URLS / TURN_USERNAME /
  // TURN_CREDENTIAL in the server's .env — see routes/config.js.
  const DEFAULT_ICE_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ],
    iceCandidatePoolSize: 2
  };

  let _lastHandle = null;
  let _openPanel = null;

  // ── start ──
  //
  // Options:
  //   socket               Live socket.io client from Multiplayer.getSocket()
  //   scope                'world' | 'home'
  //   getLocalState        () → { x, y, z, yaw, walking }
  //   getRemotePlayers     () → [{ id, x, y, z, username }, ...]
  //   onError(msg)         Optional — called on fatal failure (no WebRTC)
  //   onMicUnavailable(msg) Optional — mic missing/denied; session continues
  //                        in listen-only mode (hear others, can't speak)
  //   onPeerStateChange(peerId, {speaking, muted, connected})
  //
  // Returns { stop, mutePeer, isMuted, _diag, scope }.
  function start(opts) {
    const { socket, scope, getLocalState, getRemotePlayers,
            onError, onMicUnavailable, onPeerStateChange } = opts || {};
    if (!socket || !scope || !getLocalState || !getRemotePlayers) {
      console.warn('[VoiceManager] missing required option');
      return noopHandle();
    }
    if (typeof RTCPeerConnection === 'undefined' ||
        !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const msg = 'WebRTC not supported in this browser';
      if (onError) onError(msg);
      else console.warn('[VoiceManager]', msg);
      return noopHandle();
    }

    let stopped = false;
    let localStream = null;
    let micState = 'pending';        // 'pending' | 'ok' | 'denied' | 'none'
    let audioCtx = null;
    let localAnalyser = null;
    let localAnalyserBuf = null;
    let localSrc = null;
    let localLevel = 0;
    let updateTimer = null;
    let statsTimer = null;
    let announceTimer = null;
    let announceConfirmed = false;
    // Per-session ICE config — replaced by fetchIceConfig() in boot() with
    // the server's response if it includes TURN. Falls back to STUN-only.
    let _iceConfig = DEFAULT_ICE_CONFIG;
    const peers = new Map();  // peerId → entry (see createPeer)

    function shortId(id) { return id ? String(id).slice(0, 6) : '??'; }
    function isDeadPc(pc) {
      const s = pc.connectionState;
      return s === 'failed' || s === 'closed' || s === 'disconnected';
    }
    function _log(peerId, ...rest) {
      const tag = '[Voice:' + scope + ':' + shortId(peerId) + ']';
      console.log(tag, ...rest);
    }

    // ── audio plumbing ──

    function ensureAudioCtx() {
      if (audioCtx) return audioCtx;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
      return audioCtx;
    }

    async function acquireMic() {
      if (localStream) return localStream;
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        micState = 'ok';
        const trackInfo = localStream.getTracks()
          .map(t => t.label || t.kind).join(', ') || 'unnamed';
        _log(null, 'mic acquired (' + localStream.getTracks().length + ' track: ' + trackInfo + ')');

        // Local mic level meter for the diagnostics panel.
        try {
          const ctx = ensureAudioCtx();
          localSrc = ctx.createMediaStreamSource(localStream);
          localAnalyser = ctx.createAnalyser();
          localAnalyser.fftSize = 512;
          localAnalyserBuf = new Uint8Array(localAnalyser.fftSize);
          localSrc.connect(localAnalyser);
          // NOT connected to destination — would echo the user's own voice.
        } catch (e) {
          console.warn('[VoiceManager] local analyser failed', e && e.message);
        }
        return localStream;
      } catch (e) {
        // No mic (or permission denied) is NOT fatal — continue in
        // listen-only mode. createPeer() guards `if (localStream)`, so
        // connections simply carry no outgoing track and the SDP
        // negotiation degrades to receive-only on our side.
        micState = (e && e.name === 'NotAllowedError') ? 'denied' : 'none';
        const msg = micState === 'denied'
          ? 'Microphone permission denied — listen-only'
          : 'No microphone found — listen-only';
        _log(null, 'mic unavailable (' + (e && e.name) + ') — listen-only mode');
        if (onMicUnavailable) onMicUnavailable(msg);
        return null;
      }
    }

    // ── per-peer connection ──

    function createPeer(peerId, shouldInitiate) {
      if (peers.has(peerId)) return peers.get(peerId);
      const pc = new RTCPeerConnection(_iceConfig);

      // Hidden <audio> element — needed for Chrome to actually pump the
      // WebRTC stream through WebAudio. Setting volume = 0 (NOT muted) so
      // the pipeline runs but the element produces no audible output;
      // WebAudio handles the actual distance-attenuated playback.
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      audioEl.volume = 0;
      audioEl.style.display = 'none';
      document.body.appendChild(audioEl);

      const entry = {
        pc,
        audioEl,
        gain: null,
        src: null,
        analyser: null,
        analyserBuf: null,
        muted: false,
        speaking: false,
        username: null,
        distance: 0,
        gainTarget: 1,
        lastStats: { bytesReceived: 0, packetsLost: 0, ts: 0 },
        iceCandidateTypes: [],
        remoteIceCandidateTypes: [],
        // Candidates received before setRemoteDescription must be buffered;
        // addIceCandidate throws InvalidStateError until a remote desc exists.
        // On localhost (same-machine pair) the dropped candidates are the
        // host ones — the only ones that can succeed without TURN — so
        // losing them means ICE fails entirely.
        pendingIce: [],
        selectedPair: null
      };
      peers.set(peerId, entry);

      // Add local mic tracks (already acquired by caller).
      if (localStream) {
        localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
      }

      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        const type = e.candidate.type || extractCandidateType(e.candidate.candidate);
        if (type) entry.iceCandidateTypes.push(type);
        _log(peerId, 'iceCandidate gathered', type || '?');
        socket.emit('voice:signal', {
          to: peerId, kind: 'ice', data: e.candidate.toJSON()
        });
      };

      pc.ontrack = (e) => {
        const stream = e.streams && e.streams[0];
        if (!stream) { _log(peerId, 'ontrack with no stream'); return; }
        _log(peerId, 'ontrack —', e.streams.length, 'stream(s),',
          stream.getAudioTracks().length, 'audio track(s)');
        audioEl.srcObject = stream;
        const ctx = ensureAudioCtx();
        try {
          const src = ctx.createMediaStreamSource(stream);
          const gain = ctx.createGain();
          // Start at full volume so audio plays immediately. The 100ms
          // distance loop will attenuate as soon as positions sync.
          gain.gain.value = 1;
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          src.connect(analyser);
          src.connect(gain);
          gain.connect(ctx.destination);
          entry.src = src;
          entry.gain = gain;
          entry.analyser = analyser;
          entry.analyserBuf = new Uint8Array(analyser.fftSize);
        } catch (e2) {
          console.warn('[VoiceManager] WebAudio wiring failed', e2);
        }
      };

      pc.oniceconnectionstatechange = () => {
        _log(peerId, 'iceState →', pc.iceConnectionState);
      };

      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        _log(peerId, 'connState →', s);
        if (s === 'failed') {
          // ICE exhausted — this PC is dead for good. Tear it down and,
          // if we're the deterministic initiator, immediately rebuild
          // with a fresh offer. The other side rebuilds on that offer
          // (or via its own 'failed' handler). ICE timeouts make any
          // fail→rebuild loop self-limiting.
          _log(peerId, 'connection failed — rebuilding');
          destroyPeer(peerId);
          if (!stopped && String(socket.id) < String(peerId)) {
            createPeer(peerId, true);
          }
          return;
        }
        if (s === 'closed' || s === 'disconnected') {
          if (onPeerStateChange) {
            onPeerStateChange(peerId, { connected: false, speaking: false });
          }
        } else if (s === 'connected' && onPeerStateChange) {
          onPeerStateChange(peerId, { connected: true });
        }
      };

      if (shouldInitiate) {
        startOffer(peerId).catch(err =>
          console.warn('[VoiceManager] offer failed', err && err.message));
      }
      return entry;
    }

    function extractCandidateType(candStr) {
      if (!candStr) return null;
      const m = /\btyp\s+(\S+)/i.exec(candStr);
      return m ? m[1] : null;
    }

    async function startOffer(peerId) {
      const entry = peers.get(peerId);
      if (!entry) return;
      const offer = await entry.pc.createOffer({
        offerToReceiveAudio: true, offerToReceiveVideo: false
      });
      await entry.pc.setLocalDescription(offer);
      _log(peerId, 'sent offer');
      socket.emit('voice:signal', {
        to: peerId, kind: 'offer', data: { type: offer.type, sdp: offer.sdp }
      });
    }

    async function flushPendingIce(peerId, entry) {
      if (!entry || !entry.pendingIce.length) return;
      const queued = entry.pendingIce.splice(0);
      _log(peerId, 'flushing', queued.length, 'buffered ICE candidate(s)');
      for (const cand of queued) {
        try {
          await entry.pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          _log(peerId, 'flush addIceCandidate failed', e && e.message);
        }
      }
    }

    async function handleSignal({ from, kind, data }) {
      if (!from || stopped) return;
      let entry = peers.get(from);

      if (kind === 'offer') {
        _log(from, 'received offer');
        // With the deterministic role rule (lower socket.id initiates) the
        // answerer never drives a local offer, so signalingState should be
        // 'stable' here and the existing PC is reusable. Destroy + recreate
        // if we somehow ended up with a local offer (true glare) OR the
        // existing PC is dead — a fresh offer from the peer means they
        // rebuilt their side, so renegotiating a corpse would only produce
        // a connection that never carries audio.
        if (entry && (entry.pc.signalingState !== 'stable' || isDeadPc(entry.pc))) {
          _log(from, 'recreating PC (signalingState=' + entry.pc.signalingState +
            ', connState=' + entry.pc.connectionState + ')');
          destroyPeer(from);
          entry = null;
        }
        if (!entry) entry = createPeer(from, false);
        try {
          await entry.pc.setRemoteDescription(new RTCSessionDescription(data));
          await flushPendingIce(from, entry);
          const answer = await entry.pc.createAnswer();
          await entry.pc.setLocalDescription(answer);
          _log(from, 'sent answer');
          socket.emit('voice:signal', {
            to: from, kind: 'answer',
            data: { type: answer.type, sdp: answer.sdp }
          });
        } catch (e) {
          console.warn('[VoiceManager] answer failed', e && e.message);
        }
        return;
      }
      if (kind === 'answer') {
        _log(from, 'received answer');
        if (!entry) return;
        try {
          await entry.pc.setRemoteDescription(new RTCSessionDescription(data));
          await flushPendingIce(from, entry);
        } catch (e) {
          console.warn('[VoiceManager] setRemote(answer) failed', e && e.message);
        }
        return;
      }
      if (kind === 'ice') {
        if (!entry) return;
        const type = (data && data.candidate) ? extractCandidateType(data.candidate) : null;
        if (type) entry.remoteIceCandidateTypes.push(type);
        // Buffer until remote description exists — otherwise addIceCandidate
        // throws InvalidStateError and the candidate is permanently lost.
        if (!entry.pc.remoteDescription) {
          entry.pendingIce.push(data);
          return;
        }
        try {
          await entry.pc.addIceCandidate(new RTCIceCandidate(data));
        } catch (e) {
          _log(from, 'addIceCandidate failed', e && e.message);
        }
      }
    }

    function destroyPeer(peerId) {
      const entry = peers.get(peerId);
      if (!entry) return;
      try { entry.pc.close(); } catch (_) {}
      if (entry.audioEl) {
        entry.audioEl.srcObject = null;
        if (entry.audioEl.parentNode) entry.audioEl.parentNode.removeChild(entry.audioEl);
      }
      try { if (entry.src) entry.src.disconnect(); } catch (_) {}
      try { if (entry.gain) entry.gain.disconnect(); } catch (_) {}
      try { if (entry.analyser) entry.analyser.disconnect(); } catch (_) {}
      peers.delete(peerId);
      if (onPeerStateChange) {
        onPeerStateChange(peerId, { connected: false, speaking: false });
      }
    }

    // ── distance loop + level computation ──

    function distance2D(ax, az, bx, bz) {
      const dx = ax - bx, dz = az - bz;
      return Math.sqrt(dx * dx + dz * dz);
    }

    function computeGain(dist) {
      if (dist >= FALLOFF_MAX) return 0;
      if (dist <= 0) return 1;
      return 1 - (dist / FALLOFF_MAX);
    }

    function rmsFromBuffer(buf) {
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sumSq += v * v;
      }
      return Math.sqrt(sumSq / buf.length);
    }

    function updateTick() {
      if (stopped) return;

      // Local mic level for the diagnostics panel.
      if (localAnalyser && localAnalyserBuf) {
        localAnalyser.getByteTimeDomainData(localAnalyserBuf);
        localLevel = rmsFromBuffer(localAnalyserBuf);
      }

      const local = getLocalState();
      if (!local) return;
      const remotes = getRemotePlayers() || [];
      const remoteById = new Map();
      for (const r of remotes) remoteById.set(r.id, r);

      const ctxTime = audioCtx ? audioCtx.currentTime : 0;

      peers.forEach((entry, peerId) => {
        const rp = remoteById.get(peerId);
        let target;
        if (rp) {
          if (rp.username) entry.username = rp.username;
          entry.distance = distance2D(local.x, local.z, rp.x, rp.z);
          target = computeGain(entry.distance);
        } else {
          // Peer not yet in the position snapshot. Stay audible (full
          // volume) so users can hear each other immediately, even before
          // the position broadcaster fires for the first time.
          entry.distance = 0;
          target = 1;
        }
        if (entry.muted) target = 0;
        entry.gainTarget = target;
        if (entry.gain && audioCtx) {
          entry.gain.gain.setTargetAtTime(target, ctxTime, GAIN_RAMP_TIME);
        }

        // Voice activity detection — RMS over the analyser buffer.
        if (entry.analyser && entry.analyserBuf) {
          entry.analyser.getByteTimeDomainData(entry.analyserBuf);
          const rms = rmsFromBuffer(entry.analyserBuf);
          entry.lastInbound = rms;
          const speakingNow = rms > SPEAKING_RMS_THRESHOLD && !entry.muted;
          if (speakingNow !== entry.speaking) {
            entry.speaking = speakingNow;
            if (onPeerStateChange) {
              onPeerStateChange(peerId, { speaking: speakingNow, muted: entry.muted });
            }
          }
        }
      });
    }

    // ── periodic getStats() sampler ──

    async function sampleStats() {
      if (stopped) return;
      const now = Date.now();
      for (const [peerId, entry] of peers) {
        try {
          const report = await entry.pc.getStats();
          let bytesReceived = 0;
          let packetsLost = 0;
          let nominatedPair = null;
          const localCands = new Map();
          const remoteCands = new Map();
          report.forEach(s => {
            if (s.type === 'inbound-rtp' && (s.kind === 'audio' || s.mediaType === 'audio')) {
              bytesReceived += (s.bytesReceived || 0);
              packetsLost   += (s.packetsLost   || 0);
            }
            if (s.type === 'local-candidate')  localCands.set(s.id, s);
            if (s.type === 'remote-candidate') remoteCands.set(s.id, s);
            if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated) {
              nominatedPair = s;
            }
          });
          let selectedPair = null;
          if (nominatedPair) {
            const l = localCands.get(nominatedPair.localCandidateId);
            const r = remoteCands.get(nominatedPair.remoteCandidateId);
            selectedPair = {
              local:  l && (l.candidateType || l.type) || '?',
              remote: r && (r.candidateType || r.type) || '?'
            };
          }
          entry.lastStats = { bytesReceived, packetsLost, ts: now };
          entry.selectedPair = selectedPair;
          _log(peerId, 'stats bytesReceived=' + bytesReceived,
            'packetsLost=' + packetsLost,
            'iceState=' + entry.pc.iceConnectionState,
            'pair=' + (selectedPair ? selectedPair.local + '↔' + selectedPair.remote : 'none'));
        } catch (_) { /* PC may be closed */ }
      }
    }

    // ── signaling listeners ──

    function onVoicePeers({ scope: s, peers: peerList }) {
      if (s !== scope) return;
      announceConfirmed = true;
      _log(null, 'voice:peers snapshot (' + (peerList || []).length + ' existing)');
      // Initiate to peers with lower socket.id (deterministic glare avoidance).
      for (const peerId of (peerList || [])) {
        const shouldInitiate = String(socket.id) < String(peerId);
        createPeer(peerId, shouldInitiate);
      }
    }

    function onPeerJoined({ id }) {
      if (!id || id === socket.id) return;
      _log(id, 'voice:peer-joined');
      // A peer-joined for an id we already track means that peer started
      // a fresh voice session (rejoin or re-announce) — its old
      // RTCPeerConnection is gone, so ours is necessarily stale. If we
      // kept it, createPeer would return it and silently skip initiating,
      // deadlocking the handshake. Rebuild from scratch.
      if (peers.has(id)) {
        _log(id, 'stale entry for rejoining peer — rebuilding');
        destroyPeer(id);
      }
      // Same deterministic rule as onVoicePeers (lower socket.id
      // initiates) — unconditional initiation here would cause
      // offer-glare ~half the time.
      const shouldInitiate = String(socket.id) < String(id);
      createPeer(id, shouldInitiate);
    }

    function onPeerLeft({ id }) {
      _log(id, 'voice:peer-left');
      destroyPeer(id);
    }

    // Announce membership, retrying until the server's voice:peers reply
    // confirms it (server announce is idempotent, so retries are safe).
    function announce() {
      if (announceTimer) { clearTimeout(announceTimer); announceTimer = null; }
      announceConfirmed = false;
      let tries = 0;
      const attempt = () => {
        announceTimer = null;
        if (stopped || announceConfirmed) return;
        tries++;
        socket.emit('voice:announce', { scope });
        _log(null, 'announce scope=' + scope + ' (attempt ' + tries + ')');
        if (tries < ANNOUNCE_MAX_TRIES) {
          announceTimer = setTimeout(attempt, ANNOUNCE_RETRY_MS);
        }
      };
      attempt();
    }

    // Socket reconnects get a NEW socket.id and a fresh server-side
    // socket.data — the server already purged our voice membership in its
    // disconnect handler, so every peer connection is dead and our signals
    // would be silently dropped. Rebuild: drop all peers, re-announce.
    // (Multiplayer's own 'connect' handler re-joins presence first — it
    // was registered earlier, and Socket.IO fires listeners in order.)
    function onReconnect() {
      if (stopped) return;
      _log(null, 'socket reconnected (id=' + shortId(socket.id) + ') — rebuilding voice session');
      [...peers.keys()].forEach(destroyPeer);
      announce();
    }

    socket.on('voice:peers', onVoicePeers);
    socket.on('voice:peer-joined', onPeerJoined);
    socket.on('voice:peer-left', onPeerLeft);
    socket.on('voice:signal', handleSignal);
    socket.on('connect', onReconnect);

    // ── boot ──

    // Fetch the server-side ICE config (STUN + optional TURN) and stash it
    // in _iceConfig. Best-effort: any failure leaves DEFAULT_ICE_CONFIG in
    // place, so the only consequence is "no TURN, same as before."
    async function fetchIceConfig() {
      try {
        const base = (typeof API === 'string' && API) || '';
        const token = (typeof Auth !== 'undefined' && Auth.getToken) ? Auth.getToken() : null;
        const headers = token ? { Authorization: 'Bearer ' + token } : {};
        const res = await fetch(base + '/config/voice-turn', { headers });
        if (!res.ok) {
          _log(null, 'fetch ice config: ' + res.status + ' — falling back to STUN-only');
          return;
        }
        const json = await res.json();
        if (json && Array.isArray(json.iceServers) && json.iceServers.length) {
          _iceConfig = {
            iceServers: json.iceServers,
            iceCandidatePoolSize: 2
          };
          const hasTurn = json.iceServers.some(s => {
            const u = s && s.urls;
            const arr = Array.isArray(u) ? u : [u];
            return arr.some(x => typeof x === 'string' && x.indexOf('turn:') === 0);
          });
          _log(null, 'ice config: ' + json.iceServers.length + ' server(s), TURN ' +
            (hasTurn ? 'configured' : 'absent'));
        }
      } catch (e) {
        _log(null, 'fetch ice config failed', e && e.message);
      }
    }

    (async function boot() {
      try {
        ensureAudioCtx();
        if (audioCtx.state === 'suspended') {
          // Triggered from a user-gesture handler in the view (button click),
          // so this resolves immediately under iOS Safari's autoplay policy.
          try { await audioCtx.resume(); } catch (_) {}
        }
        await acquireMic();
        if (stopped) return;
        await fetchIceConfig();
        if (stopped) return;
        announce();
      } catch (e) {
        stop();
      }
    })();

    updateTimer = setInterval(updateTick, UPDATE_INTERVAL_MS);
    statsTimer  = setInterval(sampleStats, STATS_INTERVAL_MS);

    // ── stop ──

    function stop() {
      if (stopped) return;
      stopped = true;
      if (updateTimer) { clearInterval(updateTimer); updateTimer = null; }
      if (statsTimer)  { clearInterval(statsTimer);  statsTimer = null; }
      if (announceTimer) { clearTimeout(announceTimer); announceTimer = null; }
      try { socket.emit('voice:leave'); } catch (_) {}
      socket.off('voice:peers', onVoicePeers);
      socket.off('voice:peer-joined', onPeerJoined);
      socket.off('voice:peer-left', onPeerLeft);
      socket.off('voice:signal', handleSignal);
      socket.off('connect', onReconnect);
      [...peers.keys()].forEach(destroyPeer);
      if (localStream) {
        localStream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
        localStream = null;
      }
      try { if (localSrc) localSrc.disconnect(); } catch (_) {}
      try { if (localAnalyser) localAnalyser.disconnect(); } catch (_) {}
      if (audioCtx) {
        try { audioCtx.close(); } catch (_) {}
        audioCtx = null;
      }
      if (_openPanel) { try { _openPanel.close(); } catch (_) {} _openPanel = null; }
      if (_lastHandle === handle) _lastHandle = null;
    }

    function mutePeer(peerId, muted) {
      const entry = peers.get(peerId);
      if (!entry) return;
      entry.muted = !!muted;
      _log(peerId, entry.muted ? 'locally muted' : 'unmuted');
      if (onPeerStateChange) {
        onPeerStateChange(peerId, { muted: entry.muted, speaking: false });
      }
    }

    function isMuted(peerId) {
      const entry = peers.get(peerId);
      return !!(entry && entry.muted);
    }

    function _diag() {
      const peerList = [];
      peers.forEach((entry, id) => {
        peerList.push({
          id,
          username: entry.username || ('peer ' + shortId(id)),
          connectionState: entry.pc.connectionState,
          iceConnectionState: entry.pc.iceConnectionState,
          signalingState: entry.pc.signalingState,
          inboundLevel: entry.lastInbound || 0,
          distance: entry.distance,
          gainTarget: entry.gainTarget,
          bytesReceived: entry.lastStats.bytesReceived,
          packetsLost: entry.lastStats.packetsLost,
          muted: entry.muted,
          iceCandidateTypes: entry.iceCandidateTypes.slice(),
          remoteIceCandidateTypes: entry.remoteIceCandidateTypes.slice(),
          pendingIce: entry.pendingIce.length,
          selectedPair: entry.selectedPair
        });
      });
      const servers = (_iceConfig && _iceConfig.iceServers) || [];
      const turnConfigured = servers.some(s => {
        const u = s && s.urls;
        const arr = Array.isArray(u) ? u : [u];
        return arr.some(x => typeof x === 'string' && x.indexOf('turn:') === 0);
      });
      return {
        scope,
        micState,
        localLevel,
        iceServerCount: servers.length,
        turnConfigured,
        peers: peerList
      };
    }

    const handle = { stop, mutePeer, isMuted, _diag, scope };
    _lastHandle = handle;
    return handle;
  }

  function noopHandle() {
    return {
      stop() {}, mutePeer() {}, isMuted() { return false; },
      _diag() { return { scope: null, micState: 'denied', localLevel: 0, peers: [] }; },
      scope: null
    };
  }

  // ── debug panel UI ──

  function openDebugPanel(handle, anchorEl) {
    if (!handle || !handle._diag) return null;
    if (_openPanel) { try { _openPanel.close(); } catch (_) {} _openPanel = null; }

    const panel = document.createElement('div');
    panel.className = 'pg3d-voice-debug';
    panel.innerHTML = `
      <div class="pg3d-voice-debug-head">
        <span class="pg3d-voice-debug-title">Voice diagnostics — ${escapeHtml(handle.scope || '')}</span>
        <button type="button" class="pg3d-voice-debug-close" aria-label="Close">×</button>
      </div>
      <div class="pg3d-voice-debug-body"></div>
    `;
    document.body.appendChild(panel);

    // Anchor near the button (above + left-aligned). Clamp to viewport.
    function position() {
      const a = anchorEl && anchorEl.getBoundingClientRect();
      const w = panel.offsetWidth || 300;
      const h = panel.offsetHeight || 200;
      let top, left;
      if (a) {
        top  = Math.max(8, a.top - h - 10);
        left = Math.min(window.innerWidth - w - 8, Math.max(8, a.right - w));
      } else {
        top  = Math.max(8, window.innerHeight - h - 80);
        left = Math.max(8, window.innerWidth - w - 16);
      }
      panel.style.top  = top  + 'px';
      panel.style.left = left + 'px';
    }
    position();
    window.addEventListener('resize', position);

    const body = panel.querySelector('.pg3d-voice-debug-body');

    function badge(state) {
      const cls = (state === 'connected' || state === 'completed') ? 'ok'
        : (state === 'failed' || state === 'closed' || state === 'disconnected') ? 'bad'
        : 'warn';
      return `<span class="pg3d-voice-badge ${cls}">${escapeHtml(state || '?')}</span>`;
    }

    function bar(level) {
      const pct = Math.min(100, Math.round((level || 0) * 100 * 2));
      return `<div class="pg3d-voice-bar"><div class="pg3d-voice-bar-fill" style="width:${pct}%"></div></div>`;
    }

    function render() {
      const d = handle._diag();
      const micCls = d.micState === 'ok' ? 'ok' : (d.micState === 'denied' ? 'bad' : 'warn');
      const rows = [];
      const turnCls = d.turnConfigured ? 'ok' : 'warn';
      const turnLabel = d.turnConfigured ? 'TURN configured' : 'STUN only';
      rows.push(`
        <div class="pg3d-voice-debug-row mic">
          <div class="pg3d-voice-debug-name">🎙 You <span class="pg3d-voice-badge ${micCls}">${escapeHtml(d.micState)}</span></div>
          ${bar(d.localLevel)}
          <div class="pg3d-voice-debug-meta">
            ICE: ${d.iceServerCount} server(s) · <span class="pg3d-voice-badge ${turnCls}">${escapeHtml(turnLabel)}</span>
          </div>
        </div>
      `);
      if (!d.peers.length) {
        rows.push(`<div class="pg3d-voice-debug-empty">No peers connected yet — waiting for someone else to join voice.</div>`);
      } else {
        for (const p of d.peers) {
          const kb = Math.round((p.bytesReceived || 0) / 1024);
          const tx = (p.iceCandidateTypes || []).join(',') || '–';
          const rx = (p.remoteIceCandidateTypes || []).join(',') || '–';
          const pair = p.selectedPair
            ? p.selectedPair.local + '↔' + p.selectedPair.remote
            : 'none';
          rows.push(`
            <div class="pg3d-voice-debug-row" data-peer="${escapeHtml(p.id)}">
              <div class="pg3d-voice-debug-name">
                ${escapeHtml(p.username)}
                ${badge(p.connectionState)}${badge(p.iceConnectionState)}
                <button type="button" class="pg3d-voice-mute" data-peer="${escapeHtml(p.id)}">${p.muted ? 'unmute' : 'mute'}</button>
              </div>
              ${bar(p.inboundLevel)}
              <div class="pg3d-voice-debug-meta">
                dist ${p.distance.toFixed(1)}u · gain ${(p.gainTarget * 100).toFixed(0)}%
                · ${kb} KB rx · loss ${p.packetsLost || 0}
              </div>
              <div class="pg3d-voice-debug-meta">
                ice tx:${escapeHtml(tx)} rx:${escapeHtml(rx)} · pending ${p.pendingIce} · pair ${escapeHtml(pair)}
              </div>
            </div>
          `);
        }
      }
      body.innerHTML = rows.join('');
      // Wire mute buttons (delegated would also work; keep it simple).
      body.querySelectorAll('.pg3d-voice-mute').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-peer');
          handle.mutePeer(id, !handle.isMuted(id));
          render();
        });
      });
      position();
    }
    render();
    const refresh = setInterval(render, 200);

    function onDocClick(e) {
      if (panel.contains(e.target)) return;
      if (anchorEl && anchorEl.contains(e.target)) return;
      close();
    }
    setTimeout(() => document.addEventListener('click', onDocClick), 0);

    panel.querySelector('.pg3d-voice-debug-close').addEventListener('click', close);

    function close() {
      clearInterval(refresh);
      window.removeEventListener('resize', position);
      document.removeEventListener('click', onDocClick);
      if (panel.parentNode) panel.parentNode.removeChild(panel);
      if (_openPanel && _openPanel.panel === panel) _openPanel = null;
    }

    _openPanel = { close, panel };
    return _openPanel;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  return {
    start,
    openDebugPanel,
    // Surface the last started handle for quick console poking:
    //   VoiceManager._lastHandle._diag()
    get _lastHandle() { return _lastHandle; }
  };
})();
