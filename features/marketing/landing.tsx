"use client";

// Marketing landing page. Client component so the hero-opener CSS keyframes
// fire on first paint (via .play class toggled after mount) and so we can wire
// IntersectionObserver for the section reveals. No animation library (CSS +
// IO only). Respects prefers-reduced-motion (final-state instant, no motion).

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LobbyeeLogo } from "@/components/logo";

export function Landing() {
  const stageRef = useRef<HTMLDivElement | null>(null);

  // Toggle .play on the hero stage AFTER hydration so the keyframes run once
  // on load. Using state (not a raw effect on the DOM) means SSR renders a
  // sane "final-ish" tree; the entrance kicks in only in the browser.
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    // requestAnimationFrame so the browser has a paint before we start
    // animating (the headline slide-in reads better this way).
    const r = requestAnimationFrame(() => setPlaying(true));
    return () => cancelAnimationFrame(r);
  }, []);

  // Scroll-reveal for sections below the fold. Uses a single shared observer
  // that adds .is-in the first time a `.reveal` element enters the viewport,
  // then unobserves it (one-shot). If reduced-motion is on, everything is
  // marked visible immediately so nothing is hidden waiting for scroll.
  useEffect(() => {
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const nodes = document.querySelectorAll<HTMLElement>(".reveal");
    if (prefersReduced) {
      for (const n of nodes) n.classList.add("is-in");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.14, rootMargin: "0px 0px -60px 0px" },
    );
    for (const n of nodes) io.observe(n);
    return () => io.disconnect();
  }, []);

  return (
    <div className="landing">
      {/* Scoped styles (keeps the marketing surface self-contained so nothing
          leaks into the auth-shell app). Ported from the approved motion
          reference, with token colors mapped to our Atrium palette. */}
      <style>{styles}</style>

      {/* ---------------- HERO ---------------- */}
      <div
        ref={stageRef}
        className={`stage ${playing ? "play" : ""}`}
        id="hero-stage"
      >
        <div className="glow g1" aria-hidden />
        <div className="glow g2" aria-hidden />
        <div className="glow g3" aria-hidden />
        <div className="grid-tex" aria-hidden />

        <nav className="lb-nav" aria-label="Primary">
          <span className="brand">
            <span className="mark-wrap">
              <HeroMark />
            </span>
            <span className="wm">Lobbyee</span>
          </span>
          <span className="navlinks">
            <a href="#product">Product</a>
            <a href="#pricing">Pricing</a>
            <Link href="/auth/signin">Sign in</Link>
            <Link href="/auth/signup" className="cta">
              Get started
            </Link>
          </span>
        </nav>

        <section className="hero">
          <div className="hero-copy">
            <h1>
              <span className="ln">
                <span>Practice the hard guests</span>
              </span>
              <span className="ln">
                <span className="accent">before they show up.</span>
              </span>
            </h1>
            <p className="sub">
              Your front desk rehearses real difficult-guest situations with a
              lifelike AI, then gets a coaching report on what to do better. So
              the first time they handle it for real, it isn&apos;t the first
              time.
            </p>
            <div className="actions">
              <Link href="/auth/signup" className="btn primary">
                Start free
              </Link>
              <Link href="/demo" className="btn ghost">
                Watch the 60-second demo
              </Link>
            </div>
            <p className="trust">
              No credit card needed. Built for hotels, restaurants, and
              hospitality teams.
            </p>
          </div>

          <div className="card-wrap">
            <CoachingReportCard />
          </div>
        </section>
      </div>

      {/* ---------------- PROBLEM ---------------- */}
      <section className="section" id="problem">
        <div className="container">
          <div className="section-head reveal">
            <span className="kicker">Why this matters</span>
            <h2>
              Difficult guests are expensive. You can&apos;t rehearse them on
              real ones.
            </h2>
            <p className="lede">
              Every angry check-in, refund fight, and review threat is a live
              exam for your team. The stakes are real. Until now, the practice
              ground didn&apos;t exist.
            </p>
          </div>
          <div className="stat-grid">
            <div className="stat reveal">
              <div className="stat-num">1 bad review</div>
              <p>
                can quietly cost dozens of future bookings. Travelers scroll
                past a property the moment a recent one-star lands near the top.
              </p>
            </div>
            <div className="stat reveal" style={{ transitionDelay: "80ms" }}>
              <div className="stat-num">5&times; more</div>
              <p>
                to win a brand-new guest than to keep the one already standing
                at your desk. Recovery skill is the cheapest growth lever you
                have.
              </p>
            </div>
            <div className="stat reveal" style={{ transitionDelay: "160ms" }}>
              <div className="stat-num">70%+ churn</div>
              <p>
                on the front line every year. The person handling
                tomorrow&apos;s complaint may have been onboarded last week.
                Repeatable training beats memory.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- BENTO / PRODUCT ---------------- */}
      <section className="section section-alt" id="product">
        <div className="container">
          <div className="section-head reveal">
            <span className="kicker">Product</span>
            <h2>This is real training, not a chatbot.</h2>
            <p className="lede">
              Every part is built for how front-desk conversations actually go.
            </p>
          </div>
          <div className="bento">
            {/* Row 1: two WIDE cards, each spans 3 of 6 */}
            <div className="bento-card b-wide reveal">
              <span className="pill pill-teal">Lifelike guest</span>
              <h3>A guest with a hidden need and a real mood.</h3>
              <p>
                Every scenario has a surface complaint and a real need
                underneath. The guest&apos;s mood shifts as you talk: handle it
                well and they soften, brush them off and they escalate. This is
                not a bot that gives up the moment you apologize.
              </p>
              <div className="live-mood" aria-hidden>
                <div className="mood-bar" />
                <span className="mood-tag">Guest mood, escalating</span>
              </div>
            </div>

            <div
              className="bento-card b-wide reveal"
              style={{ transitionDelay: "60ms" }}
            >
              <span className="pill pill-teal">4-competency report</span>
              <h3>Scored on what actually matters.</h3>
              <p>
                Empathy, clarity, problem-solving, and professionalism, each
                rated 1 to 5 and backed by real quotes from the conversation. No
                mystery grades.
              </p>
              <div className="mini-report inset" aria-hidden>
                <div className="mini-row">
                  <span>Empathy</span>
                  <span className="v-bar">
                    <span
                      className="v-fill"
                      style={{ width: "60%", background: "var(--emp)" }}
                    />
                  </span>
                  <span className="v-num">3</span>
                </div>
                <div className="mini-row">
                  <span>Clarity</span>
                  <span className="v-bar">
                    <span
                      className="v-fill"
                      style={{ width: "80%", background: "var(--clr)" }}
                    />
                  </span>
                  <span className="v-num">4</span>
                </div>
                <div className="mini-row">
                  <span>Problem-solving</span>
                  <span className="v-bar">
                    <span
                      className="v-fill"
                      style={{ width: "80%", background: "var(--prob)" }}
                    />
                  </span>
                  <span className="v-num">4</span>
                </div>
                <div className="mini-row">
                  <span>Professionalism</span>
                  <span className="v-bar">
                    <span
                      className="v-fill"
                      style={{ width: "100%", background: "var(--prof)" }}
                    />
                  </span>
                  <span className="v-num">5</span>
                </div>
              </div>
            </div>

            {/* Row 2: three EQUAL cards, each spans 2 of 6 */}
            <div
              className="bento-card b-eq reveal"
              style={{ transitionDelay: "60ms" }}
            >
              <span className="pill pill-amber">In-call</span>
              <h3>Coaching while you practice.</h3>
              <p>
                Get a suggested next move mid-conversation, without handing you
                the answer.
              </p>
            </div>

            <div
              className="bento-card b-eq reveal"
              style={{ transitionDelay: "120ms" }}
            >
              <span className="pill pill-teal">Voice mode</span>
              <h3>Speak it, don&apos;t just type it.</h3>
              <p>
                Practice out loud in voice mode and hear the guest react in real
                time.
              </p>
              <div className="wave" aria-hidden>
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
            </div>

            <div
              className="bento-card b-eq reveal"
              style={{ transitionDelay: "180ms" }}
            >
              <span className="pill pill-teal">Manager dashboard</span>
              <h3>See the whole team on one page.</h3>
              <p>
                Track how everyone scores over time, and catch the person who is
                great on clarity but weak on empathy before a real guest does.
              </p>
              <div className="dash-mini" aria-hidden>
                <div className="dash-cell" />
                <div className="dash-cell dash-mid" />
                <div className="dash-cell dash-hi" />
                <div className="dash-cell dash-hi" />
                <div className="dash-cell dash-mid" />
                <div className="dash-cell dash-lo" />
                <div className="dash-cell dash-hi" />
                <div className="dash-cell dash-mid" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- WHY DIFFERENT ---------------- */}
      <section className="section" id="different">
        <div className="container two-col">
          <div className="reveal">
            <span className="kicker">The moat</span>
            <h2>A guest you can&apos;t just placate.</h2>
            <p className="lede">
              Most chatbots reward good manners. Real guests don&apos;t. Every
              scenario has a hidden need under the stated complaint. The guest
              is angry about the room, but what they really need is to feel
              heard about the wedding they flew in for. Only genuine handling
              moves them.
            </p>
            <p className="lede">
              Some scenarios are marked <em>unwinnable</em>. You can&apos;t
              rescue every conversation. The point is to learn to de-escalate
              gracefully, not to always win. That&apos;s hospitality, not a
              video game.
            </p>
          </div>
          <div className="reveal" style={{ transitionDelay: "80ms" }}>
            <div className="dialogue">
              <div className="turn">
                <div className="who">Guest</div>
                <div className="says">
                  I don&apos;t want a discount. I want you to understand what
                  tonight was supposed to be.
                </div>
              </div>
              <div className="turn me">
                <div className="who">You</div>
                <div className="says">
                  Please, tell me. This trip mattered a lot, didn&apos;t it?
                </div>
              </div>
              <div className="turn">
                <div className="who">Guest</div>
                <div className="says needy">
                  <em>Underlying need:</em> to be heard, not compensated.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- PRICING ---------------- */}
      <section className="section section-alt" id="pricing">
        <div className="container">
          <div className="section-head reveal">
            <span className="kicker">Pricing</span>
            <h2>Simple, honest pricing.</h2>
            <p className="lede">
              Try it free. Upgrade when your team is ready to practice for real.
            </p>
          </div>
          <div className="pricing-grid">
            <div className="price-card reveal">
              <div className="price-eyebrow">Free trial</div>
              <div className="price">
                <span className="price-num">$0</span>
                <span className="price-per">no card required</span>
              </div>
              <ul className="price-list">
                <li>10 practice sessions total</li>
                <li>All 15 built-in scenarios</li>
                <li>Coaching report on every session</li>
                <li>Text mode</li>
              </ul>
              <Link href="/auth/signup" className="btn ghost btn-block">
                Start free
              </Link>
            </div>
            <div
              className="price-card featured reveal"
              style={{ transitionDelay: "80ms" }}
            >
              <div className="price-eyebrow">Starter</div>
              <div className="price">
                <span className="price-num">$100</span>
                <span className="price-per">/ workspace / month</span>
              </div>
              <ul className="price-list">
                <li>50 sessions per month, per workspace</li>
                <li>All 15 scenarios + custom AI-drafted ones</li>
                <li>Voice mode</li>
                <li>Manager dashboard</li>
                <li>Team invites</li>
              </ul>
              <Link href="/auth/signup" className="btn primary btn-block">
                Get started
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- FAQ ---------------- */}
      <section className="section" id="faq">
        <div className="container container-narrow">
          <div className="section-head reveal">
            <span className="kicker">Questions</span>
            <h2>What people ask first.</h2>
          </div>
          <div className="faq">
            {faqs.map((f, i) => (
              <details
                key={f.q}
                className="faq-item reveal"
                style={{ transitionDelay: `${i * 40}ms` }}
              >
                <summary>
                  <span>{f.q}</span>
                  <span className="chev" aria-hidden>
                    +
                  </span>
                </summary>
                <div className="faq-a">{f.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- FINAL CTA ---------------- */}
      <section className="cta-band reveal">
        <div className="container cta-inner">
          <h2>Ready to train your team?</h2>
          <p>
            Start with 10 free sessions today. No card. Five minutes to your
            first coaching report.
          </p>
          <div className="actions center">
            <Link href="/auth/signup" className="btn primary">
              Get started
            </Link>
            <Link href="/auth/signin" className="btn ghost btn-on-dark">
              Sign in
            </Link>
          </div>
          <p className="early">
            Come in as an early design partner. We&apos;re offering founding
            pricing to our first hotels and hospitality groups.
          </p>
        </div>
      </section>

      {/* ---------------- FOOTER ---------------- */}
      <footer className="footer">
        <div className="container footer-inner">
          <div className="footer-brand">
            <LobbyeeLogo />
            <p className="footer-tag">
              Practice the hard guests before they show up.
            </p>
          </div>
          <div className="footer-cols">
            <div>
              <h4>Product</h4>
              <ul>
                <li>
                  <a href="#product">Features</a>
                </li>
                <li>
                  <a href="#pricing">Pricing</a>
                </li>
                <li>
                  <a href="#faq">FAQ</a>
                </li>
              </ul>
            </div>
            <div>
              <h4>Company</h4>
              <ul>
                <li>
                  <a href="#about">About</a>
                </li>
                <li>
                  <a href="#careers">Careers</a>
                </li>
                <li>
                  <a href="#contact">Contact</a>
                </li>
              </ul>
            </div>
            <div>
              <h4>Legal</h4>
              <ul>
                <li>
                  <a href="#privacy">Privacy</a>
                </li>
                <li>
                  <a href="#terms">Terms</a>
                </li>
                <li>
                  <a href="#security">Security</a>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="footer-copy">
          <div className="container">
            &copy; {new Date().getFullYear()} Lobbyee. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ---------------- Hero portal-logo (with animatable strokes) ---------------- */
// A version of LobbyeeMark whose arches expose classes so the .play sequence
// can stroke-draw them + pop the spark. Kept local to the landing so we don't
// disturb the shared LobbyeeMark used everywhere else in the app.
function HeroMark() {
  return (
    <svg
      className="mark"
      width={34}
      height={34}
      viewBox="0 0 48 48"
      role="img"
      aria-label="Lobbyee"
      fill="none"
    >
      <defs>
        <linearGradient id="hero-gt" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3ee0cb" />
          <stop offset="0.5" stopColor="#12a394" />
          <stop offset="1" stopColor="#0a5f57" />
        </linearGradient>
        <linearGradient id="hero-gs" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd166" />
          <stop offset="1" stopColor="#f59e2c" />
        </linearGradient>
      </defs>
      <circle className="halo" cx="24" cy="23" r="5" fill="var(--spark)" />
      <path
        className="arc outer"
        d="M6 42V23a18 18 0 0 1 36 0v19"
        stroke="url(#hero-gt)"
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />
      <path
        className="arc inner"
        d="M16 42V23a8 8 0 0 1 16 0v19"
        stroke="url(#hero-gt)"
        strokeOpacity="0.45"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
      <circle className="spark" cx="24" cy="23" r="4.6" fill="url(#hero-gs)" />
    </svg>
  );
}

/* ---------------- Hero card: coaching report ---------------- */
function CoachingReportCard() {
  return (
    <figure className="card" aria-label="Sample coaching report">
      <p className="ceyebrow">Coaching report</p>
      <div className="chead">
        <div>
          <h4>Refund demand, review threat</h4>
          <p>with a difficult guest · 3 turns</p>
        </div>
        <span className="pill pill-bad">Unwinnable</span>
      </div>
      <ReportRow label="Empathy" width={0.6} color="var(--emp)" score={3} />
      <ReportRow label="Clarity" width={0.8} color="var(--clr)" score={4} />
      <ReportRow
        label="Problem-solving"
        width={0.8}
        color="var(--prob)"
        score={4}
      />
      <ReportRow
        label="Professionalism"
        width={1}
        color="var(--prof)"
        score={5}
      />
      <div className="cfoot">
        <span className="k">Overall this session</span>
        <span className="s">
          4.0<small>/5</small>
        </span>
      </div>
    </figure>
  );
}

function ReportRow({
  label,
  width,
  color,
  score,
}: {
  label: string;
  width: number;
  color: string;
  score: number;
}) {
  // --w drives the CSS keyframe (see .play .card .fill animation). Cast the
  // custom prop through a Record so TS accepts the CSS variable.
  const style = { "--w": width, background: color } as React.CSSProperties &
    Record<string, string | number>;
  return (
    <div className="row">
      <span className="l">{label}</span>
      <span className="track">
        <span className="fill" style={style} />
      </span>
      <span className="v">{score}</span>
    </div>
  );
}

/* ---------------- FAQ data ---------------- */
const faqs = [
  {
    q: "Text or voice, which should we use?",
    a: "Both. Start with text so trainees can slow down and think about phrasing. Move to voice once they're ready to practice under real-time pressure. Voice sessions grade the same four competencies and produce the same coaching report.",
  },
  {
    q: "Do we have to write our own scenarios?",
    a: "No. Lobbyee ships with 15 built-in hospitality scenarios covering the situations that most often go wrong: refund demands, overbooking, noisy neighbors, lost luggage, wrong charges, and more. Need something specific to your property? Give the AI a one-line brief and it drafts a full scenario for you.",
  },
  {
    q: "Is our data private?",
    a: "Yes. Every workspace's sessions, scenarios, and reports are isolated at the database level with row-level security. We don't train third-party models on your conversations. See our privacy page for the full detail.",
  },
  {
    q: "How does the AI grade the conversation?",
    a: "Four competencies (empathy, clarity, problem-solving, and professionalism) are each scored 1 to 5. Every score is backed by verbatim quotes from the transcript, so you can see exactly why the score is what it is. If we can't ground a claim in a real quote, we don't make it.",
  },
  {
    q: "What does it cost?",
    a: "Free for your first 10 practice sessions, no card required. After that, Starter is $100 per workspace per month for 50 sessions, everything included. Bigger teams? Talk to us about founding-partner pricing.",
  },
];

/* ---------------- Styles (scoped to .landing) ---------------- */
const styles = /* css */ `
.landing {
  --lb-bg: var(--color-neutral-50, #f5f7f9);
  --lb-surface: #fff;
  --lb-ink: var(--color-neutral-900, #141821);
  --lb-muted: var(--color-neutral-500, #5b6470);
  --lb-faint: var(--color-neutral-400, #98a0ac);
  --lb-line: var(--color-neutral-200, #e6e9ee);
  --teal: var(--color-accent-600, #0f766e);
  --teal-soft: var(--color-accent-100, #ccece5);
  --spark: var(--color-spark, #f6b23c);
  --emp: var(--color-empathy, #df5891);
  --clr: var(--color-clarity, #3b82c4);
  --prob: var(--color-problem, #e0892b);
  --prof: var(--color-prof, #12a085);
  --good: var(--color-good, #12a085);
  --warn: var(--color-warn, #e0952b);
  --bad: var(--color-bad, #e0574f);
  background: var(--lb-bg);
  color: var(--lb-ink);
  overflow-x: hidden;
}
.landing * { box-sizing: border-box; }

/* -------- Hero stage -------- */
.landing .stage { position: relative; overflow: hidden; isolation: isolate; }
.landing .glow { position: absolute; border-radius: 50%; filter: blur(110px); opacity: 0; z-index: 0; pointer-events: none; }
/* g1 is the dominant teal wash sitting behind the headline area. Made large
   and generous so the hero reads as a deliberate green, not a faint tint. */
.landing .glow.g1 { width: 980px; height: 980px; left: -160px; top: -260px; background: radial-gradient(circle, rgba(18,163,148,.62), rgba(62,224,203,.28) 40%, transparent 72%); }
/* g2/g3 stay subtler so g1 dominates. */
.landing .glow.g2 { width: 460px; height: 460px; right: -140px; bottom: -140px; background: radial-gradient(circle, rgba(59,130,196,.18), transparent 70%); }
.landing .glow.g3 { width: 360px; height: 360px; right: 6%; top: 8%; background: radial-gradient(circle, rgba(18,163,148,.28), transparent 70%); }
.landing .grid-tex {
  position: absolute; inset: 0; z-index: 0; opacity: 0;
  background-image: linear-gradient(rgba(20,24,33,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(20,24,33,.035) 1px, transparent 1px);
  background-size: 44px 44px;
  -webkit-mask-image: radial-gradient(circle at 50% 40%, #000, transparent 75%);
  mask-image: radial-gradient(circle at 50% 40%, #000, transparent 75%);
}

/* -------- Nav -------- */
.landing .lb-nav { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; justify-content: space-between; max-width: 1160px; margin: 0 auto; padding: 22px 28px; background: transparent; backdrop-filter: saturate(120%) blur(10px); }
.landing .lb-nav::before { content: ""; position: absolute; inset: 0; background: rgba(245,247,249,.72); z-index: -1; opacity: 0; transition: opacity .2s ease; }
.landing .lb-nav.is-scrolled::before { opacity: 1; }
.landing .brand { display: flex; align-items: center; gap: 11px; }
.landing .brand .wm { font-size: 19px; font-weight: 660; letter-spacing: -0.03em; opacity: 0; }
.landing .navlinks { display: flex; align-items: center; gap: 6px; opacity: 0; }
.landing .navlinks a { font-size: 14px; color: var(--lb-muted); text-decoration: none; padding: 9px 14px; border-radius: 10px; transition: color .15s ease, background .15s ease; }
.landing .navlinks a:hover { color: var(--lb-ink); background: rgba(15,23,42,.04); }
.landing .navlinks a.cta { background: var(--teal); color: #fff; font-weight: 600; box-shadow: 0 6px 16px rgba(15,118,110,.22); }
.landing .navlinks a.cta:hover { background: var(--color-accent-700, #0b5f58); color: #fff; }
.landing .navlinks a:focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; }
@media (max-width: 720px) {
  .landing .navlinks a:not(.cta) { display: none; }
  .landing .navlinks a.cta { padding: 8px 12px; font-size: 13.5px; }
}

/* -------- Hero content -------- */
.landing .hero { position: relative; z-index: 2; max-width: 1160px; margin: 0 auto; padding: 56px 28px 104px; display: grid; grid-template-columns: 1.05fr .95fr; gap: 48px; align-items: center; }
@media (max-width: 880px) { .landing .hero { grid-template-columns: 1fr; gap: 36px; padding-bottom: 56px; } }
.landing h1 { font-family: var(--font-display), var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif; font-size: clamp(38px, 5.4vw, 64px); line-height: 1.04; letter-spacing: -0.028em; margin: 0 0 22px; font-weight: 620; }
.landing h1 .ln { display: block; overflow: hidden; }
.landing h1 .ln > span { display: block; transform: translateY(110%); will-change: transform; }
.landing h1 .accent { color: var(--teal); }
.landing .sub { font-size: 18px; color: var(--lb-muted); max-width: 46ch; line-height: 1.55; margin: 0 0 30px; opacity: 0; }
.landing .actions { display: flex; gap: 12px; flex-wrap: wrap; opacity: 0; }
.landing .actions.center { justify-content: center; opacity: 1; }
.landing .btn { font-size: 15px; font-weight: 600; padding: 13px 22px; border-radius: 12px; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: transform .15s ease, box-shadow .15s ease, background .15s ease; cursor: pointer; border: 0; }
.landing .btn.primary { background: var(--teal); color: #fff; box-shadow: 0 8px 20px rgba(15,118,110,.28); }
.landing .btn.primary:hover { background: var(--color-accent-700, #0b5f58); transform: translateY(-1px); box-shadow: 0 10px 24px rgba(15,118,110,.32); }
.landing .btn.ghost { color: var(--lb-ink); border: 1px solid var(--lb-line); background: var(--lb-surface); }
.landing .btn.ghost:hover { border-color: var(--lb-ink); }
.landing .btn.ghost.btn-on-dark { color: #fff; background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.35); }
.landing .btn.ghost.btn-on-dark:hover { background: rgba(255,255,255,.12); }
.landing .btn.btn-block { width: 100%; }
.landing .btn:focus-visible { outline: 2px solid var(--teal); outline-offset: 3px; }
.landing .trust { margin-top: 26px; font-size: 13px; color: var(--lb-faint); opacity: 0; }

/* -------- Hero card -------- */
.landing .card-wrap { opacity: 0; transform: translateY(26px) scale(.97); }
.landing .card { background: var(--lb-surface); border: 1px solid var(--lb-line); border-radius: 18px; padding: 20px; box-shadow: 0 2px 4px rgba(16,20,30,.05), 0 24px 60px rgba(16,20,30,.12); }
.landing .ceyebrow { font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--lb-faint); margin: 0 0 12px; }
.landing .chead { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 16px; }
.landing .chead h4 { margin: 0; font-size: 16px; letter-spacing: -0.02em; }
.landing .chead p { margin: 3px 0 0; font-size: 12px; color: var(--lb-muted); }
.landing .pill { font-size: 10px; font-weight: 700; padding: 4px 9px; border-radius: 999px; white-space: nowrap; }
.landing .pill.pill-bad { background: rgba(224,87,79,.12); color: var(--bad); }
.landing .pill.pill-teal { background: rgba(18,163,148,.12); color: var(--teal); }
.landing .pill.pill-amber { background: rgba(246,178,60,.16); color: #a56a1e; }
.landing .row { display: grid; grid-template-columns: 112px 1fr 22px; align-items: center; gap: 11px; margin-bottom: 11px; }
.landing .row .l { font-size: 12.5px; color: var(--lb-ink); }
.landing .track { height: 7px; border-radius: 99px; background: #eef1f5; overflow: hidden; }
.landing .fill { display: block; height: 100%; border-radius: 99px; transform-origin: left; transform: scaleX(0); }
.landing .row .v { font-size: 13px; font-weight: 660; text-align: right; font-variant-numeric: tabular-nums; }
.landing .cfoot { display: flex; align-items: center; justify-content: space-between; border-top: 1px solid #eef1f5; margin-top: 6px; padding-top: 13px; }
.landing .cfoot .k { font-size: 12px; color: var(--lb-muted); }
.landing .cfoot .s { font-size: 15px; font-weight: 680; font-variant-numeric: tabular-nums; }
.landing .cfoot .s small { color: var(--lb-faint); font-weight: 500; }

/* -------- Portal logo draw -------- */
.landing .mark { width: 34px; height: 34px; display: block; overflow: visible; }
.landing .mark .arc { fill: none; stroke-linecap: round; }
.landing .mark .arc.outer { stroke-dasharray: 120; stroke-dashoffset: 120; }
.landing .mark .arc.inner { stroke-dasharray: 70; stroke-dashoffset: 70; }
.landing .mark .spark { transform-origin: 24px 23px; transform: scale(0); }
.landing .mark .halo { opacity: 0; transform-origin: 24px 23px; }

/* -------- Play state drives the entrance sequence -------- */
.landing .play .glow { animation: lb-bloom .9s ease forwards, lb-drift 14s ease-in-out infinite 1s; }
.landing .play .glow.g2 { animation: lb-bloom 1s ease .1s forwards, lb-drift 16s ease-in-out infinite 1.2s; }
.landing .play .glow.g3 { animation: lb-bloom 1.1s ease .2s forwards, lb-driftb 18s ease-in-out infinite 1.4s; }
.landing .play .grid-tex { animation: lb-fadein 1.2s ease .2s forwards; }
.landing .play .mark .arc.outer { animation: lb-draw .55s ease .15s forwards; }
.landing .play .mark .arc.inner { animation: lb-draw .5s ease .4s forwards; }
.landing .play .mark .spark { animation: lb-pop .5s cubic-bezier(.2,1.3,.4,1) .62s forwards; }
.landing .play .mark .halo { animation: lb-halo .9s ease .66s forwards; }
.landing .play .brand .wm { animation: lb-rise .55s ease .5s forwards; }
.landing .play .navlinks { animation: lb-fadein .6s ease .8s forwards; }
.landing .play h1 .ln > span { animation: lb-risein .7s cubic-bezier(.2,.8,.2,1) forwards; }
.landing .play h1 .ln:nth-child(1) > span { animation-delay: .5s; }
.landing .play h1 .ln:nth-child(2) > span { animation-delay: .6s; }
.landing .play .sub { animation: lb-rise .7s ease .8s forwards; }
.landing .play .actions { animation: lb-rise .7s ease .95s forwards; }
.landing .play .trust { animation: lb-fadein .7s ease 1.15s forwards; }
.landing .play .card-wrap { animation: lb-cardin .9s cubic-bezier(.2,.8,.2,1) .7s forwards; }
.landing .play .card .fill { animation: lb-grow .8s cubic-bezier(.2,.8,.2,1) forwards; }
.landing .play .card .row:nth-child(2) .fill { animation-delay: 1.25s; }
.landing .play .card .row:nth-child(3) .fill { animation-delay: 1.35s; }
.landing .play .card .row:nth-child(4) .fill { animation-delay: 1.45s; }
.landing .play .card .row:nth-child(5) .fill { animation-delay: 1.55s; }

@keyframes lb-bloom { to { opacity: 1; } }
@keyframes lb-fadein { to { opacity: 1; } }
@keyframes lb-draw { to { stroke-dashoffset: 0; } }
@keyframes lb-pop { 0% { transform: scale(0); } 70% { transform: scale(1.25); } 100% { transform: scale(1); } }
@keyframes lb-halo { 0% { opacity: .55; transform: scale(1); } 100% { opacity: 0; transform: scale(2.6); } }
@keyframes lb-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
@keyframes lb-risein { to { transform: translateY(0); } }
@keyframes lb-cardin { to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes lb-grow { to { transform: scaleX(var(--w)); } }
@keyframes lb-drift { 0%, 100% { translate: 0 0; } 50% { translate: -26px 22px; } }
@keyframes lb-driftb { 0%, 100% { translate: 0 0; } 50% { translate: 30px -18px; } }

/* -------- Sections (below-fold) -------- */
.landing .section { padding: 96px 0; position: relative; }
.landing .section-alt { background: var(--lb-surface); border-top: 1px solid var(--lb-line); border-bottom: 1px solid var(--lb-line); }
.landing .container { max-width: 1160px; margin: 0 auto; padding: 0 28px; }
.landing .container-narrow { max-width: 760px; }
.landing .section-head { max-width: 720px; margin: 0 auto 56px; text-align: center; }
.landing .kicker { display: inline-block; font-size: 11.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--teal); background: rgba(18,163,148,.1); padding: 5px 11px; border-radius: 999px; margin-bottom: 16px; }
.landing h2 { font-family: var(--font-display), var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif; font-size: clamp(28px, 3.4vw, 42px); line-height: 1.1; letter-spacing: -0.022em; margin: 0 0 14px; font-weight: 600; }
.landing h3 { font-size: 18px; margin: 0 0 8px; letter-spacing: -0.015em; font-weight: 620; }
.landing .lede { font-size: 17px; color: var(--lb-muted); line-height: 1.55; margin: 0; }

/* Reveal utility */
.landing .reveal { opacity: 0; transform: translateY(18px); transition: opacity .6s ease, transform .6s cubic-bezier(.2,.8,.2,1); will-change: opacity, transform; }
.landing .reveal.is-in { opacity: 1; transform: translateY(0); }

/* -------- Problem stats -------- */
.landing .stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
@media (max-width: 820px) { .landing .stat-grid { grid-template-columns: 1fr; } }
.landing .stat { background: var(--lb-surface); border: 1px solid var(--lb-line); border-radius: 16px; padding: 26px; box-shadow: var(--shadow-sm, 0 1px 2px rgba(16,20,30,.05)); transition: transform .2s ease, box-shadow .2s ease; }
.landing .stat:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(16,20,30,.08); }
.landing .stat-num { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: var(--teal); margin-bottom: 8px; }
.landing .stat p { margin: 0; color: var(--lb-muted); font-size: 15px; line-height: 1.55; }

/* -------- Steps -------- */
.landing .steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
@media (max-width: 900px) { .landing .steps { grid-template-columns: 1fr; } }
.landing .step { background: var(--lb-bg); border: 1px solid var(--lb-line); border-radius: 20px; padding: 28px; transition: transform .2s ease, box-shadow .2s ease; }
.landing .step:hover { transform: translateY(-2px); box-shadow: 0 12px 32px rgba(16,20,30,.08); }
.landing .step-n { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 10px; background: var(--teal); color: #fff; font-weight: 700; font-size: 14px; margin-bottom: 16px; }
.landing .step p { color: var(--lb-muted); font-size: 15px; line-height: 1.55; margin: 0 0 18px; }
.landing .mini { border-top: 1px solid var(--lb-line); padding-top: 16px; }
.landing .mini-pick { display: flex; flex-wrap: wrap; gap: 6px; }
.landing .chip { font-size: 12px; padding: 5px 10px; border-radius: 999px; background: #fff; border: 1px solid var(--lb-line); color: var(--lb-muted); }
.landing .chip.chip-on { background: var(--teal); color: #fff; border-color: var(--teal); }
.landing .mini-chat { display: grid; gap: 6px; }
.landing .bubble { font-size: 13px; padding: 8px 12px; border-radius: 12px; max-width: 90%; line-height: 1.45; }
.landing .bubble-them { background: #fff; border: 1px solid var(--lb-line); }
.landing .bubble-me { background: var(--teal); color: #fff; justify-self: end; }
.landing .mood-strip { display: flex; gap: 4px; margin-top: 6px; }
.landing .mood-dot { width: 12px; height: 4px; border-radius: 99px; }
.landing .mini-report { display: grid; gap: 8px; }
.landing .mini-report.inset { margin-top: 12px; }
.landing .mini-row { display: grid; grid-template-columns: 1fr 2fr auto; align-items: center; gap: 10px; font-size: 12.5px; color: var(--lb-muted); }
.landing .mini-row .v-num { font-weight: 660; color: var(--lb-ink); font-variant-numeric: tabular-nums; }
.landing .v-bar { display: block; height: 6px; background: #eef1f5; border-radius: 99px; overflow: hidden; }
.landing .v-fill { display: block; height: 100%; border-radius: 99px; }

/* -------- Bento (2+3 on a 6-col grid) -------- */
.landing .bento { display: grid; grid-template-columns: repeat(6, 1fr); grid-auto-rows: minmax(220px, auto); gap: 20px; }
.landing .bento-card { background: var(--lb-bg); border: 1px solid var(--lb-line); border-radius: 20px; padding: 26px; display: flex; flex-direction: column; gap: 12px; transition: transform .2s ease, box-shadow .2s ease; }
.landing .bento-card:hover { transform: translateY(-2px); box-shadow: 0 16px 40px rgba(16,20,30,.08); }
/* Row 1: two wide cards, each spanning half the row. */
.landing .bento-card.b-wide { grid-column: span 3; }
/* Row 2: three equal cards, each spanning a third. */
.landing .bento-card.b-eq { grid-column: span 2; }
.landing .bento-card p { color: var(--lb-muted); font-size: 15px; line-height: 1.55; margin: 0; }
.landing .bento-card .pill { align-self: flex-start; }
@media (max-width: 900px) {
  .landing .bento { grid-template-columns: 1fr; grid-auto-rows: auto; }
  .landing .bento-card.b-wide, .landing .bento-card.b-eq { grid-column: span 1; }
}

.landing .live-mood { margin-top: auto; padding-top: 14px; }
.landing .mood-bar { height: 10px; border-radius: 99px; background: linear-gradient(90deg, var(--good) 0%, var(--warn) 55%, var(--bad) 100%); position: relative; }
.landing .mood-bar::after { content: ""; position: absolute; top: -3px; left: 68%; width: 4px; height: 16px; border-radius: 2px; background: var(--lb-ink); }
.landing .mood-tag { display: block; margin-top: 8px; font-size: 12px; color: var(--lb-faint); }

.landing .wave { display: flex; align-items: end; gap: 4px; height: 40px; margin-top: auto; }
.landing .wave span { display: block; flex: 1; background: var(--teal); border-radius: 3px; opacity: .8; animation: lb-wave 1.2s ease-in-out infinite; }
.landing .wave span:nth-child(1) { animation-delay: .0s; height: 30%; }
.landing .wave span:nth-child(2) { animation-delay: .1s; height: 60%; }
.landing .wave span:nth-child(3) { animation-delay: .2s; height: 40%; }
.landing .wave span:nth-child(4) { animation-delay: .3s; height: 80%; }
.landing .wave span:nth-child(5) { animation-delay: .4s; height: 55%; }
.landing .wave span:nth-child(6) { animation-delay: .5s; height: 90%; }
.landing .wave span:nth-child(7) { animation-delay: .6s; height: 50%; }
.landing .wave span:nth-child(8) { animation-delay: .7s; height: 70%; }
.landing .wave span:nth-child(9) { animation-delay: .8s; height: 45%; }
.landing .wave span:nth-child(10) { animation-delay: .9s; height: 25%; }
@keyframes lb-wave { 0%, 100% { transform: scaleY(.6); } 50% { transform: scaleY(1); } }
.landing .wave span { transform-origin: bottom; }

.landing .dash-mini { margin-top: auto; display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.landing .dash-cell { height: 26px; border-radius: 6px; background: #eef1f5; }
.landing .dash-cell.dash-lo { background: rgba(224,87,79,.35); }
.landing .dash-cell.dash-mid { background: rgba(224,149,43,.4); }
.landing .dash-cell.dash-hi { background: rgba(18,160,133,.55); }

/* -------- Why different / dialogue -------- */
.landing .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; align-items: center; }
@media (max-width: 900px) { .landing .two-col { grid-template-columns: 1fr; gap: 32px; } }
.landing .dialogue { display: grid; gap: 12px; padding: 22px; background: var(--lb-bg); border: 1px solid var(--lb-line); border-radius: 20px; }
.landing .turn .who { font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--lb-faint); margin-bottom: 4px; }
.landing .turn .says { background: #fff; border: 1px solid var(--lb-line); padding: 12px 14px; border-radius: 12px; font-size: 14.5px; line-height: 1.5; }
.landing .turn.me .says { background: var(--teal); color: #fff; border-color: var(--teal); }
.landing .says.needy { background: rgba(223,88,145,.08); border-color: rgba(223,88,145,.3); color: var(--emp); font-size: 13.5px; }
.landing .says.needy em { font-style: normal; font-weight: 700; margin-right: 4px; }

/* -------- Pricing -------- */
.landing .pricing-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 22px; max-width: 880px; margin: 0 auto; }
@media (max-width: 780px) { .landing .pricing-grid { grid-template-columns: 1fr; } }
.landing .price-card { background: var(--lb-surface); border: 1px solid var(--lb-line); border-radius: 20px; padding: 32px; display: flex; flex-direction: column; gap: 22px; transition: transform .2s ease, box-shadow .2s ease; }
.landing .price-card:hover { transform: translateY(-2px); box-shadow: 0 20px 44px rgba(16,20,30,.1); }
.landing .price-card.featured { border-color: var(--teal); box-shadow: 0 12px 32px rgba(15,118,110,.14); position: relative; }
.landing .price-card.featured::before { content: "Recommended"; position: absolute; top: -12px; left: 24px; background: var(--teal); color: #fff; font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; padding: 4px 10px; border-radius: 999px; }
.landing .price-eyebrow { font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--lb-muted); }
.landing .price { display: flex; align-items: baseline; gap: 8px; }
.landing .price-num { font-size: 40px; font-weight: 720; letter-spacing: -0.03em; color: var(--lb-ink); }
.landing .price-per { font-size: 14px; color: var(--lb-muted); }
.landing .price-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.landing .price-list li { display: flex; align-items: flex-start; gap: 10px; font-size: 14.5px; color: var(--lb-ink); }
.landing .price-list li::before { content: ""; flex-shrink: 0; width: 16px; height: 16px; margin-top: 3px; border-radius: 999px; background: var(--teal-soft); position: relative; }
.landing .price-list li { position: relative; }
.landing .price-list li::after { content: ""; position: absolute; left: 4px; top: 8px; width: 8px; height: 4px; border-left: 2px solid var(--teal); border-bottom: 2px solid var(--teal); transform: rotate(-45deg); }

/* -------- FAQ -------- */
.landing .faq { display: grid; gap: 10px; }
.landing .faq-item { background: var(--lb-surface); border: 1px solid var(--lb-line); border-radius: 14px; padding: 4px 6px; transition: border-color .15s ease; }
.landing .faq-item[open] { border-color: var(--teal); }
.landing .faq-item summary { list-style: none; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px; font-weight: 600; font-size: 16px; }
.landing .faq-item summary::-webkit-details-marker { display: none; }
.landing .faq-item .chev { width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; background: var(--lb-bg); color: var(--lb-muted); font-size: 18px; font-weight: 500; transition: transform .2s ease, background .2s ease, color .2s ease; }
.landing .faq-item[open] .chev { transform: rotate(45deg); background: var(--teal); color: #fff; }
.landing .faq-item .faq-a { padding: 0 18px 18px; color: var(--lb-muted); font-size: 15px; line-height: 1.6; }
.landing .faq-item summary:focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; border-radius: 10px; }

/* -------- CTA band -------- */
.landing .cta-band { background: #0b0f14; color: #fff; padding: 96px 0; text-align: center; position: relative; overflow: hidden; border-top: 1px solid rgba(20,184,166,.14); }
.landing .cta-band::before { content: ""; position: absolute; inset: 0; background: radial-gradient(1100px 460px at 50% -30%, rgba(20,184,166,.20), transparent 62%); }
.landing .cta-inner { position: relative; }
.landing .cta-band h2 { color: #fff; margin-bottom: 12px; }
.landing .cta-band p { color: rgba(255,255,255,.72); font-size: 17px; margin: 0 0 26px; }
.landing .cta-band .early { color: rgba(255,255,255,.5); font-size: 13.5px; margin-top: 24px; }

/* -------- Footer -------- */
.landing .footer { background: var(--lb-surface); border-top: 1px solid var(--lb-line); padding: 64px 0 0; }
.landing .footer-inner { display: grid; grid-template-columns: 1.2fr 2fr; gap: 48px; padding-bottom: 48px; }
@media (max-width: 780px) { .landing .footer-inner { grid-template-columns: 1fr; gap: 32px; } }
.landing .footer-tag { color: var(--lb-muted); font-size: 14px; margin: 12px 0 0; max-width: 320px; }
.landing .footer-cols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
.landing .footer-cols h4 { font-size: 13px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--lb-ink); margin: 0 0 12px; }
.landing .footer-cols ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
.landing .footer-cols a { color: var(--lb-muted); text-decoration: none; font-size: 14px; }
.landing .footer-cols a:hover { color: var(--lb-ink); }
.landing .footer-copy { border-top: 1px solid var(--lb-line); padding: 20px 0; font-size: 13px; color: var(--lb-faint); }

/* -------- Reduced motion: everything final-state, no animation -------- */
@media (prefers-reduced-motion: reduce) {
  .landing .glow, .landing .grid-tex, .landing .brand .wm, .landing .navlinks, .landing .sub, .landing .actions, .landing .trust, .landing .card-wrap { opacity: 1 !important; animation: none !important; }
  .landing .card-wrap { transform: none !important; }
  .landing h1 .ln > span { transform: none !important; animation: none !important; }
  .landing .mark .arc { stroke-dashoffset: 0 !important; animation: none !important; }
  .landing .mark .spark { transform: scale(1) !important; animation: none !important; }
  .landing .mark .halo { opacity: 0 !important; animation: none !important; }
  .landing .card .fill { transform: scaleX(var(--w)) !important; animation: none !important; }
  .landing .wave span { animation: none !important; transform: scaleY(1) !important; }
  .landing .reveal { opacity: 1 !important; transform: none !important; transition: none !important; }
}
`;
