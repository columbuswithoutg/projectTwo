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
 * Depends on globals: io socket (passed in), Playground3D.
 ************************************************/
const VoiceManager = (() => {

  const FALLOFF_MAX = 25;       // world units; gain reaches 0 here
  const GAIN_RAMP_TIME = 0.05;  // seconds (setTargetAtTime time constant)
  const UPDATE_INTERVAL_MS = 100;
  const SPEAKING_RMS_THRESHOLD = 0.02;
  const ICE_CONFIG = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  };

  // ── start ──
  //
  // Options:
  //   socket               Live socket.io client from Multiplayer.getSocket()
  //   scope                'world' | 'home'
  //   getLocalState        () → { x, y, z, yaw, walking }
  //   getRemotePlayers     () → [{ id, x, y, z, username }, ...]
  //   onError(msg)         Optional — called on mic-permission/PC failure
  //   onPeerStateChange(peerId, {speaking, muted, connected})
  //
  // Returns { stop, mutePeer(peerId, muted), isMuted(peerId) }.
  function start(opts) {
    const { socket, scope, getLocalState, getRemotePlayers,
            onError, onPeerStateChange } = opts || {};
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
    let audioCtx = null;
    let updateTimer = null;
    const peers = new Map();  // peerId → { pc, audioEl, gain, src, analyser,
                              //            analyserBuf, muted, speaking }

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
        return localStream;
      } catch (e) {
        if (onError) onError('Microphone permission denied');
        else console.warn('[VoiceManager] mic failed', e && e.message);
        throw e;
      }
    }

    // ── per-peer connection ──

    function createPeer(peerId, shouldInitiate) {
      if (peers.has(peerId)) return peers.get(peerId);
      const pc = new RTCPeerConnection(ICE_CONFIG);
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      // Muting the element prevents the browser routing it to the default
      // output — we route the captured MediaStream through WebAudio + GainNode
      // instead so distance attenuation actually works.
      audioEl.muted = true;
      document.body.appendChild(audioEl);

      const entry = {
        pc,
        audioEl,
        gain: null,
        src: null,
        analyser: null,
        analyserBuf: null,
        muted: false,
        speaking: false
      };
      peers.set(peerId, entry);

      // Add local mic tracks (already acquired by caller).
      if (localStream) {
        localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
      }

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit('voice:signal', {
            to: peerId, kind: 'ice', data: e.candidate.toJSON()
          });
        }
      };

      pc.ontrack = (e) => {
        const stream = e.streams && e.streams[0];
        if (!stream) return;
        audioEl.srcObject = stream;
        const ctx = ensureAudioCtx();
        try {
          const src = ctx.createMediaStreamSource(stream);
          const gain = ctx.createGain();
          gain.gain.value = 0;
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

      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (s === 'failed' || s === 'closed' || s === 'disconnected') {
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

    async function startOffer(peerId) {
      const entry = peers.get(peerId);
      if (!entry) return;
      const offer = await entry.pc.createOffer({
        offerToReceiveAudio: true, offerToReceiveVideo: false
      });
      await entry.pc.setLocalDescription(offer);
      socket.emit('voice:signal', {
        to: peerId, kind: 'offer', data: { type: offer.type, sdp: offer.sdp }
      });
    }

    async function handleSignal({ from, kind, data }) {
      if (!from || stopped) return;
      let entry = peers.get(from);

      if (kind === 'offer') {
        // Glare-safe: incoming offer always wins — drop our half-baked PC
        // and start fresh as the answerer.
        if (entry) destroyPeer(from);
        entry = createPeer(from, false);
        try {
          await entry.pc.setRemoteDescription(new RTCSessionDescription(data));
          const answer = await entry.pc.createAnswer();
          await entry.pc.setLocalDescription(answer);
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
        if (!entry) return;
        try {
          await entry.pc.setRemoteDescription(new RTCSessionDescription(data));
        } catch (e) {
          console.warn('[VoiceManager] setRemote(answer) failed', e && e.message);
        }
        return;
      }
      if (kind === 'ice') {
        if (!entry) return;
        try {
          await entry.pc.addIceCandidate(new RTCIceCandidate(data));
        } catch (e) {
          // Common when remote description isn't set yet — non-fatal.
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

    // ── distance loop ──

    function distance2D(ax, az, bx, bz) {
      const dx = ax - bx, dz = az - bz;
      return Math.sqrt(dx * dx + dz * dz);
    }

    function computeGain(dist) {
      if (dist >= FALLOFF_MAX) return 0;
      if (dist <= 0) return 1;
      return 1 - (dist / FALLOFF_MAX);
    }

    function updateTick() {
      if (stopped) return;
      const local = getLocalState();
      if (!local) return;
      const remotes = getRemotePlayers() || [];
      const remoteById = new Map();
      for (const r of remotes) remoteById.set(r.id, r);

      const ctxTime = audioCtx ? audioCtx.currentTime : 0;

      peers.forEach((entry, peerId) => {
        const rp = remoteById.get(peerId);
        // If we don't know where the peer is yet (snapshot lag), default
        // to silent so we don't blast at full volume from across the map.
        let target = 0;
        if (rp) {
          const dist = distance2D(local.x, local.z, rp.x, rp.z);
          target = computeGain(dist);
        }
        if (entry.muted) target = 0;
        if (entry.gain && audioCtx) {
          entry.gain.gain.setTargetAtTime(target, ctxTime, GAIN_RAMP_TIME);
        }

        // Voice activity detection — RMS over the analyser buffer.
        if (entry.analyser && entry.analyserBuf) {
          entry.analyser.getByteTimeDomainData(entry.analyserBuf);
          let sumSq = 0;
          for (let i = 0; i < entry.analyserBuf.length; i++) {
            const v = (entry.analyserBuf[i] - 128) / 128;
            sumSq += v * v;
          }
          const rms = Math.sqrt(sumSq / entry.analyserBuf.length);
          const speakingNow = rms > SPEAKING_RMS_THRESHOLD && !entry.muted && target > 0.05;
          if (speakingNow !== entry.speaking) {
            entry.speaking = speakingNow;
            if (onPeerStateChange) {
              onPeerStateChange(peerId, { speaking: speakingNow, muted: entry.muted });
            }
          }
        }
      });
    }

    // ── signaling listeners ──

    function onVoicePeers({ scope: s, peers: peerList }) {
      if (s !== scope) return;
      // Initiate to peers with lower socket.id (deterministic glare avoidance).
      for (const peerId of (peerList || [])) {
        const shouldInitiate = String(socket.id) < String(peerId);
        createPeer(peerId, shouldInitiate);
      }
    }

    function onPeerJoined({ id }) {
      if (!id || id === socket.id) return;
      // The existing peer (us) initiates to the new arrival.
      createPeer(id, true);
    }

    function onPeerLeft({ id }) {
      destroyPeer(id);
    }

    socket.on('voice:peers', onVoicePeers);
    socket.on('voice:peer-joined', onPeerJoined);
    socket.on('voice:peer-left', onPeerLeft);
    socket.on('voice:signal', handleSignal);

    // ── boot ──

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
        socket.emit('voice:announce', { scope });
      } catch (e) {
        stop();
      }
    })();

    updateTimer = setInterval(updateTick, UPDATE_INTERVAL_MS);

    // ── stop ──

    function stop() {
      if (stopped) return;
      stopped = true;
      if (updateTimer) { clearInterval(updateTimer); updateTimer = null; }
      try { socket.emit('voice:leave'); } catch (_) {}
      socket.off('voice:peers', onVoicePeers);
      socket.off('voice:peer-joined', onPeerJoined);
      socket.off('voice:peer-left', onPeerLeft);
      socket.off('voice:signal', handleSignal);
      [...peers.keys()].forEach(destroyPeer);
      if (localStream) {
        localStream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
        localStream = null;
      }
      if (audioCtx) {
        try { audioCtx.close(); } catch (_) {}
        audioCtx = null;
      }
    }

    function mutePeer(peerId, muted) {
      const entry = peers.get(peerId);
      if (!entry) return;
      entry.muted = !!muted;
      if (onPeerStateChange) {
        onPeerStateChange(peerId, { muted: entry.muted, speaking: false });
      }
    }

    function isMuted(peerId) {
      const entry = peers.get(peerId);
      return !!(entry && entry.muted);
    }

    return { stop, mutePeer, isMuted };
  }

  function noopHandle() {
    return { stop() {}, mutePeer() {}, isMuted() { return false; } };
  }

  return { start };
})();
