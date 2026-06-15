import Link from "next/link";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-mist bg-paper">
      <div className="container-wide flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-flame" />
          <span className="text-sm font-extrabold uppercase tracking-[0.18em] text-ink">
            buddy
          </span>
          <span className="ml-3 text-sm text-smoke">© {year} — alle Rechte vorbehalten.</span>
        </div>

        <nav aria-label="Rechtliches" className="flex items-center gap-6 text-sm text-smoke">
          <Link className="hover:text-ink" href="/impressum">Impressum</Link>
          <Link className="hover:text-ink" href="/datenschutz">Datenschutz</Link>
          <a className="hover:text-ink" href="mailto:vincent@get-buddy.com">Kontakt</a>
        </nav>
      </div>
    </footer>
  );
}
