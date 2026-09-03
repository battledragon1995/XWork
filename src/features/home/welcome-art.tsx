/**
 * The 300×200 illustration of a miniature XWork window from the Welcome wireframe. It carries
 * no information the copy does not already state, so it is hidden from assistive technology
 * and takes every color from a repository token class instead of a hex literal.
 */
export function WelcomeArt() {
  return (
    <svg
      data-slot="welcome-art"
      width="300"
      height="200"
      viewBox="0 0 300 200"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Window frame, title bar and the sidebar divider. */}
      <rect x="8" y="8" width="284" height="184" rx="14" className="stroke-ink" strokeWidth="1.5" />
      <path d="M8 40h284" className="stroke-ink" strokeWidth="1.5" />
      <path d="M72 40v152" className="stroke-ink" strokeWidth="1.5" />
      <circle cx="24" cy="24" r="3" className="fill-brand" />
      <path d="M36 24h30" className="stroke-ink opacity-45" strokeWidth="1.5" />

      {/* Sidebar entries. */}
      <path d="M20 60h36M20 78h36M20 96h36" className="stroke-ink opacity-45" strokeWidth="1.5" />

      {/* The three dark panes of a session workspace. */}
      <rect x="84" y="52" width="96" height="128" rx="8" className="fill-dark" />
      <rect x="188" y="52" width="96" height="60" rx="8" className="fill-dark" />
      <rect x="188" y="120" width="96" height="60" rx="8" className="fill-dark" />

      {/* Terminal output, an active caret and two assistant panes. */}
      <path
        d="M96 68h40M96 80h28M96 92h52M96 104h20"
        className="stroke-on-dark opacity-55"
        strokeWidth="1.5"
      />
      <path d="M96 128h10" className="stroke-teal" strokeWidth="2" />
      <rect x="110" y="123" width="6" height="10" className="fill-on-dark" />
      <path
        d="M200 68h36M200 80h50M200 92h24"
        className="stroke-on-dark opacity-55"
        strokeWidth="1.5"
      />
      <path d="M200 136h44M200 148h30" className="stroke-on-dark opacity-55" strokeWidth="1.5" />
      <path d="M200 160h12" className="stroke-brand" strokeWidth="2" />
    </svg>
  );
}
