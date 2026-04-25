// Extracted from spa.html so the <script> tag can use `defer` — inline
// scripts don't respect defer, which forced every other script above them
// to run synchronously.
Router.register('/', AppView);
Router.register('/login', LoginView);
Router.register('/profile', ProfileView);
Router.register('/characters', CharactersView);
Router.init('app');

// Best-effort flush of the debounced progress save when the tab is hidden or
// closed — pagehide fires on mobile Safari where beforeunload does not.
// The fetch inside _persistNow uses keepalive so the browser preserves it
// across the navigation.
window.addEventListener('pagehide', () => state?.flushPersist?.());
