/** Required on every page (Constraints C-F1). Lives in the root layout so no route can forget it. */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border py-4 text-center text-xs text-fg-muted">
      Made with 💖 by Nabhanyu for Razorpay AI Buildathon
    </footer>
  );
}
