import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-mist/60 bg-paper/80 backdrop-blur supports-[backdrop-filter]:bg-paper/60">
      <div className="container-wide flex h-16 items-center justify-between">
        <Link href="/" className="group flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full bg-flame transition-transform group-hover:scale-110"
          />
          <span className="text-base font-extrabold uppercase tracking-[0.18em] text-ink">
            buddy
          </span>
        </Link>

        <nav aria-label="Hauptnavigation" className="hidden items-center gap-7 text-sm font-medium text-smoke sm:flex">
          <a className="hover:text-ink" href="#problem">Problem</a>
          <a className="hover:text-ink" href="#how-it-works">So funktioniert&apos;s</a>
          <a className="hover:text-ink" href="#safety">Sicherheit</a>
          <a className="hover:text-ink" href="#status">Status</a>
          <a className="hover:text-ink" href="#faq">FAQ</a>
        </nav>

        <a
          href="#waitlist"
          aria-label="Auf die Buddy-Warteliste eintragen"
          className="inline-flex h-10 items-center rounded-full bg-ink px-4 text-sm font-semibold text-paper transition hover:bg-purple"
        >
          Auf die Warteliste
        </a>
      </div>
    </header>
  );
}
